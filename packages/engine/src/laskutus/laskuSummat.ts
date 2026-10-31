import { type Cents, roundHalfAway } from '@penni/euro';
import { AlvKoodi } from '../alv/koodit.js';
import { nettoYhteensaCents } from '../vouchers/rivi.js';
import type { TositeRivi } from '../vouchers/types.js';

export interface AlvErittelyRivi {
  prosentti: number;
  vero: Cents;
}

export interface LaskuSummat {
  netto: Cents;
  /** Alv-erittely kannoittain, suurin kanta ensin (vain MYYNNIT_NETTO-rivit). */
  erittely: AlvErittelyRivi[];
  vero: Cents;
  brutto: Cents;
}

/**
 * Live-summat TÄSMÄLLEEN moottorin generoiLaskunViennit-algoritmilla: netto riveittäin
 * (nettoYhteensaCents), vero verokantaKORISSA yhdellä pyöristyksellä
 * (roundHalfAway(Σnetto × p / 100)) ja vain MYYNNIT_NETTO-riveille; nollasummaiset
 * rivit ohitetaan. Näin lomake, dokumentti ja kirjatut viennit eivät voi näyttää eri
 * summia. HUOM (poikkeama spesistä): rivikohtainen bruttoYhteensa − nettoYhteensaCents
 * voisi erota korisummasta sentillä — siksi kori, ei rivisumma.
 */
export function laskuSummat(rivit: readonly TositeRivi[]): LaskuSummat {
  let netto = 0;
  const korit = new Map<number, number>(); // alvProsentti -> Σnetto (snt)
  for (const r of rivit) {
    const rivinNetto = nettoYhteensaCents(r);
    if (rivinNetto === 0) continue;
    netto += rivinNetto;
    if (r.alvKoodi === AlvKoodi.MYYNNIT_NETTO) {
      korit.set(r.alvProsentti, (korit.get(r.alvProsentti) ?? 0) + rivinNetto);
    }
  }
  const erittely: AlvErittelyRivi[] = [];
  let vero = 0;
  for (const [prosentti, koriNetto] of korit) {
    const koriVero = roundHalfAway((koriNetto * prosentti) / 100);
    if (koriVero === 0) continue;
    vero += koriVero;
    erittely.push({ prosentti, vero: koriVero as Cents });
  }
  erittely.sort((a, b) => b.prosentti - a.prosentti);
  return {
    netto: netto as Cents,
    erittely,
    vero: vero as Cents,
    brutto: (netto + vero) as Cents,
  };
}
