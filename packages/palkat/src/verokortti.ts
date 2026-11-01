import type { IsoDate, PalkkaAjo } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { jasennaPvm } from './pvm.js';
import type { Verokortti } from './tyontekija.js';

/**
 * Verokortin valinta ja tulorajan kertymä.
 * Lähde: Ennakonpidätyksen toimittaminen, VH/7526/00.01.00/2025
 * (https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/48735/ennakonpidatyksen-toimittaminen11/).
 */

const voimassa = (k: Verokortti, pvm: IsoDate) => k.alkaa <= pvm && pvm <= k.paattyy;

/** Myöhemmin alkava kortti voittaa: muutosverokortti korvaa aiemman (VH/7526 §4.3.4). */
function uusin(kortit: readonly Verokortti[]): Verokortti | undefined {
  let paras: Verokortti | undefined;
  for (const k of kortit) if (!paras || k.alkaa >= paras.alkaa) paras = k;
  return paras;
}

/**
 * Maksupäivänä voimassa oleva verokortti. Tammikuun sääntö (VH/7526 §4.3.3): jos maksupäivän
 * kattavaa korttia ei ole ja maksu on tammikuussa, käytetään edellisen vuoden lopussa voimassa
 * ollutta korttia (`tammikuuSaanto: true`). Tammikuun maksu lasketaan silti uuden, 1.1. alkavan
 * kortin tulorajaan, kun se syötetään — `kertymaVerokortille` tekee sen päivämäärän perusteella.
 * Muuten null: pidätys 60 % (§6.1.1).
 */
export function valitseVerokortti(
  kortit: readonly Verokortti[],
  maksupaiva: IsoDate,
): { kortti: Verokortti; tammikuuSaanto: boolean } | null {
  const nyt = uusin(kortit.filter((k) => voimassa(k, maksupaiva)));
  if (nyt) return { kortti: nyt, tammikuuSaanto: false };
  const { v, k } = jasennaPvm(maksupaiva);
  if (k !== 1) return null;
  const vuodenVaihde = `${String(v - 1).padStart(4, '0')}-12-31`;
  const edellinen = uusin(kortit.filter((kortti) => voimassa(kortti, vuodenVaihde)));
  return edellinen ? { kortti: edellinen, tammikuuSaanto: true } : null;
}

/**
 * Kortin tulokertymä ennen tätä maksua: kortille merkitty `aiemminMaksettu` + tämän työntekijän
 * pidätysperusteet niistä palkka-ajoista, joiden maksupäivä osuu kortin voimassaoloaikaan
 * (tuloraja lasketaan kortin voimassaoloajalle, VH/7526 §4.3.2 ja §6.1.1).
 * Kutsuja jättää laskettavan ajon itse pois `aiemmat`-listasta (esim. muokattaessa).
 */
export function kertymaVerokortille(
  kortti: Verokortti,
  tyontekijaId: string,
  aiemmat: readonly { pvm: IsoDate; palkka: PalkkaAjo }[],
): Cents {
  let summa: number = kortti.aiemminMaksettu;
  for (const { pvm, palkka } of aiemmat) {
    if (!voimassa(kortti, pvm)) continue;
    for (const h of palkka.henkilot) {
      if (h.tyontekijaId === tyontekijaId) summa += h.tulos.pidatysperuste;
    }
  }
  return summa as Cents;
}
