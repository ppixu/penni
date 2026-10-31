import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Kirjanpito, jolla voi luoda ostolaskun (viittaus poiston suojaustestiin).
// Verbatim ostolaskut.$id.test.tsx:n seed — tunnetusti toimiva ostolaskun luontiin.
const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2871, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } },
    { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {
    Nimi: 'Demo Oy',
    AlvVelvollinen: 'true',
    OletusMenotili: '4000',
    OstoVelkaTili: '2871',
    AlvVelkaTili: '2939',
    LaskuMaksutili: '1900',
  },
};

describe('/kumppanit/$id', () => {
  it('esitäyttää ja päivittää kumppanin', async () => {
    let id = 0;
    const { user, client } = await renderRoute('/kumppanit/1', {
      seed: SEED,
      arrange: async (c: KpClient) => {
        id = (await c.tallennaKumppani({ nimi: 'Muokattava Oy', kaupunki: 'Vantaa' })).id;
      },
    });
    const nimikentta = await screen.findByLabelText('Nimi');
    expect(nimikentta).toHaveValue('Muokattava Oy');
    await user.clear(nimikentta);
    await user.type(nimikentta, 'Päivitetty Oy');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () => {
      const k = (await client.haeKumppanit()).find((x) => x.id === id);
      expect(k?.nimi).toBe('Päivitetty Oy');
    });
  });

  it('estää poiston kun kumppania käytetään laskulla', async () => {
    // Ostolasku viittaa kumppaniin suoraan (OstolaskuRivi.kumppani) → suojaus laukeaa.
    // Kumppani "Tukku Oy" on ensimmäinen luotu → id 1 → reitti /kumppanit/1 muokkaa juuri sitä.
    await renderRoute('/kumppanit/1', {
      seed: SEED,
      arrange: async (c: KpClient) => {
        const toimittaja = await c.tallennaKumppani({ nimi: 'Tukku Oy' });
        await c.tallennaOstolasku({
          pvm: '2026-05-01',
          erapvm: '2026-08-01',
          viite: 'V-1',
          kumppani: toimittaja.id,
          rivit: [{ myyntiKpl: 1, aNetto: 50, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
        });
      },
    });
    await screen.findByLabelText('Nimi');
    // findByText odottaa, että useOstolaskut({}) resolvoituu → viitattu=true → viesti renderöityy.
    expect(
      await screen.findByText('Kumppania käytetään laskuilla, ei voi poistaa'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Poista' })).toBeDisabled();
  });

  it('poistaa kumppanin vahvistuksen jälkeen kun ei viitata', async () => {
    const { user, client } = await renderRoute('/kumppanit/1', {
      seed: SEED,
      arrange: async (c: KpClient) => {
        await c.tallennaKumppani({ nimi: 'Poistettava Oy', kaupunki: 'Vantaa' });
      },
    });
    await screen.findByLabelText('Nimi');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Poista' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Poista' }));
    // Vahvistus
    await user.click(await screen.findByRole('button', { name: 'Poista kumppani' }));
    await waitFor(async () => expect(await client.haeKumppanit()).toHaveLength(0));
  });
});
