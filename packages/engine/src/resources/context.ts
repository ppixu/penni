import type { Tili } from '../accounts/tili.js';
import type { ValidationContext } from '../validation/tarkasta.js';
import type { IsoDate } from '../vouchers/types.js';
import { kirjanpidonAlkaa, kirjanpidonLoppuu } from './numbering.js';
import type { Asetukset, ResourceEnv, Storage, Tilikausi } from './storage.js';

/**
 * Totuusarvoisen asetuksen tulkinta. Penni tallentaa 'true'/'false', mutta Kitsasista tuodut
 * kirjat tallentavat totuusarvot muodossa 'ON'/'EI' (AsetusModel::aseta(bool),
 * asetusmodel.cpp:127-133) — molemmat tunnistetaan. Muut arvot ('false', 'EI', '0', '',
 * puuttuva) ovat epätosia.
 */
export function asetusPaalla(arvo: string | undefined): boolean {
  return arvo === 'true' || arvo === '1' || arvo === 'ON';
}

/** Mirrors Kirjanpito::onkoAlvVelvollinen (kirjanpito.cpp:206-216). */
export function onkoAlvVelvollinen(asetukset: Asetukset, pvm: IsoDate): boolean {
  if (!asetusPaalla(asetukset.AlvVelvollinen)) return false;
  const alkaa = asetukset.AlvAlkaa;
  const loppuu = asetukset.AlvLoppuu;
  if (alkaa && alkaa > pvm) return false;
  if (loppuu && loppuu < pvm) return false;
  return true;
}

/**
 * Mirrors Kirjanpito::onkoMaksuperusteinenAlv (kirjanpito.cpp:218-228): the book uses
 * cash-basis VAT for a given date iff it is VAT-liable and the date is in the half-open
 * window [MaksuAlvAlkaa, MaksuAlvLoppuu). ISO dates compare lexicographically.
 */
export function onkoMaksuperusteinenAlv(asetukset: Asetukset, pvm: IsoDate): boolean {
  if (!asetusPaalla(asetukset.AlvVelvollinen)) return false;
  const alkaa = asetukset.MaksuAlvAlkaa;
  if (alkaa == null || alkaa === '' || alkaa > pvm) return false;
  const loppuu = asetukset.MaksuAlvLoppuu;
  if (loppuu != null && loppuu !== '' && loppuu <= pvm) return false;
  return true;
}

/**
 * Pure part of the ValidationContext build: the same context from already-loaded master data.
 * Callers that only hold a client (not a Storage) — e.g. the agent tools' draft check — use this
 * so their validation matches the finalize path exactly. `onkoAlvIlmoitettu` omitted falls back
 * to the book's `AlvIlmoitettu` setting, as in rakennaValidointiKonteksti.
 */
export function muodostaValidointiKonteksti(
  chart: readonly Tili[],
  kaudet: readonly Tilikausi[],
  asetukset: Asetukset,
  onkoAlvIlmoitettu?: (pvm: IsoDate) => boolean,
): ValidationContext {
  const alkaa = kirjanpidonAlkaa(kaudet);
  const loppuu = kirjanpidonLoppuu(kaudet);
  const tilitPaatetty = asetukset.TilitPaatetty ?? null;
  return {
    kausiAlkaa: alkaa ?? '9999-12-31', // empty book: nothing is in an open period
    kausiLoppuu: loppuu ?? '0000-01-01',
    tilitPaatetty,
    chart,
    onkoAlvIlmoitettu:
      onkoAlvIlmoitettu ??
      ((pvm: IsoDate) => asetukset.AlvIlmoitettu != null && pvm <= asetukset.AlvIlmoitettu),
    onkoAlvVelvollinen: (pvm) => onkoAlvVelvollinen(asetukset, pvm),
  };
}

/** Build a Tier-0 ValidationContext from storage + env. */
export async function rakennaValidointiKonteksti(
  storage: Storage,
  env: ResourceEnv,
): Promise<ValidationContext> {
  const [chart, kaudet, asetukset] = await Promise.all([
    storage.getChart(),
    storage.getTilikaudet(),
    storage.getAsetukset(),
  ]);
  return muodostaValidointiKonteksti(chart, kaudet, asetukset, env.onkoAlvIlmoitettu);
}
