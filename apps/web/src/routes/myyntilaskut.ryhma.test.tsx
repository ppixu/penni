import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { Maksutapa } from '@penni/engine';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden voitto' } },
    { numero: 2861, tyyppi: 'B', nimi: { fi: 'Saadut ennakot' } },
    { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {
    Nimi: 'Demo Oy',
    AlvVelvollinen: 'true',
    OletusMyyntitili: '3000',
    LaskuSaatavaTili: '1701',
    AlvVelkaTili: '2939',
    LaskuMaksutili: '1900',
    LaskuEnnakkotili: '2861',
  },
};

const rivit = [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }];

async function asiakkaat(c: KpClient) {
  await c.tallennaKumppani({ nimi: 'Maija Oy' });
  await c.tallennaKumppani({ nimi: 'Pekka Ky' });
  await c.tallennaKumppani({ nimi: 'Liisa Tmi' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Uusi ryhmälasku', () => {
  it('tallentaa luonnoksen jokaiselle vastaanottajalle ja ohjaa Lähtevät-listaan', async () => {
    const { user, client, router } = await renderRoute('/myyntilaskut/ryhma', {
      seed: SEED,
      arrange: asiakkaat,
    });
    await screen.findByLabelText('laskulomake');
    expect(screen.getByText('Uusi ryhmälasku')).toBeInTheDocument();
    // Ryhmälasku tallennetaan vain luonnoksina; asiakasvalitsin ja ennakon hyvitys puuttuvat.
    expect(screen.queryByRole('button', { name: 'Tallenna ja kirjaa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Asiakas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hyvitä ennakko' })).not.toBeInTheDocument();
    const tallenna = screen.getByRole('button', { name: 'Tallenna luonnoksiksi' });
    expect(tallenna).toBeDisabled();

    await user.type(screen.getByLabelText('Otsikko'), 'Jäsenmaksu');
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'Vuosimaksu');
    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '100');
    await user.tab();
    // Ei vastaanottajia → ei tallenneta.
    expect(tallenna).toBeDisabled();

    await user.click(await screen.findByRole('button', { name: 'Lisää Pekka Ky' }));
    await user.type(screen.getByRole('searchbox', { name: 'Hae asiakasta' }), 'maija');
    await user.click(screen.getByRole('button', { name: 'Lisää kaikki' }));
    expect(screen.getByText('2 vastaanottajaa')).toBeInTheDocument();

    const tallennaRyhma = vi.spyOn(client, 'tallennaRyhmalasku');
    await user.click(tallenna);
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ laji: 'tulot', valilehti: 'lahtevat' }),
    );

    expect(tallennaRyhma).toHaveBeenCalledTimes(1);
    const syote = tallennaRyhma.mock.calls[0]?.[0];
    expect(syote?.kumppanit).toHaveLength(2);
    expect(syote?.ryhma).toMatch(/^[0-9a-f-]{36}$/);
    expect(syote?.otsikko).toBe('Jäsenmaksu');
    expect(syote).not.toHaveProperty('kumppani');

    const luonnokset = await client.listaaLaskuluonnokset();
    expect(luonnokset).toHaveLength(2);
    expect(new Set(luonnokset.map((l) => l.ryhma))).toEqual(new Set([syote?.ryhma]));
    expect(luonnokset.map((l) => l.asiakas).sort()).toEqual(['Maija Oy', 'Pekka Ky']);

    // Lähtevät: yksi ryhmäotsikko, jonka alla molemmat luonnokset.
    expect(await screen.findByText('Ryhmälasku · 2 laskua · Jäsenmaksu')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Maija Oy/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Pekka Ky/ })).toBeInTheDocument();
  });

  it('ennakkolaskuna tallentuu luonnokset kaikille eikä ennakon hyvitystä tarjota', async () => {
    const { user, client, router } = await renderRoute('/myyntilaskut/ryhma', {
      seed: {
        ...SEED,
        asetukset: { ...SEED.asetukset, LaskuEnnakkosaatavat: '1701', LaskuEnnakkoALV: '2939' },
      },
      arrange: asiakkaat,
    });
    await screen.findByLabelText('laskulomake');
    await user.click(screen.getByRole('radio', { name: 'Ennakkolasku' }));
    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '50');
    await user.tab();
    await user.click(await screen.findByRole('button', { name: 'Lisää Liisa Tmi' }));
    expect(screen.queryByRole('button', { name: 'Hyvitä ennakko' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tallenna luonnoksiksi' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tositteet'));
    const [luonnos] = await client.listaaLaskuluonnokset();
    expect((await client.haeTosite(luonnos?.tosite as number))?.maksutapa).toBe(
      Maksutapa.ENNAKKOLASKU,
    );
  });
});

