import { merkitsevatSanat, normalisoiNimi } from '../tiliote/nimi.js';
import type { Kumppani } from './kumppani.js';

/**
 * Kumppanin nimi vertailumuodossa: merkitsevät sanat (yritysmuodot ja välimerkit pois), tai
 * lyhyelle nimelle ("EA", "X") koko normalisoitu nimi. null = nimi ei ole vertailukelpoinen.
 */
function nimenSanat(nimi: string): { sanat: string[]; lyhyt: boolean } | null {
  const sanat = merkitsevatSanat(nimi);
  if (sanat.length > 0) return { sanat, lyhyt: false };
  const normalisoitu = normalisoiNimi(nimi);
  // Pelkkä yleissana ("Inc", "Oy") ei nimeä ketään.
  return normalisoitu.length > 0 && normalisoitu.length < 3
    ? { sanat: [normalisoitu], lyhyt: true }
    : null;
}

/** Montako sanaa kumppanin nimestä täsmää otsikon alkuun (0 = ei täsmää). */
function alkuosuma(otsikko: string, kumppani: string): number {
  const k = nimenSanat(kumppani);
  if (!k) return 0;
  // Lyhyt nimi verrataan koko otsikkoon sanarajalla, koska merkitsevät sanat jättävät sen pois.
  const o = k.lyhyt ? normalisoiNimi(otsikko).split(' ') : merkitsevatSanat(otsikko);
  return k.sanat.every((sana, i) => o[i] === sana) ? k.sanat.length : 0;
}

/**
 * Kumppani, jonka nimellä `nimi` alkaa (kirjoitusasusta ja yritysmuodosta riippumatta):
 * "Cursor Pro" ja "GITHUB, INC." → Cursor ja Github. Nimen keskeltä ei täsmätä. Useasta
 * osumasta voittaa pisin nimi ("Rajala Proshop" ennen "Proshopia"), sitten pienin id, jotta
 * sama tosite päätyy aina samalle kumppanille.
 */
export function etsiKumppaniNimella(
  nimi: string,
  kumppanit: readonly Kumppani[],
): Kumppani | undefined {
  let paras: { k: Kumppani; pituus: number } | undefined;
  for (const k of kumppanit) {
    const pituus = alkuosuma(nimi, k.nimi);
    if (
      pituus > 0 &&
      (paras === undefined ||
        pituus > paras.pituus ||
        (pituus === paras.pituus && k.id < paras.k.id))
    )
      paras = { k, pituus };
  }
  return paras?.k;
}

/**
 * Tositteen kumppani: tallennettu `kumppani`, tai sen puuttuessa otsikon perusteella
 * tunnistettu (etsiKumppaniNimella). Kitsakselta tuoduilla tositteilla kumppani on aina
 * tallennettu; Pennissä luotuihin se on voinut jäädä puuttumaan.
 */
export function tositteenKumppani(
  tosite: { kumppani?: number | undefined; otsikko?: string | undefined },
  kumppanit: readonly Kumppani[],
): number | undefined {
  if (tosite.kumppani !== undefined) return tosite.kumppani;
  return tosite.otsikko === undefined
    ? undefined
    : etsiKumppaniNimella(tosite.otsikko, kumppanit)?.id;
}
