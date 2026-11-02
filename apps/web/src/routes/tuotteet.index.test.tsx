import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 3100, tyyppi: 'CL', nimi: { fi: 'Palvelumyynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy', OletusMyyntitili: '3000', AlvVelvollinen: 'true' },
};

async function tuotteet(c: KpClient) {
  await c.tallennaTuote({
    nimike: 'Konsultointi',
    koodi: 'KON-1',
    unKoodi: 'HUR',
    aNetto: 80.5,
    alvKoodi: 11,
    alvProsentti: 25.5,
    tili: 3100,
  });
  await c.tallennaTuote({
    nimike: 'Äänityö',
    aNetto: 10,
    alvKoodi: 11,
    alvProsentti: 25.5,
    nimi: { fi: 'Äänityö', sv: 'Ljudarbete' },
  });
  await c.tallennaTuote({
    nimike: 'Asennus',
    koodi: 'ASE',
    aNetto: 50,
    alvKoodi: 11,
    alvProsentti: 25.5,
  });
}

afterEach(() => vi.restoreAllMocks());

function rivinNimet(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]?.textContent ?? '');
}

describe('Tuotteet-lista', () => {
  it('näyttää tuotteet suomalaisessa aakkosjärjestyksessä hintoineen', async () => {
    await renderRoute('/tuotteet', { seed: SEED, arrange: tuotteet });
    await screen.findByText('Konsultointi');
    // Suomen aakkosissa ä on z:n jälkeen.
    expect(rivinNimet()).toEqual(['Asennus', 'Konsultointi', 'Äänityö']);
    const rivi = screen.getByText('Konsultointi').closest('tr');
    if (!rivi) throw new Error('rivi puuttuu');
    expect(within(rivi).getByText('80,50')).toBeInTheDocument();
    expect(within(rivi).getByText('KON-1')).toBeInTheDocument();
    expect(within(rivi).getByText(/25,5 %/)).toBeInTheDocument();
  });

  it('haku suodattaa nimikkeellä ja tuotekoodilla kirjainkoosta riippumatta', async () => {
    const { user } = await renderRoute('/tuotteet', { seed: SEED, arrange: tuotteet });
    await screen.findByText('Konsultointi');
    const haku = screen.getByLabelText('Hae tuotteita');
    await user.type(haku, 'KONS');
    expect(rivinNimet()).toEqual(['Konsultointi']);
    await user.clear(haku);
    await user.type(haku, 'ase');
    expect(rivinNimet()).toEqual(['Asennus']);
    await user.clear(haku);
    await user.type(haku, 'xyz');
    expect(await screen.findByText(/Ei hakua vastaavia tuotteita/)).toBeInTheDocument();
  });

  it('tyhjä lista kertoo, mihin tuotteita käytetään', async () => {
    await renderRoute('/tuotteet', { seed: SEED });
    expect(await screen.findByText(/Ei tuotteita/)).toBeInTheDocument();
  });

  it('Uusi tuote: bruttohinta tallentuu nettona, tili oletuksena OletusMyyntitili', async () => {
    const { user, client } = await renderRoute('/tuotteet', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: '+ Uusi tuote' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Uusi tuote' });
    expect(within(dialogi).getByLabelText('Tili')).toHaveValue('3000');
    await user.type(within(dialogi).getByLabelText('Nimike'), 'Työtunti');
    await user.click(within(dialogi).getByLabelText('Hinta sisältää alv:n'));
    await user.type(within(dialogi).getByLabelText('Hinta'), '125,50');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText('Työtunti')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Uusi tuote' })).not.toBeInTheDocument();
    const [t] = await client.haeTuotteet();
    expect(t).toMatchObject({
      nimike: 'Työtunti',
      aNetto: 100,
      alvKoodi: 11,
      alvProsentti: 25.5,
      tili: 3000,
    });
  });

  it('nettohinta tallentuu sellaisenaan', async () => {
    const { user, client } = await renderRoute('/tuotteet', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: '+ Uusi tuote' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Uusi tuote' });
    await user.type(within(dialogi).getByLabelText('Nimike'), 'Osa');
    await user.type(within(dialogi).getByLabelText('Hinta'), '12,345');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    await screen.findByText('Osa');
    expect((await client.haeTuotteet())[0]?.aNetto).toBe(12.345);
  });

  it('nimike on pakollinen', async () => {
    const { user, client } = await renderRoute('/tuotteet', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: '+ Uusi tuote' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Uusi tuote' });
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    expect(await within(dialogi).findByRole('alert')).toHaveTextContent('Anna nimike');
    expect(await client.haeTuotteet()).toHaveLength(0);
  });

  it('yksikkö: UN-koodi ja vapaa yksikkö ovat toisensa poissulkevia', async () => {
    const { user, client } = await renderRoute('/tuotteet', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: '+ Uusi tuote' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Uusi tuote' });
    await user.type(within(dialogi).getByLabelText('Nimike'), 'Vuokra');
    const yksikko = within(dialogi).getByLabelText('Yksikkö');
    await user.selectOptions(yksikko, 'HUR');
    expect(within(dialogi).queryByLabelText('Oma yksikkö')).not.toBeInTheDocument();
    await user.selectOptions(yksikko, 'muu');
    await user.type(within(dialogi).getByLabelText('Oma yksikkö'), 'vuorokausi');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    await screen.findByText('Vuokra');
    const t = (await client.haeTuotteet())[0];
    expect(t).toMatchObject({ yksikko: 'vuorokausi' });
    expect(t).not.toHaveProperty('unKoodi');
  });

  it('Muokkaa näyttää nettohinnan ja säilyttää tuntemattomat avaimet', async () => {
    const { user, client } = await renderRoute('/tuotteet', { seed: SEED, arrange: tuotteet });
    const rivi = (await screen.findByText('Äänityö')).closest('tr');
    if (!rivi) throw new Error('rivi puuttuu');
    await user.click(within(rivi).getByRole('button', { name: 'Muokkaa' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Muokkaa tuotetta' });
    expect(within(dialogi).getByLabelText('Hinta')).toHaveValue('10');
    const nimike = within(dialogi).getByLabelText('Nimike');
    await user.clear(nimike);
    await user.type(nimike, 'Äänityö 2');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    await screen.findByText('Äänityö 2');
    const kaikki = await client.haeTuotteet();
    expect(kaikki).toHaveLength(3);
    expect(kaikki.find((t) => t.nimike === 'Äänityö 2')).toMatchObject({
      aNetto: 10,
      nimi: { fi: 'Äänityö', sv: 'Ljudarbete' },
    });
  });

  it('Poista kysyy vahvistuksen ja poistaa tuotteen aina', async () => {
    const { user, client } = await renderRoute('/tuotteet', { seed: SEED, arrange: tuotteet });
    const poista = vi.spyOn(client, 'poistaTuote');
    const rivi = (await screen.findByText('Asennus')).closest('tr');
    if (!rivi) throw new Error('rivi puuttuu');
    await user.click(within(rivi).getByRole('button', { name: 'Poista' }));
    const vahvistus = await screen.findByRole('dialog', { name: 'Poista tuote' });
    expect(poista).not.toHaveBeenCalled();
    await user.click(within(vahvistus).getByRole('button', { name: 'Poista' }));
    await waitFor(() => expect(poista).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Asennus')).not.toBeInTheDocument());
    expect(await client.haeTuotteet()).toHaveLength(2);
  });

  it('Peruuta poistovahvistuksessa ei poista', async () => {
    const { user, client } = await renderRoute('/tuotteet', { seed: SEED, arrange: tuotteet });
    const rivi = (await screen.findByText('Asennus')).closest('tr');
    if (!rivi) throw new Error('rivi puuttuu');
    await user.click(within(rivi).getByRole('button', { name: 'Poista' }));
    const vahvistus = await screen.findByRole('dialog', { name: 'Poista tuote' });
    await user.click(within(vahvistus).getByRole('button', { name: 'Peruuta' }));
    expect(screen.queryByRole('dialog', { name: 'Poista tuote' })).not.toBeInTheDocument();
    expect(await client.haeTuotteet()).toHaveLength(3);
  });

  it('Lähtevät-välilehdeltä pääsee Tuotteet-listaan', async () => {
    const { user, router } = await renderRoute('/tositteet?laji=tulot&valilehti=lahtevat', {
      seed: SEED,
    });
    await user.click(await screen.findByRole('link', { name: 'Tuotteet' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tuotteet'));
  });
});
