import type { IsoDate } from '@penni/engine';
import { jasennaKuukausi, jasennaPvm, lisaaPaivia, muotoile, utc, viikonpaiva } from './pvm.js';

/**
 * Määräpäivät. Laki määräajan laskemisesta oikeustoimessa 150/1930 5 §: jos määräajan viimeinen
 * päivä on pyhäpäivä, itsenäisyyspäivä, vapunpäivä, joulu- tai juhannusaatto tai arkilauantai,
 * määräaika päättyy seuraavana arkipäivänä.
 */

/** Pääsiäissunnuntai (anonyymi gregoriaaninen algoritmi). */
function paasiainen(vuosi: number): Date {
  const a = vuosi % 19;
  const b = Math.floor(vuosi / 100);
  const c = vuosi % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const kuu = Math.floor((h + l - 7 * m + 114) / 31);
  const paiva = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(vuosi, kuu, paiva);
}

const VALI_VUOSI = new Map<number, IsoDate[]>();

/**
 * Vuoden pyhäpäivät ja muut päivät, joina määräaika ei pääty: uudenvuodenpäivä, loppiainen,
 * pitkäperjantai, pääsiäispäivä, 2. pääsiäispäivä, vapunpäivä, helatorstai, helluntaipäivä,
 * juhannusaatto (perjantai 19.-25.6.), juhannuspäivä, pyhäinpäivä, itsenäisyyspäivä,
 * jouluaatto, joulupäivä, tapaninpäivä. Viikonloppuun osuvat päivät ovat mukana; viikonloppuja
 * itsessään ei luetella. Lista on aikajärjestyksessä.
 */
export function pyhapaivat(vuosi: number): IsoDate[] {
  const valim = VALI_VUOSI.get(vuosi);
  if (valim) return [...valim];
  const p = paasiainen(vuosi);
  const ennen = (n: number) => {
    const d = new Date(p.getTime());
    d.setUTCDate(d.getUTCDate() + n);
    return muotoile(d);
  };
  const pad = (n: number) => String(n).padStart(2, '0');
  const kiintea = (k: number, pv: number) => `${vuosi}-${pad(k)}-${pad(pv)}`;

  // Juhannusaatto: perjantai väliltä 19.-25.6.
  let juhannusaatto = 19;
  while (utc(vuosi, 6, juhannusaatto).getUTCDay() !== 5) juhannusaatto++;
  // Pyhäinpäivä: lauantai väliltä 31.10.-6.11.
  let pyhainpaiva = utc(vuosi, 10, 31);
  while (pyhainpaiva.getUTCDay() !== 6) pyhainpaiva = utc(vuosi, 10, pyhainpaiva.getUTCDate() + 1);

  const lista = [
    kiintea(1, 1),
    kiintea(1, 6),
    ennen(-2), // pitkäperjantai
    ennen(0), // pääsiäispäivä
    ennen(1), // 2. pääsiäispäivä
    kiintea(5, 1),
    ennen(39), // helatorstai
    ennen(49), // helluntaipäivä
    kiintea(6, juhannusaatto),
    kiintea(6, juhannusaatto + 1), // juhannuspäivä
    muotoile(pyhainpaiva),
    kiintea(12, 6),
    kiintea(12, 24),
    kiintea(12, 25),
    kiintea(12, 26),
  ].sort();
  VALI_VUOSI.set(vuosi, lista);
  return [...lista];
}

function onArkipaiva(pvm: IsoDate): boolean {
  const vp = viikonpaiva(pvm);
  if (vp === 0 || vp === 6) return false;
  return !pyhapaivat(jasennaPvm(pvm).v).includes(pvm);
}

/** Päivä itse, jos se on arkipäivä; muuten seuraava arkipäivä. */
export function seuraavaArkipaiva(pvm: IsoDate): IsoDate {
  let d = pvm;
  while (!onArkipaiva(d)) d = lisaaPaivia(d, 1);
  return d;
}

/** Palkkatietoilmoitus: viidentenä kalenteripäivänä maksupäivästä; päivälaskenta + seuraava arkipäivä. */
export function palkkatietoilmoituksenMaarapaiva(maksupaiva: IsoDate): IsoDate {
  return seuraavaArkipaiva(lisaaPaivia(maksupaiva, 5));
}

function seuraavanKuunPaiva(kuukausi: string, paiva: number): IsoDate {
  const { v, k } = jasennaKuukausi(kuukausi);
  const pad = (n: number) => String(n).padStart(2, '0');
  const [vv, kk] = k === 12 ? [v + 1, 1] : [v, k + 1];
  return `${vv}-${pad(kk)}-${pad(paiva)}`;
}

/** Työnantajan erillisilmoitus (maksukuukausi 'VVVV-KK'): seuraavan kuun 5. päivä. */
export function erillisilmoituksenMaarapaiva(kuukausi: string): IsoDate {
  return seuraavaArkipaiva(seuraavanKuunPaiva(kuukausi, 5));
}

/** Oma-aloitteisten verojen (ennakonpidätys, sava) eräpäivä: seuraavan kuun 12. päivä. */
export function omaVeroEraPaiva(kuukausi: string): IsoDate {
  return seuraavaArkipaiva(seuraavanKuunPaiva(kuukausi, 12));
}
