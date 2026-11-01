import type { TiliData } from '../accounts/tili.js';
import type { Liite, LiiteMeta, UusiLiite } from '../liitteet/liite.js';
import type { Kumppani, UusiKumppani } from '../partners/kumppani.js';
import type { IsoDate } from '../vouchers/types.js';
import type { Asetukset, InitBundle, InitPatch, Storage, Tilikausi } from './storage.js';

export async function haeInit(storage: Storage): Promise<InitBundle> {
  return storage.getInit();
}

export async function paivitaInit(storage: Storage, patch: InitPatch): Promise<void> {
  await storage.patchInit(patch);
}

export async function putTili(storage: Storage, numero: number, data: TiliData): Promise<void> {
  await storage.putTili(numero, data);
}

/** Poista tilikartan rivi. Lehtitilin (taso 0) budjettirivit poistetaan kaikilta tilikausilta
 *  (Kitsas Budjetti.tili ON DELETE CASCADE, sqlite/luo.sql:49), jottei budjettiin jää riviä,
 *  jota budjettisivu ei näytä eikä tallennus hyväksy. */
export async function poistaTili(storage: Storage, numero: number, taso = 0): Promise<void> {
  await storage.deleteTili(numero, taso);
  if (taso !== 0) return;
  for (const kausi of await storage.getTilikaudet()) {
    const rivit = await storage.getBudjetti(kausi.alkaa);
    if (rivit.some((r) => r.tili === numero))
      await storage.putBudjetti(
        kausi.alkaa,
        rivit.filter((r) => r.tili !== numero),
      );
  }
}

export async function haeTilikaudet(storage: Storage): Promise<Tilikausi[]> {
  return storage.getTilikaudet();
}

export async function putTilikausi(
  storage: Storage,
  alkaa: IsoDate,
  kausi: Tilikausi,
): Promise<void> {
  await storage.putTilikausi(alkaa, kausi);
}

/** Poista tilikausi ja sen budjetti (budjetti on tilikauden tietoa; samalle päivälle myöhemmin
 *  luotu kausi alkaa tyhjällä budjetilla). */
export async function poistaTilikausi(storage: Storage, alkaa: IsoDate): Promise<void> {
  await storage.deleteTilikausi(alkaa);
  await storage.putBudjetti(alkaa, []);
}

export async function haeKumppanit(storage: Storage): Promise<Kumppani[]> {
  return storage.getKumppanit();
}

export async function tallennaKumppani(
  storage: Storage,
  kumppani: UusiKumppani,
): Promise<Kumppani> {
  return storage.saveKumppani(kumppani);
}

export async function poistaKumppani(storage: Storage, id: number): Promise<void> {
  await storage.deleteKumppani(id);
}

export async function haeLiitteet(storage: Storage, tosite: number): Promise<LiiteMeta[]> {
  return storage.getLiitteet(tosite);
}

export async function haeLiite(storage: Storage, id: number): Promise<Liite | null> {
  return storage.getLiite(id);
}

export async function tallennaLiite(storage: Storage, liite: UusiLiite): Promise<LiiteMeta> {
  return storage.saveLiite(liite);
}

export async function poistaLiite(storage: Storage, id: number): Promise<void> {
  await storage.deleteLiite(id);
}

export async function haeAsetukset(storage: Storage): Promise<Asetukset> {
  return storage.getAsetukset();
}

export async function paivitaAsetukset(storage: Storage, patch: Asetukset): Promise<void> {
  await storage.patchAsetukset(patch);
}
