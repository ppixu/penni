import type { Liitevarasto } from '@penni/storage-sqlite-core';

/** R2-avain liitteen tavuille: `kirja/<kirjaId>/liite/<sha256>` (sisältöosoitteinen, per kirja). */
export function liiteAvain(kirjaId: string, sha256: string): string {
  return `kirja/${kirjaId}/liite/${sha256}`;
}

/**
 * Liitevarasto R2-bucketin päälle. Avain on sisältöosoitteinen, joten saman sisällön toinen
 * tallennus samaan kirjaan ei lähetä tavuja uudelleen (head-tarkistus). R2 tarkistaa itse, että
 * tavut vastaavat `sha256`-arvoa (put-valinta), joten bitti kerrallaan väärä sisältö ei tallennu.
 * Objekteja ei poisteta koskaan tässä: sama avain voi olla usean liitteen takana ja soft delete
 * jättää rivin eloon (spike; roskienkeruu on jatkotyötä).
 */
export function luoR2Liitevarasto(bucket: R2Bucket, kirjaId: string): Liitevarasto {
  return {
    async tallenna(sha256, data) {
      const avain = liiteAvain(kirjaId, sha256);
      if (!(await bucket.head(avain))) {
        await bucket.put(avain, data, { sha256 });
      }
      return avain;
    },
    async hae(avain) {
      const objekti = await bucket.get(avain);
      return objekti ? new Uint8Array(await objekti.arrayBuffer()) : null;
    },
  };
}
