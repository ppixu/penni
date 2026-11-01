import { type BudjettiRivi, validoiBudjetti } from '../kohdennukset/budjetti.js';
import {
  type Kohdennus,
  type KohdennusKaytolla,
  KohdennusTyyppi,
  type UusiKohdennus,
  normalisoiKohdennus,
  validoiKohdennus,
} from '../kohdennukset/kohdennus.js';
import type { IsoDate } from '../vouchers/types.js';
import { ResourceError, type Storage } from './storage.js';

/** Kohdennukset käyttömäärineen (Kitsasin lkm + mlkm). */
export async function haeKohdennukset(storage: Storage): Promise<KohdennusKaytolla[]> {
  const [kohdennukset, kaytto] = await Promise.all([
    storage.getKohdennukset(),
    storage.laskeKohdennustenKaytto(),
  ]);
  return kohdennukset.map((k) => ({ ...k, lkm: kaytto.get(k.id) ?? 0 }));
}

/** Onko kohdennuksella budjettirivejä jollakin tilikaudella. */
async function onBudjetoitu(storage: Storage, id: number): Promise<boolean> {
  const kaudet = await storage.getTilikaudet();
  const budjetit = await Promise.all(kaudet.map((k) => storage.getBudjetti(k.alkaa)));
  return budjetit.some((rivit) => rivit.some((r) => r.kohdennus === id));
}

/**
 * Normalisoi, tarkista ja tallenna (luonti tai päivitys). Budjetoidun kohdennuksen tyyppiä ei
 * voi vaihtaa: merkkaukselle ei voi budjetoida, ja kustannuspaikan ja projektin välillä budjetin
 * kokoava rakenne muuttuisi.
 */
export async function tallennaKohdennus(storage: Storage, k: UusiKohdennus): Promise<Kohdennus> {
  const siisti = normalisoiKohdennus(k);
  const kaikki = await storage.getKohdennukset();
  validoiKohdennus(siisti, kaikki);
  const vanha = siisti.id !== undefined ? kaikki.find((x) => x.id === siisti.id) : undefined;
  if (vanha && vanha.tyyppi !== siisti.tyyppi && (await onBudjetoitu(storage, vanha.id)))
    throw new ResourceError(
      'KOHDENNUSTYYPPI',
      'Kohdennuksella on budjetti, eikä sen tyyppiä voi vaihtaa',
    );
  return storage.saveKohdennus(siisti);
}

/**
 * Poista kohdennus ja sen budjettirivit. Estetty, kun kohdennusta käytetään viennin kohdennuksena
 * tai merkkauksena jollakin poistamattomalla tositteella (maaritys/kohdennusmuokkaus.cpp:87-91)
 * tai kun sen alla on projekteja (Kitsasin kuuluu RESTRICT).
 */
export async function poistaKohdennus(storage: Storage, id: number): Promise<void> {
  const [kohdennukset, kaytto] = await Promise.all([
    storage.getKohdennukset(),
    storage.laskeKohdennustenKaytto(),
  ]);
  const lkm = kaytto.get(id) ?? 0;
  if (lkm > 0)
    throw new ResourceError(
      'KOHDENNUSKAYTOSSA',
      `Kohdennusta käytetään ${lkm} kirjauksessa, eikä sitä voi poistaa`,
    );
  if (kohdennukset.some((k) => k.tyyppi === KohdennusTyyppi.PROJEKTI && k.kuuluu === id))
    throw new ResourceError(
      'KOHDENNUSPROJEKTEJA',
      'Kustannuspaikalla on projekteja, eikä sitä voi poistaa',
    );
  await storage.deleteKohdennus(id);
}

export async function haeBudjetti(storage: Storage, tilikausi: IsoDate): Promise<BudjettiRivi[]> {
  return storage.getBudjetti(tilikausi);
}

/** Korvaa tilikauden budjetti kokonaan. Lukittunkin kauden budjettia saa muokata: budjetti ei
 *  ole osa kirjanpitoa. */
export async function tallennaBudjetti(
  storage: Storage,
  tilikausi: IsoDate,
  rivit: BudjettiRivi[],
): Promise<void> {
  const [kaudet, chart, kohdennukset] = await Promise.all([
    storage.getTilikaudet(),
    storage.getChart(),
    storage.getKohdennukset(),
  ]);
  if (!kaudet.some((k) => k.alkaa === tilikausi))
    throw new ResourceError('EITILIKAUTTA', `Tilikautta ${tilikausi} ei ole`);
  validoiBudjetti(rivit, chart, kohdennukset);
  await storage.putBudjetti(tilikausi, rivit);
}
