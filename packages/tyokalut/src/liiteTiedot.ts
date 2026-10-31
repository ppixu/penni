import type { KpClient } from '@penni/asiakas';

/** Liitteen tiedot työkalujen tulosteeseen — ei koskaan itse tiedostodataa. */
export interface LiiteTieto {
  id: number;
  nimi: string;
  tyyppi: string;
  /** Koko tavuina. */
  koko: number;
  sha: string | null;
  luotu: string;
}

/**
 * Tositteen liitteet metatietoineen. Liitelistaus (LiiteMeta) ei kerro kokoa, joten koko
 * luetaan liitteen datasta; data itse ei päädy tulosteeseen. Tositteella on tyypillisesti
 * yksi tai muutama liite, joten erillinen haku per liite on halpa.
 */
export async function haeLiiteTiedot(client: KpClient, tosite: number): Promise<LiiteTieto[]> {
  const metat = await client.haeLiitteet(tosite);
  return Promise.all(
    metat.map(async (m) => {
      const liite = await client.haeLiite(m.id);
      return {
        id: m.id,
        nimi: m.nimi,
        tyyppi: m.tyyppi,
        koko: liite?.data.length ?? 0,
        sha: m.sha ?? null,
        luotu: m.luotu,
      };
    }),
  );
}
