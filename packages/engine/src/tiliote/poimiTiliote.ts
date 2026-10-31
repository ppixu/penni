import { type Cents, Euro } from '@penni/euro';
import type { IsoDate } from '../vouchers/types.js';

/** Korttioston alkuperäinen summa ostovaluutassa (esim. 'USD 6,26 GITHUB.COM'). */
export interface AlkuperainenSumma {
  /** ISO-valuuttakoodi, esim. 'USD' tai 'EUR'. */
  valuutta: string;
  /** Itseisarvo ostovaluutan sentteinä. */
  maara: Cents;
}

/** Yksi pankkitilin tapahtuma tiliotteelta. */
export interface Tilitapahtuma {
  pvm: IsoDate;
  nimi: string;
  /** Viitenumero tai RF-viite, jos rivillä on sellainen. */
  viite?: string;
  /** Etumerkillinen: negatiivinen = veloitus (raha ulos), positiivinen = hyvitys (raha sisään). */
  maara: Cents;
  /** Maksun viesti, jos tiliotteella on sellainen. */
  viesti?: string;
  /** Korttioston alkuperäinen valuuttasumma, jos tiliote kertoo sen. */
  alkuperainen?: AlkuperainenSumma;
}

// Tapahtumarivi: '<D.M.YYYY>  <nimi [viite]>  <-?rahamäärä>'. Rahamäärä (pilkkudesimaali) ankkuroi loppuun.
const RIVI = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(.+?)\s+(-?\d{1,3}(?:[ .]\d{3})*,\d{2})$/;
// Viite on nimen perässä oleva pääte: RF-viite tai vähintään 4-numeroinen luku.
const VIITE = /^(.*?)\s+(RF\d+|\d{4,})$/;

function tiivista(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** EU-muotoinen (pilkkudesimaali, väli tuhaterottimena) etumerkillinen rahamäärä → sentit. */
function euroon(merkkijono: string): Cents {
  return Euro.fromString(merkkijono.replace(/[ .]/g, ''));
}

/**
 * Poimii pankin "Tapahtumat"-viennin litteästä tekstistä tilitapahtumat.
 * Ohittaa otsikot, kuukausiväliotsikot ja yhteenvetorivit (vain päiväyksellä alkavat rivit).
 */
export function poimiTiliote(teksti: string): Tilitapahtuma[] {
  const tapahtumat: Tilitapahtuma[] = [];
  for (const raaka of teksti.split('\n')) {
    const m = RIVI.exec(tiivista(raaka));
    if (!m) continue;
    const [, d, kk, v, keski, summa] = m;
    const vm = VIITE.exec(keski ?? '');
    const t: Tilitapahtuma = {
      pvm: `${v}-${(kk ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}` as IsoDate,
      nimi: ((vm ? vm[1] : keski) ?? '').trim(),
      maara: euroon(summa ?? '0'),
    };
    if (vm?.[2]) t.viite = vm[2];
    tapahtumat.push(t);
  }
  return tapahtumat;
}
