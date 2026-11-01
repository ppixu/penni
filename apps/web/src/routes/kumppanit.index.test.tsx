import { renderRoute } from '@/test/renderRoute';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy' },
};

async function siemenKumppanit(client: import('@penni/asiakas').KpClient) {
  await client.tallennaKumppani({
    nimi: 'Asiakas Oy',
    alvtunnus: 'FI12345678',
    kaupunki: 'Helsinki',
  });
  await client.tallennaKumppani({ nimi: 'Toimittaja Ky', kaupunki: 'Tampere' });
}

describe('/kumppanit (lista)', () => {
  it('listaa kumppanit', async () => {
    await renderRoute('/kumppanit', { seed: SEED, arrange: siemenKumppanit });
    expect(await screen.findByDisplayValue('Asiakas Oy')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Toimittaja Ky')).toBeInTheDocument();
  });

  it('haku suodattaa nimen ja alv-tunnuksen mukaan', async () => {
    const { user } = await renderRoute('/kumppanit', { seed: SEED, arrange: siemenKumppanit });
    await screen.findByDisplayValue('Asiakas Oy');
    await user.type(screen.getByLabelText('Hae kumppania'), 'toimit');
    expect(screen.queryByDisplayValue('Asiakas Oy')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Toimittaja Ky')).toBeInTheDocument();
  });

  it('Avaa navigoi muokkaukseen', async () => {
    const { user } = await renderRoute('/kumppanit', { seed: SEED, arrange: siemenKumppanit });
    await user.click(await screen.findByRole('button', { name: 'Avaa Asiakas Oy' }));
    // $id-tynkä (tai valmis lomake) näyttää otsikon "Muokkaa kumppania"
    expect(await screen.findByText('Muokkaa kumppania')).toBeInTheDocument();
  });

  it('Tositteet avaa kumppanin tositteet tositelistalla', async () => {
    const { user, router, client } = await renderRoute('/kumppanit', {
      seed: SEED,
      arrange: siemenKumppanit,
    });
    await user.click(await screen.findByRole('link', { name: 'Tositteet: Asiakas Oy' }));
    const id = (await client.haeKumppanit()).find((k) => k.nimi === 'Asiakas Oy')?.id;
    await waitFor(() => expect(router.state.location.pathname).toBe('/tositteet'));
    expect(router.state.location.search).toEqual({ kumppani: id });
  });

  it('+ Uusi kumppani navigoi luontiin', async () => {
    const { user } = await renderRoute('/kumppanit', { seed: SEED, arrange: siemenKumppanit });
    await screen.findByDisplayValue('Asiakas Oy');
    await user.click(screen.getByRole('button', { name: '+ Uusi kumppani' }));
    expect(await screen.findByText('Uusi kumppani')).toBeInTheDocument();
  });

  it('kentän muokkaus tallentuu Enterillä ja säilyttää muut kentät', async () => {
    const { user, client } = await renderRoute('/kumppanit', {
      seed: SEED,
      arrange: siemenKumppanit,
    });
    const kentta = await screen.findByLabelText('Alv-tunnus: Toimittaja Ky');
    await user.type(kentta, 'FI87654321{Enter}');
    await waitFor(async () => {
      const k = (await client.haeKumppanit()).find((x) => x.nimi === 'Toimittaja Ky');
      expect(k).toMatchObject({ alvtunnus: 'FI87654321', kaupunki: 'Tampere' });
    });
  });

  it('tyhjennetty kenttä poistuu, Esc peruu muutoksen', async () => {
    const { user, client } = await renderRoute('/kumppanit', {
      seed: SEED,
      arrange: siemenKumppanit,
    });
    const alvtunnus = await screen.findByLabelText('Alv-tunnus: Asiakas Oy');
    await user.type(alvtunnus, '9{Escape}');
    expect(alvtunnus).toHaveValue('FI12345678');
    await user.clear(alvtunnus);
    await user.tab();
    await waitFor(async () => {
      const k = (await client.haeKumppanit()).find((x) => x.nimi === 'Asiakas Oy');
      expect(k).toMatchObject({ kaupunki: 'Helsinki' });
      expect(k).not.toHaveProperty('alvtunnus');
    });
  });

  it('näyttää tositteiden määrän ja summan kaudella ja kaikkiaan, liittää kumppanittomat', async () => {
    const meno = (pvm: string, snt: number, extra: Record<string, unknown>) => ({
      pvm,
      tyyppi: 100,
      sarja: '',
      tila: 100,
      viennit: [
        { tili: 7661, debet: snt, kredit: 0, pvm, alvKoodi: 0, alvProsentti: 0 },
        { tili: 1910, debet: 0, kredit: snt, pvm, alvKoodi: 0, alvProsentti: 0 },
      ],
      ...extra,
    });
    const { user, client } = await renderRoute('/kumppanit', {
      seed: {
        ...SEED,
        tilit: [
          { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
          { numero: 7661, tyyppi: 'D', nimi: { fi: 'Ohjelmistot' } },
        ],
        tilikaudet: [
          { alkaa: '2025-01-01', loppuu: '2025-12-31' },
          { alkaa: '2026-01-01', loppuu: '2026-12-31' },
        ],
      },
      arrange: async (c) => {
        // Kumppaniton tosite syntyy ennen kumppania, kuten ennen kumppanin tunnistusta.
        await c.luoTosite(meno('2026-07-16', 564, { otsikko: 'GitHub' }));
        const github = await c.tallennaKumppani({ nimi: 'Github' });
        await c.luoTosite(meno('2025-12-16', 500, { kumppani: github.id }));
        await c.luoTosite(meno('2026-06-16', 564, { kumppani: github.id }));
      },
    });
    const rivi = (await screen.findByDisplayValue('Github')).closest('tr') as HTMLElement;
    await waitFor(() => expect(within(rivi).getByText('11,28 €')).toBeInTheDocument());
    expect(within(rivi).getByText('16,28 €')).toBeInTheDocument();
    expect(within(rivi).getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tositteet 2026' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Kaupunki' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Liitä kumppaneihin' }));
    expect(await screen.findByText('Liitetty 1 tosite.')).toBeInTheDocument();
    const github = (await client.haeKumppanit()).find((k) => k.nimi === 'Github');
    const tositteet = await client.listaaTositteet({});
    expect(tositteet.filter((t) => t.kumppani === github?.id)).toHaveLength(3);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Liitä kumppaneihin' })).not.toBeInTheDocument(),
    );
  });

  it('kumppaneihin liittäminen säilyttää vientien kohdennuksen ja merkkaukset', async () => {
    const pvm = '2026-07-16';
    const { user, client } = await renderRoute('/kumppanit', {
      seed: {
        ...SEED,
        tilit: [
          { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
          { numero: 7661, tyyppi: 'D', nimi: { fi: 'Ohjelmistot' } },
        ],
      },
      arrange: async (c) => {
        await c.luoTosite({
          pvm,
          tyyppi: 100,
          sarja: '',
          tila: 100,
          otsikko: 'GitHub',
          viennit: [
            {
              tili: 7661,
              debet: Euro.fromCents(564),
              kredit: Euro.fromCents(0),
              pvm,
              alvKoodi: 0,
              alvProsentti: 0,
              kohdennus: 1,
              merkkaukset: [3],
            },
            {
              tili: 1910,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(564),
              pvm,
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        });
        await c.tallennaKumppani({ nimi: 'Github' });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Liitä kumppaneihin' }));
    expect(await screen.findByText('Liitetty 1 tosite.')).toBeInTheDocument();
    const tosite = await client.haeTosite(1);
    expect(tosite?.kumppani).toBeDefined();
    expect(tosite?.viennit.find((v) => v.tili === 7661)).toMatchObject({
      kohdennus: 1,
      merkkaukset: [3],
    });
  });

  it('tyhjää nimeä ei tallenneta', async () => {
    const { user, client } = await renderRoute('/kumppanit', {
      seed: SEED,
      arrange: siemenKumppanit,
    });
    const nimi = await screen.findByLabelText('Nimi: Asiakas Oy');
    await user.clear(nimi);
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Anna kumppanin nimi.');
    expect(nimi).toHaveValue('Asiakas Oy');
    expect((await client.haeKumppanit()).map((k) => k.nimi)).toContain('Asiakas Oy');
  });

  it('tyhjä tila kun ei kumppaneita', async () => {
    await renderRoute('/kumppanit', { seed: SEED });
    await waitFor(() => expect(screen.getByText('Ei kumppaneita.')).toBeInTheDocument());
  });
});
