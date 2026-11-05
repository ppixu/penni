import { renderRoute } from '@/test/renderRoute';
import { paikallinenTanaan } from '@/tositteet/pikavalinnat';
import type { KpClient } from '@penni/asiakas';
import { ResourceError } from '@penni/engine';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  },
};

/** Kirjattu lasku asiakkaalle ja siitä toisto (1 kk, seuraava 1.1.2099, päättyy 31.12.2100).
 *  Päivät ovat kaukana tulevaisuudessa, jottei kirjan avauksen toistoajo (juuren ToistoAjo) luo
 *  niistä luonnoksia kesken testin. */
async function toisto(c: KpClient) {
  const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
  const lasku = await c.tallennaMyyntilasku({
    pvm: '2026-06-01',
    erapvm: '2026-06-15',
    kumppani: asiakas.id,
    rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0 }],
  });
  await c.luoToistoLaskusta({
    tosite: lasku.id,
    kuukausia: 1,
    seuraava: '2099-01-01',
    loppuu: '2100-12-31',
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Toistuvat laskut -lista', () => {
  it('näyttää asiakkaan, välin, seuraavan päivän ja lopun', async () => {
    await renderRoute('/toistot', { seed: SEED, arrange: toisto });
    const rivi = (await screen.findByText('Asiakas Oy')).closest('tr');
    if (!rivi) throw new Error('rivi puuttuu');
    expect(within(rivi).getByText('1 kk')).toBeInTheDocument();
    expect(within(rivi).getByText('1.1.2099')).toBeInTheDocument();
    expect(within(rivi).getByText('31.12.2100')).toBeInTheDocument();
    expect(within(rivi).getByText('Aktiivinen')).toBeInTheDocument();
  });

  it('näyttää välin kuukausina myös 3 kk ja 12 kk, ja puuttuvan lopun viivana', async () => {
    await renderRoute('/toistot', {
      seed: SEED,
      arrange: async (c) => {
        await toisto(c);
        const [vanha] = await c.haeToistot();
        if (!vanha) throw new Error('toisto puuttuu');
        const { id: _id, loppuu: _loppuu, ...pohja } = vanha;
        await c.tallennaToisto({ ...pohja, kuukausia: 3 });
        await c.tallennaToisto({ ...pohja, kuukausia: 12 });
      },
    });
    expect(await screen.findByText('3 kk')).toBeInTheDocument();
    expect(screen.getByText('12 kk')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBe(2);
  });

  it('tyhjä lista selittää, mistä toisto luodaan', async () => {
    await renderRoute('/toistot', { seed: SEED });
    expect(await screen.findByText(/Ei toistuvia laskuja/)).toBeInTheDocument();
  });

  it('keskeytys kytkee aktiivinen-lipun tallennaToisto:lla ja Jatka palauttaa sen', async () => {
    const { user, client } = await renderRoute('/toistot', { seed: SEED, arrange: toisto });
    const tallenna = vi.spyOn(client, 'tallennaToisto');
    await user.click(await screen.findByRole('button', { name: 'Keskeytä' }));
    await waitFor(() => expect(tallenna).toHaveBeenCalledTimes(1));
    expect(tallenna.mock.calls[0]?.[0]).toMatchObject({ id: 1, aktiivinen: false });
    expect(await screen.findByText('Keskeytetty')).toBeInTheDocument();
    expect((await client.haeToistot())[0]?.aktiivinen).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Jatka' }));
    await waitFor(() => expect(tallenna).toHaveBeenCalledTimes(2));
    expect(tallenna.mock.calls[1]?.[0]).toMatchObject({ id: 1, aktiivinen: true });
    expect(await screen.findByText('Aktiivinen')).toBeInTheDocument();
  });

  it('päättynyt toisto näkyy päättyneenä eikä sitä voi jatkaa', async () => {
    await renderRoute('/toistot', {
      seed: SEED,
      arrange: async (c) => {
        await toisto(c);
        const [t] = await c.haeToistot();
        if (!t) throw new Error('toisto puuttuu');
        await c.tallennaToisto({ ...t, seuraava: '2101-01-01', aktiivinen: false });
      },
    });
    expect(await screen.findByText('Päättynyt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jatka' })).not.toBeInTheDocument();
  });

  it('poisto kysyy vahvistuksen; Peruuta säilyttää, Poista poistaa', async () => {
    const { user, client } = await renderRoute('/toistot', { seed: SEED, arrange: toisto });
    const poista = vi.spyOn(client, 'poistaToisto');
    await user.click(await screen.findByRole('button', { name: 'Poista' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Poista toisto' });
    await user.click(within(dialogi).getByRole('button', { name: 'Peruuta' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(poista).not.toHaveBeenCalled();
    expect(screen.getByText('Asiakas Oy')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Poista' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Poista toisto' })).getByRole('button', {
        name: 'Poista',
      }),
    );
    await waitFor(() => expect(poista).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByText('Asiakas Oy')).not.toBeInTheDocument());
  });

  /** Juuren ToistoAjo kutsuu luoErantyneetToistot kerran kirjan avauksessa; tämä vakioi kutsun
   *  jo ennen renderöintiä, jotta käsin painettu luonti on erotettavissa siitä. */
  async function toistoJaVakioituAjo(c: KpClient) {
    await toisto(c);
    vi.spyOn(c, 'luoErantyneetToistot').mockResolvedValue({ luodut: [] });
  }

  it('Luo erääntyneet nyt kutsuu luoErantyneetToistot paikallisella päivällä ja ilmoittaa luodut', async () => {
    const { user, client } = await renderRoute('/toistot', {
      seed: SEED,
      arrange: toistoJaVakioituAjo,
    });
    const luo = vi.mocked(client.luoErantyneetToistot);
    await waitFor(() => expect(luo).toHaveBeenCalledTimes(1)); // kirjan avauksen ajo
    luo.mockResolvedValue({ luodut: [10, 11] });
    await user.click(await screen.findByRole('button', { name: 'Luo erääntyneet nyt' }));
    await waitFor(() => expect(luo).toHaveBeenCalledTimes(2));
    expect(luo).toHaveBeenLastCalledWith(paikallinenTanaan());
    expect(await screen.findByText('2 toistuvaa laskua odottaa Lähtevissä')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Avaa Lähtevät' })).toHaveAttribute(
      'href',
      expect.stringContaining('/tositteet'),
    );
  });

  it('kertoo, kun mitään ei erääntynyt tai ajo ohitettiin', async () => {
    const { user, client } = await renderRoute('/toistot', {
      seed: SEED,
      arrange: toistoJaVakioituAjo,
    });
    const luo = vi.mocked(client.luoErantyneetToistot);
    await waitFor(() => expect(luo).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole('button', { name: 'Luo erääntyneet nyt' }));
    expect(await screen.findByText('Ei erääntyneitä toistoja')).toBeInTheDocument();

    luo.mockResolvedValueOnce({ luodut: [], ohitettu: 'LUKITTU' });
    await user.click(screen.getByRole('button', { name: 'Luo erääntyneet nyt' }));
    expect(await screen.findByText(/lukitussa tilikaudessa/)).toBeInTheDocument();

    luo.mockResolvedValueOnce({ luodut: [], ohitettu: 'EITILIKAUTTA' });
    await user.click(screen.getByRole('button', { name: 'Luo erääntyneet nyt' }));
    expect(await screen.findByText(/ei ole tilikautta/)).toBeInTheDocument();
  });

  it('epäonnistuneet toistot luetellaan luotujen rinnalla', async () => {
    const { user, client } = await renderRoute('/toistot', {
      seed: SEED,
      arrange: toistoJaVakioituAjo,
    });
    const luo = vi.mocked(client.luoErantyneetToistot);
    await waitFor(() => expect(luo).toHaveBeenCalledTimes(1));
    luo.mockResolvedValueOnce({
      luodut: [10],
      epaonnistuneet: [{ toisto: 1, virhe: 'EIRIVEJA' }],
    });
    await user.click(await screen.findByRole('button', { name: 'Luo erääntyneet nyt' }));
    expect(await screen.findByText('1 toistuva lasku odottaa Lähtevissä')).toBeInTheDocument();
    expect(
      screen.getByText('Toiston luonti epäonnistui: toisto 1 (Laskulla ei ole rivejä)'),
    ).toBeInTheDocument();
  });
});

describe('Toiston muokkaus', () => {
  const dialogi = () => screen.findByRole('dialog', { name: 'Muokkaa toistoa' });

  it('väli ja seuraava päivä tallentuvat tallennaToisto:lla ja lista näyttää ne; pohja säilyy', async () => {
    const { user, client } = await renderRoute('/toistot', { seed: SEED, arrange: toisto });
    const ennen = (await client.haeToistot())[0];
    const tallenna = vi.spyOn(client, 'tallennaToisto');
    await user.click(await screen.findByRole('button', { name: 'Muokkaa' }));
    await dialogi();
    const vali = screen.getByLabelText('Toistoväli kuukausina');
    await user.clear(vali);
    await user.type(vali, '3');
    const seuraava = screen.getByLabelText('Seuraava laskupäivä');
    await user.clear(seuraava);
    await user.type(seuraava, '2099-02-01');
    await user.type(screen.getByLabelText('Nimi (valinnainen)'), 'Ylläpito');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(() => expect(tallenna).toHaveBeenCalledTimes(1));
    expect(tallenna.mock.calls[0]?.[0]).toMatchObject({
      id: 1,
      nimi: 'Ylläpito',
      kuukausia: 3,
      seuraava: '2099-02-01',
      loppuu: '2100-12-31',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('3 kk')).toBeInTheDocument();
    expect(screen.getByText('1.2.2099')).toBeInTheDocument();
    const jalkeen = (await client.haeToistot())[0];
    expect(jalkeen?.pohja).toEqual(ennen?.pohja);
    expect(jalkeen?.lahdeTosite).toBe(ennen?.lahdeTosite);
  });

  it('päättymispäivän tyhjennys poistaa loppuu-avaimen', async () => {
    const { user, client } = await renderRoute('/toistot', { seed: SEED, arrange: toisto });
    const tallenna = vi.spyOn(client, 'tallennaToisto');
    await user.click(await screen.findByRole('button', { name: 'Muokkaa' }));
    await dialogi();
    await user.clear(screen.getByLabelText('Päättyy (valinnainen)'));
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(() => expect(tallenna).toHaveBeenCalledTimes(1));
    expect(tallenna.mock.calls[0]?.[0]).not.toHaveProperty('loppuu');
    expect((await client.haeToistot())[0]).not.toHaveProperty('loppuu');
  });

  it('virheellinen väli tai loppu ennen alkua näyttää virheen eikä tallenna', async () => {
    const { user, client } = await renderRoute('/toistot', { seed: SEED, arrange: toisto });
    const tallenna = vi.spyOn(client, 'tallennaToisto');
    await user.click(await screen.findByRole('button', { name: 'Muokkaa' }));
    await dialogi();
    const vali = screen.getByLabelText('Toistoväli kuukausina');
    await user.clear(vali);
    await user.type(vali, '0');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Toistovälin on oltava');
    await user.clear(vali);
    await user.type(vali, '1');
    const loppu = screen.getByLabelText('Päättyy (valinnainen)');
    await user.clear(loppu);
    await user.type(loppu, '2098-01-01');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Päättymispäivä');
    expect(tallenna).not.toHaveBeenCalled();
  });

  it('moottorin virhe näytetään dialogissa', async () => {
    const { user, client } = await renderRoute('/toistot', { seed: SEED, arrange: toisto });
    vi.spyOn(client, 'tallennaToisto').mockRejectedValue(new ResourceError('EIKUUKAUSIA', 'x'));
    await user.click(await screen.findByRole('button', { name: 'Muokkaa' }));
    await dialogi();
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Toistovälin on oltava');
    expect(screen.getByRole('dialog', { name: 'Muokkaa toistoa' })).toBeInTheDocument();
  });

  it('Peruuta sulkee tallentamatta; päättyneen toiston loppupäivän pidennys aktivoi sen', async () => {
    const { user, client } = await renderRoute('/toistot', {
      seed: SEED,
      arrange: async (c) => {
        await toisto(c);
        const [t] = await c.haeToistot();
        if (!t) throw new Error('toisto puuttuu');
        await c.tallennaToisto({ ...t, seuraava: '2101-01-01', aktiivinen: false });
      },
    });
    const tallenna = vi.spyOn(client, 'tallennaToisto');
    await user.click(await screen.findByRole('button', { name: 'Muokkaa' }));
    await dialogi();
    await user.click(screen.getByRole('button', { name: 'Peruuta' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(tallenna).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Muokkaa' }));
    await dialogi();
    const loppu = screen.getByLabelText('Päättyy (valinnainen)');
    await user.clear(loppu);
    await user.type(loppu, '2105-12-31');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(() => expect(tallenna).toHaveBeenCalledTimes(1));
    expect(tallenna.mock.calls[0]?.[0]).toMatchObject({ aktiivinen: true, loppuu: '2105-12-31' });
  });
});

describe('Toistot kirjan avauksessa ja Lähtevät-välilehdellä', () => {
  it('kirjan avaus luo erääntyneen toiston luonnokseksi ja ilmoittaa siitä', async () => {
    const { client } = await renderRoute('/tositteet?laji=tulot&valilehti=lahtevat', {
      // Tilikausi ja toisto kattavat vuosikymmenet, jotta testi ei riipu ajopäivästä:
      // 1200 kk:n väli tuottaa täsmälleen yhden luonnoksen (seuraava 15.1.2026 on jo mennyt).
      seed: { ...SEED, tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2099-12-31' }] },
      arrange: async (c) => {
        await toisto(c);
        const [t] = await c.haeToistot();
        if (!t) throw new Error('toisto puuttuu');
        await c.tallennaToisto({ ...t, kuukausia: 1200, seuraava: '2026-01-15' });
      },
    });
    expect(await screen.findByText('1 toistuva lasku odottaa Lähtevissä')).toBeInTheDocument();
    expect((await client.listaaLaskuluonnokset()).map((r) => r.toisto)).toEqual([1]);
    // Lähtevät-lista päivittyy: luonnos näkyy ilman uudelleenlatausta.
    expect(await screen.findByText('Toistuva')).toBeInTheDocument();
  });

  it('Lähtevät-välilehdeltä pääsee Toistuvat laskut -listaan', async () => {
    const { user, router } = await renderRoute('/tositteet?laji=tulot&valilehti=lahtevat', {
      seed: SEED,
    });
    await user.click(await screen.findByRole('link', { name: 'Toistuvat laskut' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/toistot'));
  });

  it('Kirjatut-välilehdellä linkkiä ei näytetä', async () => {
    await renderRoute('/tositteet?laji=tulot', { seed: SEED });
    await screen.findByRole('link', { name: '+ Myyntilasku' });
    expect(screen.queryByRole('link', { name: 'Toistuvat laskut' })).not.toBeInTheDocument();
  });
});
