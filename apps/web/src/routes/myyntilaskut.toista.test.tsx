import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {
    Nimi: 'Demo Oy',
    AlvVelvollinen: 'false',
    OletusMyyntitili: '3000',
    LaskuSaatavaTili: '1701',
    LaskuIban: 'FI2112345600000785',
  },
};

async function kirjattuLasku(c: KpClient) {
  const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
  await c.tallennaMyyntilasku({
    pvm: '2026-06-01',
    erapvm: '2026-06-15',
    kumppani: asiakas.id,
    rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0 }],
  });
}

describe('Toista-toiminto laskunäkymässä', () => {
  it('kirjatulla myyntilaskulla Toista luo toiston ja siirtyy Toistuvat laskut -listaan', async () => {
    const { user, client, router } = await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: kirjattuLasku,
    });
    await user.click(await screen.findByRole('button', { name: 'Toista' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Toista lasku' });
    // Oletus: kuukausittain, ensimmäinen päivä laskupvm + 1 kk.
    expect(screen.getByLabelText('Seuraava laskupäivä')).toHaveValue('2026-07-01');
    expect(dialogi).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Luo toisto' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/toistot'));
    const [toisto] = await client.haeToistot();
    expect(toisto).toMatchObject({ lahdeTosite: 1, kuukausia: 1, seuraava: '2026-07-01' });
    // Reitin tila vaihtuu ennen kuin Toistuvat laskut -sivu (lazy-chunk) on piirretty, ja vanha
    // laskunäkymä näyttää hetken saman asiakasnimen. Odota ensin uuden sivun oma elementti,
    // muuten findByText voi osua vanhan sivun nimeen, joka irtoaa DOMista ennen väitettä.
    await screen.findByRole('button', { name: 'Luo erääntyneet nyt' });
    expect(await screen.findByText('Asiakas Oy')).toBeInTheDocument();
  });

  it('rivittömällä (tuodulla) laskulla Toista on estetty syyn kera', async () => {
    await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-06-01',
          erapvm: '2026-06-15',
          tyyppi: 210,
          sarja: '',
          tila: 100,
          numero: '1',
          rivit: [],
          viennit: [],
        });
      },
    });
    const nappi = await screen.findByRole('button', { name: 'Toista' });
    expect(nappi).toBeDisabled();
    expect(nappi).toHaveAttribute('title', expect.stringContaining('ei ole rivejä'));
  });

  it('Peruuta sulkee dialogin luomatta toistoa', async () => {
    const { user, client } = await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: kirjattuLasku,
    });
    await user.click(await screen.findByRole('button', { name: 'Toista' }));
    await user.click(await screen.findByRole('button', { name: 'Peruuta' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await client.haeToistot()).toEqual([]);
  });

  it('luonnoksella ei ole Toista-nappia (toisto vaatii kirjatun laskun)', async () => {
    await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.tallennaMyyntilasku({
          pvm: '2026-06-01',
          luonnos: true,
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0 }],
        });
      },
    });
    await screen.findByRole('button', { name: 'Kirjaa ja lataa PDF' });
    expect(screen.queryByRole('button', { name: 'Toista' })).not.toBeInTheDocument();
  });

  it('hyvityslaskulla ei ole Toista-nappia', async () => {
    await renderRoute('/myyntilaskut/2', {
      seed: SEED,
      arrange: async (c) => {
        await kirjattuLasku(c);
        await c.tallennaHyvityslasku({ alkuperainenTosite: 1, pvm: '2026-06-02' });
      },
    });
    await screen.findByRole('button', { name: 'Lataa PDF' });
    expect(screen.queryByRole('button', { name: 'Toista' })).not.toBeInTheDocument();
  });
});
