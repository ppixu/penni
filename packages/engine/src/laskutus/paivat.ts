import { siirraPaivia } from '../tiliote/tyolista.js';
import type { IsoDate } from '../vouchers/types.js';

const PAIVA_MS = 86_400_000;

function osat(pvm: IsoDate): [number, number, number] {
  const [v, kk, d] = pvm.split('-').map((x) => Number.parseInt(x, 10));
  return [v ?? 0, kk ?? 1, d ?? 1];
}

function kuukaudenPituus(vuosi: number, kk: number): number {
  return new Date(Date.UTC(vuosi, kk, 0)).getUTCDate();
}

function iso(vuosi: number, kk: number, d: number): IsoDate {
  return new Date(Date.UTC(vuosi, kk - 1, d)).toISOString().slice(0, 10);
}

/** ISO-päiväys siirrettynä `n` päivää (negatiivinen = taaksepäin). */
export const lisaaPaivia: (pvm: IsoDate, n: number) => IsoDate = siirraPaivia;

/** Kokonaisten päivien ero `b − a` (UTC). */
export function paivienEro(a: IsoDate, b: IsoDate): number {
  const [av, ak, ad] = osat(a);
  const [bv, bk, bd] = osat(b);
  return Math.round((Date.UTC(bv, bk - 1, bd) - Date.UTC(av, ak - 1, ad)) / PAIVA_MS);
}

/**
 * Siirtää päiväystä `kk` kuukautta. Kuun viimeinen päivä pysyy kuun viimeisenä päivänä;
 * muuten päivä rajataan kohdekuukauden pituuteen (31.1. + 1 kk = 28.2.).
 */
export function siirraKuukausia(pvm: IsoDate, kk: number): IsoDate {
  const [v, k, d] = osat(pvm);
  const kuukausiNumero = v * 12 + (k - 1) + kk;
  const kohdeVuosi = Math.floor(kuukausiNumero / 12);
  const kohdeKk = (((kuukausiNumero % 12) + 12) % 12) + 1;
  const kuukaudenLoppu = d === kuukaudenPituus(v, k);
  const kohdePituus = kuukaudenPituus(kohdeVuosi, kohdeKk);
  return iso(kohdeVuosi, kohdeKk, kuukaudenLoppu ? kohdePituus : Math.min(d, kohdePituus));
}

/**
 * Siirtää eräpäivän seuraavaan pankkipäivään: ohittaa la/su, 1.1., 6.1., 1.5., 6.12. ja
 * 24.–26.12. (Kitsas: model/lasku.cpp:120-130 Lasku::oikaiseErapaiva).
 */
export function oikaiseErapaiva(pvm: IsoDate): IsoDate {
  let nyt = pvm;
  for (;;) {
    const [v, kk, d] = osat(nyt);
    const viikonpaiva = new Date(Date.UTC(v, kk - 1, d)).getUTCDay(); // 0 = su, 6 = la
    const vapaa =
      viikonpaiva === 0 ||
      viikonpaiva === 6 ||
      (d === 1 && kk === 1) ||
      (d === 6 && kk === 1) ||
      (d === 1 && kk === 5) ||
      (d === 6 && kk === 12) ||
      (kk === 12 && d >= 24 && d <= 26);
    if (!vapaa) return nyt;
    nyt = lisaaPaivia(nyt, 1);
  }
}

/** Vuoden pituus päivinä annetun päiväyksen vuodelle (366 karkausvuonna). */
export function paiviaVuodessa(pvm: IsoDate): 365 | 366 {
  return kuukaudenPituus(osat(pvm)[0], 2) === 29 ? 366 : 365;
}
