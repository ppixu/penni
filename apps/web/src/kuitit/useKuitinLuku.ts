import type { Kuitti } from '@penni/engine';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { type LukuVaihe, type Lukumalli, lueKuitti } from './lueKuitti.js';
import { type MalliYmparisto, annaMalliYmparisto } from './malliYmparisto.js';
import { jaettuPaattelija, lukumalliPaattelijasta } from './paattely.js';

export type KuitinLukuTila =
  | { vaihe: 'lepo' }
  | LukuVaihe
  | { vaihe: 'luettu'; liiteId: number; kuitti: Kuitti }
  | { vaihe: 'eiLuettu'; syy: 'eiGpu' | 'tyhja' | 'virhe' };

export interface LuettavaLiite {
  id: number;
  tyyppi: string;
  data: Uint8Array;
}

export interface KuitinLukuRiippuvuudet {
  malli: () => Lukumalli;
  ymparisto: () => MalliYmparisto;
  pdfTeksti: (pdf: Blob) => Promise<string>;
  rasteroiPdf: (pdf: Blob) => Promise<Blob>;
}

/** Testit ja tarinat antavat omat riippuvuudet; muuten oikea työntekijä ja pdf.js. */
export const KuitinLukuKonteksti = createContext<KuitinLukuRiippuvuudet | null>(null);

let jono: Promise<unknown> = Promise.resolve();
/** GPU:lla ajetaan yksi päättely kerrallaan: perutun luvun generointi ei pysähdy työntekijässä. */
function sarjoita<T>(tehtava: () => Promise<T>): Promise<T> {
  const tulos = jono.then(tehtava, tehtava);
  jono = tulos.catch(() => undefined);
  return tulos;
}

function oikeatRiippuvuudet(): KuitinLukuRiippuvuudet {
  return {
    ymparisto: annaMalliYmparisto,
    malli: () => lukumalliPaattelijasta(jaettuPaattelija(), annaMalliYmparisto().latausAsetukset),
    // pdf.js ladataan vasta tarvittaessa (ja testeissä ei lainkaan).
    pdfTeksti: async (pdf) => (await import('./pdf.js')).luePdfTeksti(pdf),
    rasteroiPdf: async (pdf) => (await import('./pdf.js')).rasteroiPdf(pdf),
  };
}

/**
 * Kuitin automaattinen luku liitettäessä. Yksi luku kerrallaan: uusi `lue` tai `peru` hylkää
 * edellisen tuloksen. Mallin lataus vaatii kertaluontoisen luvan (tila `tarvitseeLuvan`).
 */
export function useKuitinLuku() {
  const annetut = useContext(KuitinLukuKonteksti);
  const riippuvuudet = useRef(annetut ?? oikeatRiippuvuudet());
  const [tila, setTila] = useState<KuitinLukuTila>({ vaihe: 'lepo' });
  const ohjain = useRef<AbortController | null>(null);
  const lupaVastaus = useRef<((kylla: boolean) => void) | null>(null);

  const peru = useCallback(() => {
    ohjain.current?.abort();
    ohjain.current = null;
    lupaVastaus.current?.(false);
    lupaVastaus.current = null;
    setTila({ vaihe: 'lepo' });
  }, []);

  const lue = useCallback(
    (liite: LuettavaLiite) => {
      peru();
      const oma = new AbortController();
      ohjain.current = oma;
      const r = riippuvuudet.current;
      const ymparisto = r.ymparisto();
      // Sarjoitus yhdessä paikassa: koskee sekä oikeaa että kontekstista annettua mallia.
      const malli = (): Lukumalli => {
        const m = r.malli();
        return {
          saatavilla: () => m.saatavilla(),
          lataa: (edistyi) =>
            sarjoita(() => {
              oma.signal.throwIfAborted();
              return m.lataa(edistyi);
            }),
          tulkitse: (kuva, kehote) =>
            sarjoita(() => {
              oma.signal.throwIfAborted();
              return m.tulkitse(kuva, kehote);
            }),
        };
      };
      void lueKuitti(liite.data, liite.tyyppi, {
        pdfTeksti: r.pdfTeksti,
        rasteroiPdf: r.rasteroiPdf,
        malli,
        signal: oma.signal,
        vaihe: (v) => {
          if (!oma.signal.aborted) setTila(v);
        },
        lupa: async () => {
          if (await ymparisto.onkoLupa()) return true;
          if (oma.signal.aborted) return false;
          setTila({ vaihe: 'tarvitseeLuvan' });
          const kylla = await new Promise<boolean>((resolve) => {
            lupaVastaus.current = resolve;
          });
          if (kylla) await ymparisto.annaLupa();
          return kylla;
        },
      }).then((tulos) => {
        if (oma.signal.aborted) return;
        ohjain.current = null;
        if (tulos.ok) setTila({ vaihe: 'luettu', liiteId: liite.id, kuitti: tulos.kuitti });
        else if (tulos.syy === 'eiGpu' || tulos.syy === 'tyhja' || tulos.syy === 'virhe')
          setTila({ vaihe: 'eiLuettu', syy: tulos.syy });
        else setTila({ vaihe: 'lepo' });
      });
    },
    [peru],
  );

  const vastaaLupaan = useCallback((kylla: boolean) => {
    const vastaa = lupaVastaus.current;
    lupaVastaus.current = null;
    vastaa?.(kylla);
  }, []);

  const kuittaa = useCallback(() => setTila({ vaihe: 'lepo' }), []);

  useEffect(
    () => () => {
      ohjain.current?.abort();
      lupaVastaus.current?.(false);
    },
    [],
  );

  return { tila, lue, peru, vastaaLupaan, kuittaa };
}
