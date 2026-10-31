import type { Asetukset, Storage } from '../resources/storage.js';

/**
 * Seuraava laskunumero yhteisestä `LaskuSeuraavaId`-sarjasta (myyntilasku ja myynnin hyvityslasku
 * jakavat saman sarjan, tositeroute.cpp:236-265). Palauttaa max(LaskuSeuraavaId, LaskuNumerointialkaa)
 * ja siirtää laskurin yhtä eteenpäin.
 */
export async function seuraavaLaskunumero(storage: Storage, asetukset: Asetukset): Promise<string> {
  const seuraava = Number(asetukset.LaskuSeuraavaId ?? '1') || 1;
  const alkaa = Number(asetukset.LaskuNumerointialkaa ?? '0') || 0;
  const numeroInt = Math.max(seuraava, alkaa);
  await storage.patchAsetukset({ LaskuSeuraavaId: String(numeroInt + 1) });
  return String(numeroInt);
}
