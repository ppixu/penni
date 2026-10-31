import { type Tilitapahtuma, poimiTiliotteet } from '@penni/engine';
import { pdfTeksti } from './tekstinLuku.js';

/** Yhden tiliotelähteen tapahtumat (adapterin takana PDF/CSV/XML). */
export interface TilioteLahde {
  lueTiliote(): Promise<Tilitapahtuma[]>;
}

/**
 * Poimi tapahtumat monesta tiliotetekstistä yhdeksi listaksi (puhdas; delegoi poimiTiliotteet,
 * joka tunnistaa kuukausitiliotteen ja Tapahtumat-viennin).
 */
export function poimiKaikki(tekstit: readonly string[]): Tilitapahtuma[] {
  return tekstit.flatMap((t) => poimiTiliotteet(t).tapahtumat);
}

/** PDF-tilioteadapteri: pdf.js-tekstikerros → poimiTiliotteet (kuukausitiliote tai Tapahtumat-vienti). */
export function pdfTiliote(tavut: Uint8Array): TilioteLahde {
  return {
    async lueTiliote(): Promise<Tilitapahtuma[]> {
      const teksti = await pdfTeksti(tavut);
      return poimiTiliotteet(teksti).tapahtumat;
    },
  };
}
