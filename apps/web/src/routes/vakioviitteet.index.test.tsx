import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { laskeViite } from '@penni/validator';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 3100, tyyppi: 'CL', nimi: { fi: 'Jäsenmaksut' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy', OletusMyyntitili: '3000' },
};

async function viitteet(c: KpClient) {
  await c.tallennaVakioviite({ tili: 3100, otsikko: 'Jäsenmaksu' }); // 1009
}

afterEach(() => vi.restoreAllMocks());

describe('Vakioviitteet-lista', () => {
  it('näyttää viitteen, otsikon ja tilin', async () => {
    await renderRoute('/vakioviitteet', { seed: SEED, arrange: viitteet });
    const rivi = (await screen.findByText('Jäsenmaksu')).closest('tr');
    if (!rivi) throw new Error('rivi puuttuu');
    expect(within(rivi).getByText('1009')).toBeInTheDocument();
    expect(within(rivi).getByText('3100 Jäsenmaksut')).toBeInTheDocument();
  });

  it('ryhmittelee pitkän viitteen viiden numeron ryhmiin oikealta', async () => {
    await renderRoute('/vakioviitteet', {
      seed: SEED,
      arrange: async (c) => {
        await c.tallennaVakioviite({
          viite: laskeViite('123456'),
          tili: 3000,
          otsikko: 'Pitkä',
        });
      },
    });
    const rivi = (await screen.findByText('Pitkä')).closest('tr');
    if (!rivi) throw new Error('rivi puuttuu');
    expect(within(rivi).getByText('12 34561')).toBeInTheDocument();
  });

  it('tyhjä lista kertoo, mistä viite luodaan', async () => {
    await renderRoute('/vakioviitteet', { seed: SEED });
    expect(await screen.findByText(/Ei vakioviitteitä/)).toBeInTheDocument();
  });

  it('kohdennus-saraketta ei näytetä, kun kohdennuksia ei ole', async () => {
    await renderRoute('/vakioviitteet', { seed: SEED, arrange: viitteet });
    await screen.findByText('Jäsenmaksu');
    expect(screen.queryByRole('columnheader', { name: 'Kohdennus' })).not.toBeInTheDocument();
  });

  it('Uusi vakioviite avaa dialogin ja tallennettu viite ilmestyy listaan', async () => {
    const { user, client } = await renderRoute('/vakioviitteet', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: '+ Uusi vakioviite' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Uusi vakioviite' });
    await user.type(within(dialogi).getByLabelText('Otsikko'), 'Vuokra');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText('Vuokra')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Uusi vakioviite' })).not.toBeInTheDocument();
    expect((await client.haeVakioviitteet())[0]).toMatchObject({ viite: '1009', tili: 3000 });
  });

  it('Muokkaa avaa dialogin nykyisellä viitteellä ja tallennus säilyttää numeron', async () => {
    const { user, client } = await renderRoute('/vakioviitteet', { seed: SEED, arrange: viitteet });
    const rivi = (await screen.findByText('Jäsenmaksu')).closest('tr');
    if (!rivi) throw new Error('rivi puuttuu');
    await user.click(within(rivi).getByRole('button', { name: 'Muokkaa' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Muokkaa vakioviitettä' });
    expect(within(dialogi).getByLabelText('Viite')).toHaveValue('1009');
    const otsikko = within(dialogi).getByLabelText('Otsikko');
    await user.clear(otsikko);
    await user.type(otsikko, 'Jäsenmaksu 2027');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText('Jäsenmaksu 2027')).toBeInTheDocument();
    const kaikki = await client.haeVakioviitteet();
    expect(kaikki.find((v) => v.otsikko === 'Jäsenmaksu 2027')?.viite).toBe('1009');
  });

  it('Poista kysyy vahvistuksen ja poistaa viitteen poistaVakioviite-kutsulla', async () => {
    const { user, client } = await renderRoute('/vakioviitteet', { seed: SEED, arrange: viitteet });
    const poista = vi.spyOn(client, 'poistaVakioviite');
    const rivi = (await screen.findByText('Jäsenmaksu')).closest('tr');
    if (!rivi) throw new Error('rivi puuttuu');
    await user.click(within(rivi).getByRole('button', { name: 'Poista' }));
    const vahvistus = await screen.findByRole('dialog', { name: 'Poista vakioviite' });
    expect(poista).not.toHaveBeenCalled();
    await user.click(within(vahvistus).getByRole('button', { name: 'Poista' }));
    await waitFor(() => expect(poista).toHaveBeenCalledWith('1009'));
    await waitFor(() => expect(screen.queryByText('Jäsenmaksu')).not.toBeInTheDocument());
    expect(await client.haeVakioviitteet()).toHaveLength(0);
  });

  it('Peruuta poistovahvistuksessa ei poista', async () => {
    const { user, client } = await renderRoute('/vakioviitteet', { seed: SEED, arrange: viitteet });
    const rivi = (await screen.findByText('Jäsenmaksu')).closest('tr');
    if (!rivi) throw new Error('rivi puuttuu');
    await user.click(within(rivi).getByRole('button', { name: 'Poista' }));
    const vahvistus = await screen.findByRole('dialog', { name: 'Poista vakioviite' });
    await user.click(within(vahvistus).getByRole('button', { name: 'Peruuta' }));
    expect(screen.queryByRole('dialog', { name: 'Poista vakioviite' })).not.toBeInTheDocument();
    expect(await client.haeVakioviitteet()).toHaveLength(1);
  });

  it('Lähtevät-välilehdeltä pääsee Vakioviitteet-listaan', async () => {
    const { user, router } = await renderRoute('/tositteet?laji=tulot&valilehti=lahtevat', {
      seed: SEED,
    });
    await user.click(await screen.findByRole('link', { name: 'Vakioviitteet' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/vakioviitteet'));
  });
});