describe('Lähtevät: ryhmälaskut', () => {
  async function ryhma(c: KpClient) {
    await asiakkaat(c);
    const kumppanit = await c.haeKumppanit();
    const id = (nimi: string) => kumppanit.find((k) => k.nimi === nimi)?.id as number;
    await c.tallennaRyhmalasku({
      pvm: '2026-05-01',
      erapvm: '2026-05-15',
      otsikko: 'Jäsenmaksu',
      rivit,
      kumppanit: [id('Maija Oy'), id('Pekka Ky')],
      ryhma: 'r-1',
    });
    await c.tallennaMyyntilasku({
      pvm: '2026-05-02',
      kumppani: id('Liisa Tmi'),
      otsikko: 'Yksittäinen',
      rivit,
      luonnos: true,
    });
  }

  it('näyttää ryhmän luonnokset yhden otsikon alla ja rivi avaa oman luonnoksensa', async () => {
    const { user, router } = await renderRoute('/tositteet?laji=tulot&valilehti=lahtevat', {
      seed: SEED,
      arrange: ryhma,
    });
    expect(await screen.findByText('Ryhmälasku · 2 laskua · Jäsenmaksu')).toBeInTheDocument();
    // Yksittäinen luonnos ei saa ryhmäotsikkoa.
    expect(screen.getAllByText(/^Ryhmälasku ·/)).toHaveLength(1);
    expect(screen.getByRole('row', { name: /Liisa Tmi/ })).toBeInTheDocument();

    await user.click(screen.getByRole('row', { name: /Pekka Ky/ }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/myyntilaskut\/\d+$/));
  });

  it('Kirjaa kaikki kirjaa ryhmän luonnokset järjestyksessä omilla numeroillaan', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, client } = await renderRoute('/tositteet?laji=tulot&valilehti=lahtevat', {
      seed: SEED,
      arrange: ryhma,
    });
    await screen.findByText('Ryhmälasku · 2 laskua · Jäsenmaksu');
    await user.click(screen.getByRole('button', { name: 'Kirjaa kaikki' }));

    await waitFor(async () => {
      const jaljella = await client.listaaLaskuluonnokset();
      expect(jaljella.map((l) => l.asiakas)).toEqual(['Liisa Tmi']);
    });
    const kirjatut = await client.listaaMyyntilaskut({});
    expect(kirjatut.map((k) => k.asiakas)).toEqual(['Maija Oy', 'Pekka Ky']);
    expect(kirjatut.map((k) => k.numero)).toEqual(['1', '2']);
    expect(screen.queryByText('Ryhmälasku · 2 laskua · Jäsenmaksu')).not.toBeInTheDocument();
  });

  it('Kirjaa kaikki pysähtyy ensimmäiseen virheeseen ja kertoo, mikä luonnos epäonnistui', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, client } = await renderRoute('/tositteet?laji=tulot&valilehti=lahtevat', {
      seed: SEED,
      arrange: ryhma,
    });
    await screen.findByText('Ryhmälasku · 2 laskua · Jäsenmaksu');
    const alkuperainen = client.kirjaaLaskuluonnos.bind(client);
    let kutsut = 0;
    vi.spyOn(client, 'kirjaaLaskuluonnos').mockImplementation(async (id, muutokset) => {
      kutsut += 1;
      if (kutsut === 2) {
        const { ResourceError } = await import('@penni/engine');
        throw new ResourceError('EILASKUTILIA', 'Vastatili puuttuu');
      }
      return alkuperainen(id, muutokset);
    });
    await user.click(screen.getByRole('button', { name: 'Kirjaa kaikki' }));

    const virhe = await screen.findByRole('alert');
    expect(virhe).toHaveTextContent('Pekka Ky');
    expect(virhe).toHaveTextContent('1 / 2');
    expect(kutsut).toBe(2);
    // Ensimmäinen kirjattiin, toinen jäi luonnokseksi.
    const jaljella = await client.listaaLaskuluonnokset();
    expect(jaljella.map((l) => l.asiakas).sort()).toEqual(['Liisa Tmi', 'Pekka Ky']);
    // Ryhmässä on enää yksi luonnos, joten se näkyy tavallisena rivinä.
    expect(
      within(await screen.findByRole('row', { name: /Pekka Ky/ })).getByText('Ryhmälasku'),
    ).toBeInTheDocument();
  });
});
