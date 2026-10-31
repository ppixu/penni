import { type Tili, lataaKartta } from '@penni/engine';
import type { MemorySeed } from '@penni/storage-memory';
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** Leaf chart + open fiscal year + VAT-off — the minimal legal book the editor tests need. */
export const LEHTI_SIEMEN: MemorySeed = {
  tilit: [
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    { numero: 7800, tyyppi: 'D', nimi: { fi: 'Toimistotarvikkeet' } },
    { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Arvonlisäverosaatava' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false' },
};

/** The same chart, loaded to rich Tili[] for components that take `chart` as a prop. */
export const CHART: Tili[] = lataaKartta(LEHTI_SIEMEN.tilit ?? []);

/**
 * Pick an account on a 1-based grid row via the cmdk picker: open the combobox, type
 * `haku` (number or name) over the selected text, press Enter to accept the top match. Centralizes the cmdk
 * interaction so the screen tests stay readable.
 */
export async function valitseTili(user: UserEvent, rivi: number, haku: string): Promise<void> {
  const input = await screen.findByRole('combobox', {
    name: new RegExp(`Tili, rivi ${rivi}`, 'i'),
  });
  // Fokusointi valitsee kentän tekstin, joten kirjoitus korvaa esitäytetyn tilin (esim.
  // tasaavan rivin pankkitilin). Jo fokusoitua kenttää (Enter siirsi fokuksen) ei klikata:
  // klikkaus siirtäisi kursorin tekstin loppuun, kuten selaimessakin.
  if (document.activeElement !== input) await user.click(input);
  await user.keyboard(haku);
  await user.keyboard('{Enter}');
}
