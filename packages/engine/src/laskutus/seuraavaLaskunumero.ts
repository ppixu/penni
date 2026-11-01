import type { Asetukset, Storage } from '../resources/storage.js';

/**
 * Seuraava laskunumero yhteisestä `LaskuSeuraavaId`-sarjasta (myyntilasku ja myynnin hyvityslasku
 * jakavat saman sarjan, tositeroute.cpp:236-265). Palauttaa max(LaskuSeuraavaId, LaskuNumerointialkaa)
 * muuttamatta mitään: laskuri siirretään vasta, kun kirjaus on onnistunut (`kasvataLaskunumeroa`),
 * jotta hylätty kirjaus ei polta numeroa.
 */
export function lueSeuraavaLaskunumero(asetukset: Asetukset): string {
  const seuraava = Number(asetukset.LaskuSeuraavaId ?? '1') || 1;
  const alkaa = Number(asetukset.LaskuNumerointialkaa ?? '0') || 0;
  return String(Math.max(seuraava, alkaa));
}

/** Siirtää laskurin käytetyn numeron jälkeiseen: `LaskuSeuraavaId = numero + 1`. */
export async function kasvataLaskunumeroa(storage: Storage, numero: string): Promise<void> {
  await storage.patchAsetukset({ LaskuSeuraavaId: String(Number(numero) + 1) });
}
