import { cn } from '@/lib/utils';
import { onkoTyopoyta } from '@/tuonti/silta';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type Suunta, TAUKO, luoPyyhkaisy, nappainSuunta, voiVierittaaVaakaan } from './eleet.js';
import { useHistoria } from './useHistoria.js';

/** Kohteet, joissa näppäimet kuuluvat kentälle/ruudukolle eivätkä historialle (vrt. EdellinenSeuraava). */
const KIRJOITUSKOHDE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="grid"], [role="dialog"]';

/** Työpöytäsillan valinnainen osa: pääprosessin app-command (Windows/Linux: hiiren sivunapit, mediakomennot). */
interface NavigointiSilta {
  kuunteleNavigointi?: (kuuntelija: (suunta: string) => void) => () => void;
}

export function onkoMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

interface Veto {
  suunta: Suunta;
  osuus: number;
}

/**
 * Selaimen historiaeleet työpöytäsovellukseen. Tavallisessa selaimessa selain hoitaa itse
 * näppäimet, hiiren sivunapit ja trackpad-pyyhkäisyn — sama käsittely täällä siirtäisi kahdesti
 * — joten kuuntelijat kytketään vain Electron-kuoressa (window.penni-silta).
 *
 * - Näppäimet: macOS Cmd+[ / Cmd+] (ja Cmd+← / Cmd+→), muualla Alt+← / Alt+→; ei kentissä,
 *   ruudukossa eikä dialogissa.
 * - Hiiren sivunapit (button 3/4) macOS:llä; Windows/Linux saavat ne pääprosessin
 *   app-commandina sillan kautta (renderöijässä käsiteltynä ne siirtäisivät kahdesti).
 * - Kahden sormen vaakapyyhkäisy (eleet.ts) ja reunaan liukuva nuoliosoitin kuten Chromessa.
 */
export function Historiaeleet() {
  const { siirry, voiPalata, voiEdeta } = useHistoria();
  const [veto, setVeto] = useState<Veto | null>(null);
  // Kuuntelijat rekisteröidään kerran; viite lukee aina tuoreimman tilan.
  const nykyiset = useRef({ siirry, voiPalata, voiEdeta });
  nykyiset.current = { siirry, voiPalata, voiEdeta };

  useEffect(() => {
    const silta = window.penni as NavigointiSilta | undefined;
    const lopetaSilta = silta?.kuunteleNavigointi?.((suunta) => {
      if (suunta === 'takaisin' || suunta === 'eteenpain') nykyiset.current.siirry(suunta);
    });
    if (!onkoTyopoyta()) return lopetaSilta;

    const mac = onkoMac();
    const voi = (s: Suunta) =>
      s === 'takaisin' ? nykyiset.current.voiPalata : nykyiset.current.voiEdeta;
    const ajastimet = new Set<ReturnType<typeof setTimeout>>();
    const ajasta = (fn: () => void, ms: number) => {
      const a = setTimeout(() => {
        ajastimet.delete(a);
        fn();
      }, ms);
      ajastimet.add(a);
      return a;
    };

    function nappain(e: KeyboardEvent) {
      if (e.repeat || e.isComposing || e.defaultPrevented) return;
      const suunta = nappainSuunta(e, mac);
      if (!suunta) return;
      if (e.target instanceof Element && e.target.closest(KIRJOITUSKOHDE)) return;
      // Tositesivun Alt+← / Alt+→ (EdellinenSeuraava) kuuntelee samaa window-tapahtumaa ja
      // voi olla rekisteröity tämän jälkeen. defaultPrevented tarkistetaan siksi vasta, kun
      // tapahtuma on käynyt kaikki kuuntelijat läpi.
      ajasta(() => {
        if (!e.defaultPrevented) nykyiset.current.siirry(suunta);
      }, 0);
    }

    function hiiri(e: MouseEvent) {
      if (!mac || (e.button !== 3 && e.button !== 4)) return;
      e.preventDefault();
      nykyiset.current.siirry(e.button === 3 ? 'takaisin' : 'eteenpain');
    }

    const pyyhkaisy = luoPyyhkaisy();
    let piilotus: ReturnType<typeof setTimeout> | undefined;
    function rulla(e: WheelEvent) {
      // Ctrl = nipistyszoomaus, Shift = hiiren rulla vaakavierityksenä; ne eivät ole pyyhkäisyjä.
      if (e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return;
      const kerroin = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1;
      const dx = e.deltaX * kerroin;
      const kohde = e.target instanceof Element ? e.target : null;
      const tulos = pyyhkaisy.syota({
        dx,
        dy: e.deltaY * kerroin,
        aika: performance.now(),
        vierittyy: e.defaultPrevented || voiVierittaaVaakaan(kohde, dx),
      });
      if (piilotus !== undefined) clearTimeout(piilotus);
      piilotus = ajasta(() => setVeto(null), TAUKO);
      if (tulos.tila === 'lepo' || !voi(tulos.suunta)) {
        setVeto(null);
      } else if (tulos.tila === 'veto') {
        setVeto({ suunta: tulos.suunta, osuus: tulos.osuus });
      } else {
        setVeto({ suunta: tulos.suunta, osuus: 1 });
        nykyiset.current.siirry(tulos.suunta);
      }
    }

    window.addEventListener('keydown', nappain);
    window.addEventListener('mouseup', hiiri);
    window.addEventListener('wheel', rulla, { passive: true });
    return () => {
      lopetaSilta?.();
      window.removeEventListener('keydown', nappain);
      window.removeEventListener('mouseup', hiiri);
      window.removeEventListener('wheel', rulla);
      for (const a of ajastimet) clearTimeout(a);
    };
  }, []);

  if (!veto) return null;
  const takaisin = veto.suunta === 'takaisin';
  const valmis = veto.osuus >= 1;
  const Nuoli = takaisin ? ChevronLeft : ChevronRight;
  // Osoitin liukuu reunan takaa näkyviin vedon edetessä (−36 px → +16 px).
  const siirtyma = -36 + 52 * Math.min(veto.osuus, 1);
  return (
    <div
      aria-hidden
      data-testid="pyyhkaisyosoitin"
      data-suunta={veto.suunta}
      className={cn(
        'pointer-events-none fixed top-1/2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] shadow-[var(--shadow-pop)] transition-colors print:hidden',
        valmis
          ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
          : 'bg-[var(--surface)] text-[var(--text-muted)]',
      )}
      style={{
        [takaisin ? 'left' : 'right']: `${siirtyma}px`,
        opacity: Math.min(1, 0.3 + veto.osuus),
      }}
    >
      <Nuoli className="size-5" />
    </div>
  );
}
