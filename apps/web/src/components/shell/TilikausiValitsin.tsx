import { cn } from '@/lib/utils';
import { useValittuTilikausi } from '@/tilikausi/valittuTilikausi';
import type { Tilikausi } from '@penni/engine';
import { muotoilePvm } from '@penni/euro';
import { Check, ChevronDown, Lock } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

/** Lyhyt nimi: kalenterivuoden kausi "2026", muu "2025–2026". */
export function tilikaudenNimi(k: Pick<Tilikausi, 'alkaa' | 'loppuu'>): string {
  const alku = k.alkaa.slice(0, 4);
  const loppu = k.loppuu.slice(0, 4);
  return alku === loppu ? alku : `${alku}–${loppu}`;
}

const kausivali = (k: Pick<Tilikausi, 'alkaa' | 'loppuu'>) =>
  `${muotoilePvm(k.alkaa)}–${muotoilePvm(k.loppuu)}`;

/**
 * Sivupalkin tilikausivalinta (Kitsas: aloitussivun tilikausiCombo). Oma valikko natiivin
 * selectin sijaan, jotta lukitun kauden (TilitPaatetty yltää kauden loppuun, kuten
 * tilinpaatos/tilinpaatosTila.ts) voi merkitä lukkokuvakkeella. Uusin kausi ylimpänä;
 * nuolinäppäimet liikkuvat, Enter valitsee, Esc sulkee.
 */
export function TilikausiValitsin() {
  const { kausi, kaudet, valitse, lukittu } = useValittuTilikausi();
  const [auki, setAuki] = useState(false);
  const juuri = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const nappi = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!auki) return;
    const ulkopuolinen = (e: MouseEvent) => {
      if (juuri.current && !juuri.current.contains(e.target as Node)) setAuki(false);
    };
    document.addEventListener('mousedown', ulkopuolinen);
    // Avattaessa kohdistus valittuun kauteen, jotta nuolet jatkavat siitä.
    lista.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener('mousedown', ulkopuolinen);
  }, [auki]);

  if (!kausi) return null;
  const uusinEnsin = [...kaudet].reverse();
  const nimi = (k: Tilikausi) =>
    // Kaksi saman vuoden kautta (lyhennetty tai pidennetty kausi) erotetaan päivillä.
    kaudet.some((m) => m !== k && tilikaudenNimi(m) === tilikaudenNimi(k))
      ? kausivali(k)
      : tilikaudenNimi(k);

  const sulje = () => {
    setAuki(false);
    nappi.current?.focus();
  };
  const nappaimet = (e: KeyboardEvent<HTMLDivElement>) => {
    const vaihtoehdot = [
      ...(lista.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
    ];
    const i = vaihtoehdot.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      sulje();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const seuraava = e.key === 'ArrowDown' ? i + 1 : i - 1;
      vaihtoehdot[Math.max(0, Math.min(vaihtoehdot.length - 1, seuraava))]?.focus();
    }
  };

  return (
    <div ref={juuri} className="relative mx-[3px] mb-3">
      <div
        id="tilikausi-otsikko"
        className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]"
      >
        Tilikausi
      </div>
      <button
        ref={nappi}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={auki}
        aria-labelledby="tilikausi-otsikko tilikausi-arvo"
        title={kausivali(kausi)}
        onClick={() => setAuki((a) => !a)}
        className="flex w-full items-center gap-[6px] rounded-[7px] border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-[5px] text-left text-[12.5px] font-semibold text-[var(--text)] hover:bg-[var(--bg-subtle)]"
      >
        <span id="tilikausi-arvo" className="min-w-0 flex-1 truncate">
          {nimi(kausi)}
        </span>
        {lukittu(kausi) && (
          <Lock
            role="img"
            aria-label="lukittu"
            className="h-3 w-3 shrink-0 text-[var(--text-subtle)]"
          />
        )}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
      </button>
      {auki && (
        <div
          ref={lista}
          // biome-ignore lint/a11y/useSemanticElements: natiivi <select> ei näytä lukkokuvaketta
          role="listbox"
          tabIndex={-1}
          aria-labelledby="tilikausi-otsikko"
          onKeyDown={nappaimet}
          className="absolute left-0 top-full z-20 mt-1 w-full min-w-[150px] rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-1 text-[12.5px] shadow-lg"
        >
          {uusinEnsin.map((k) => {
            const valittu = k.alkaa === kausi.alkaa;
            return (
              <div
                key={k.alkaa}
                // biome-ignore lint/a11y/useSemanticElements: ks. listbox yllä — <option> ei sisällä kuvaketta
                role="option"
                aria-selected={valittu}
                tabIndex={-1}
                title={kausivali(k)}
                onClick={() => {
                  valitse(k.alkaa);
                  sulje();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    valitse(k.alkaa);
                    sulje();
                  }
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-[6px] outline-none hover:bg-[var(--track)] focus:bg-[var(--track)]',
                  valittu && 'font-semibold',
                )}
              >
                <Check
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 text-[var(--accent)]',
                    !valittu && 'invisible',
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{nimi(k)}</span>
                {lukittu(k) && (
                  <Lock
                    role="img"
                    aria-label="lukittu"
                    className="h-3 w-3 shrink-0 text-[var(--text-subtle)]"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
