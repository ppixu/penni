import type { KpClient } from '@penni/asiakas';
import { avaaErikseen } from './avaaErikseen.js';

/**
 * Hakee liitteen tavudatan ja avaa sen erikseen. Avaamisen tekee `avaaErikseen`, joka
 * avaa vain PDF:n ja kuvat uuteen ikkunaan ja lataa muut tiedostona — blob-URL perii
 * sovelluksen originin, joten tallennetulla tyypillä avattu liite voisi muuten ajaa
 * skriptiä sovelluksen nimissä. Palauttaa virheviestin tai null.
 */
export async function avaaLiiteErikseen(client: KpClient, liiteId: number): Promise<string | null> {
  try {
    const liite = await client.haeLiite(liiteId);
    if (!liite) return 'Liitettä ei löytynyt.';
    avaaErikseen(liite);
    return null;
  } catch {
    return 'Liitteen avaaminen epäonnistui.';
  }
}
