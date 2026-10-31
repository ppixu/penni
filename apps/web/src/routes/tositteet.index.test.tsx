import { renderRoute } from '@/test/renderRoute';
import { valitseTilikausi } from '@/test/valitseTilikausi';
import { lueListanJarjestys } from '@/tositteet/listanJarjestys';
import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [
    { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    { alkaa: '2026-01-01', loppuu: '2026-12-31' },
  ],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false' },
};

const myynti = (pvm: string, snt: number, otsikko?: string) => ({
  pvm,
  tyyppi: 200,
  sarja: '',
  tila: 100,
  ...(otsikko ? { otsikko } : {}),
  viennit: [
    {
      tili: 1910,
      debet: Euro.fromCents(snt),
      kredit: Euro.fromCents(0),
      pvm,
      alvKoodi: 0,
      alvProsentti: 0,
    },
    {
      tili: 3000,
      debet: Euro.fromCents(0),
      kredit: Euro.fromCents(snt),
      pvm,
      alvKoodi: 0,
      alvProsentti: 0,
    },
  ],
});

/** Painetut aikavälin pikavalinnat (myös kuukausirivi). */
const painetutAikavalit = () =>
  within(screen.getByRole('group', { name: 'Aikaväli' })).queryAllByRole('button', {
    pressed: true,
  });

/** Q-nappi nimellä tai "(tämä neljännes)" -merkinnällä — merkintä riippuu ajopäivästä. */
const qNappi = (q: string) =>
  screen.getByRole('button', { name: new RegExp(`^${q}( \\(tämä neljännes\\))?$`) });

describe('Tositeselaus', () => {
  it('Q1–Q4 vaihtavat päivät ja suodattavat tositteet', async () => {
    const { user } = await selaus();
    await screen.findByText('250,00 €');
    for (const [label, alku, loppu] of [
      ['Q1', '2026-01-01', '2026-03-31'],
      ['Q2', '2026-04-01', '2026-06-30'],
      ['Q3', '2026-07-01', '2026-09-30'],
      ['Q4', '2026-10-01', '2026-12-31'],
    ] as const) {
      await user.click(qNappi(label));
      expect(screen.getByLabelText('Alkaen')).toHaveValue(alku);
      expect(screen.getByLabelText('Asti')).toHaveValue(loppu);
      expect(qNappi(label)).toHaveAttribute('aria-pressed', 'true');
      if (label === 'Q1') await screen.findByText('250,00 €');
      else await screen.findByText('Ei tositteita valituilla ehdoilla.');
    }
  });

  it('pysyy käytettävissä hitaiden hakujen aikana ja tyhjän neljänneksen jälkeen', async () => {
    const { user } = await renderRoute('/tositteet', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite(myynti('2026-03-01', 25_000));
        const listaa = c.listaaTositteet.bind(c);
        vi.spyOn(c, 'listaaTositteet').mockImplementation(async (filter) => {
          // HTTP/IPC jättää lataustilan näkyviin usean renderöinnin ajaksi.
          await new Promise((resolve) => setTimeout(resolve, 80));
          return filter.alkupvm === '2026-01-01' && filter.loppupvm === '2026-12-31'
            ? listaa(filter)
            : [];
        });
      },
    });
    await screen.findByText('250,00 €');
    await user.click(qNappi('Q2'));
    expect(screen.getByRole('status')).toHaveTextContent('Ladataan tositteita');
    await screen.findByText('Ei tositteita valituilla ehdoilla.');
    // Aktiivisen napin uusi painallus palaa koko tilikauteen.
    await user.click(qNappi('Q2'));
    await screen.findByText('250,00 €');
    await user.click(screen.getByRole('button', { name: 'Luonnokset' }));
    await screen.findByText('Ei tositteita valituilla ehdoilla.');
    await user.click(screen.getByRole('button', { name: 'Kirjanpidossa' }));
    await screen.findByText('250,00 €');
  });

  it('lists finalized vouchers and navigates to a voucher on row click', async () => {
    const { user } = await renderRoute('/tositteet', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite(myynti('2026-02-01', 10_000));
        await c.luoTosite(myynti('2026-03-01', 25_000));
      },
    });
    await waitFor(() => expect(screen.getByText('100,00 €')).toBeInTheDocument());
    expect(screen.getByText('250,00 €')).toBeInTheDocument();
    await user.click(screen.getByText('100,00 €'));
    await waitFor(() => expect(screen.getByLabelText('tosite')).toBeInTheDocument());
  });

  // Nämä testit eivät jäädytä kelloa: pikavalinnan puhdas laskenta on testattu erikseen
  // (tositteet/pikavalinnat.test.ts). Kun tämä päivä ohittaa viimeisen tilikauden, valinta
  // palautuu viimeiseen kauteen (2026) — siksi odotukset pitävät myös tulevaisuudessa.
  async function selaus() {
    return renderRoute('/tositteet', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite(myynti('2025-05-01', 5_000));
        await c.luoTosite(myynti('2026-03-01', 25_000));
      },
    });
  }

  it('rajaa oletuksena kuluvaan tilikauteen', async () => {
    await selaus();
    await waitFor(() => expect(screen.getByText('250,00 €')).toBeInTheDocument());
    expect(screen.queryByText('50,00 €')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Alkaen')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('Asti')).toHaveValue('2026-12-31');
    // Koko kausi näkyy painettuna Tämä vuosi -nappina.
    expect(painetutAikavalit().map((n) => n.textContent)).toEqual(['Tämä vuosi']);
  });

  it('Tämä vuosi palaa neljänneksestä koko tilikauteen', async () => {
    const { user } = await selaus();
    await screen.findByText('250,00 €');
    await user.click(qNappi('Q2'));
    await screen.findByText('Ei tositteita valituilla ehdoilla.');
    await user.click(screen.getByRole('button', { name: 'Tämä vuosi' }));
    expect(screen.getByLabelText('Alkaen')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('Asti')).toHaveValue('2026-12-31');
    await screen.findByText('250,00 €');
    expect(painetutAikavalit().map((n) => n.textContent)).toEqual(['Tämä vuosi']);
  });

  it('ei tarjoa kausinappeja: tilikausi valitaan sivupalkista', async () => {
    await selaus();
    await screen.findByText('250,00 €');
    for (const nimi of ['Tämä tilikausi', 'Edellinen tilikausi', 'Kaikki']) {
      expect(
        within(screen.getByRole('group', { name: 'Aikaväli' })).queryByRole('button', {
          name: nimi,
        }),
      ).not.toBeInTheDocument();
    }
  });

  it('sivupalkin tilikausivalinta näyttää vain valitun kauden tositteet', async () => {
    const { user } = await selaus();
    await waitFor(() => expect(screen.getByText('250,00 €')).toBeInTheDocument());
    await valitseTilikausi(user, '2025');
    await waitFor(() => expect(screen.getByText('50,00 €')).toBeInTheDocument());
    expect(screen.queryByText('250,00 €')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Alkaen')).toHaveValue('2025-01-01');
    expect(screen.getByLabelText('Asti')).toHaveValue('2025-12-31');
    // Aiemmalla kaudella "Tämä kuukausi" ei tarkoita mitään; Q-napit ovat sen kauden vuodelta.
    expect(screen.queryByRole('button', { name: 'Tämä kuukausi' })).not.toBeInTheDocument();
    // Aiemman kauden koko vuosi ei ole "tämä".
    expect(screen.getByRole('button', { name: 'Koko vuosi' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(qNappi('Q2'));
    expect(screen.getByLabelText('Alkaen')).toHaveValue('2025-04-01');
    await waitFor(() => expect(screen.getByText('50,00 €')).toBeInTheDocument());
  });

  it('käsin syötetty väli ei päästä valitun kauden ulkopuolelle', async () => {
    const { user } = await selaus();
    await screen.findByText('250,00 €');
    const alkaen = screen.getByLabelText('Alkaen');
    await user.clear(alkaen);
    await user.type(alkaen, '2025-03-01');
    // Kenttä näyttää kauden alun, eikä 2025 tosite tule listalle.
    await waitFor(() => expect(screen.getByLabelText('Alkaen')).toHaveValue('2026-01-01'));
    expect(screen.queryByText('50,00 €')).not.toBeInTheDocument();
  });

  it('merkitsee neljänneksen, jonka alv:ta ei ole vielä ilmoitettu, eikä näytä erillistä Tämä neljännes -nappia', async () => {
    // Q2 ilmoitettu: työn alla on Q3 riippumatta siitä, mikä kalenterineljännes on menossa.
    await renderRoute('/tositteet', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, AlvIlmoitettu: '2026-06-30' } },
    });
    expect(await screen.findByRole('button', { name: 'Q3 (tämä neljännes)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Q4' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Tämä neljännes/ })).not.toBeInTheDocument();
  });

  it('kuukausittain alv:n ilmoittavalle näyttää kuukausirivin ja merkitsee työn alla olevan kuukauden', async () => {
    const { user } = await renderRoute('/tositteet', {
      seed: {
        ...SEED,
        asetukset: {
          ...SEED.asetukset,
          AlvVelvollinen: 'true',
          AlvKausi: '1',
          AlvIlmoitettu: '2026-08-31',
        },
      },
      arrange: async (c) => {
        await c.luoTosite(myynti('2026-02-10', 10_000));
        await c.luoTosite(myynti('2026-03-01', 25_000));
      },
    });
    await screen.findByText('250,00 €');
    const kuukaudet = screen.getByRole('group', { name: 'Kuukaudet' });
    expect(within(kuukaudet).getAllByRole('button')).toHaveLength(12);
    // Elokuu ilmoitettu: työn alla on syyskuu riippumatta siitä, mikä kuukausi on menossa.
    expect(within(kuukaudet).getByRole('button', { name: 'Syys (tämä kuukausi)' })).toBeEnabled();
    // Kuukausirivi korvaa erillisen Tämä kuukausi -napin.
    expect(screen.queryByRole('button', { name: 'Tämä kuukausi' })).not.toBeInTheDocument();
    await user.click(within(kuukaudet).getByRole('button', { name: 'Helmi' }));
    expect(screen.getByLabelText('Alkaen')).toHaveValue('2026-02-01');
    expect(screen.getByLabelText('Asti')).toHaveValue('2026-02-28');
    await waitFor(() => expect(screen.queryByText('250,00 €')).not.toBeInTheDocument());
    expect(screen.getByText('100,00 €')).toBeInTheDocument();
    expect(painetutAikavalit().map((n) => n.textContent)).toEqual(['Helmi']);
  });

  it('neljännes- tai vuosi-ilmoittajalle ei näytä kuukausiriviä', async () => {
    await renderRoute('/tositteet', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, AlvVelvollinen: 'true', AlvKausi: '3' } },
    });
    await screen.findByRole('button', { name: 'Tämä vuosi' });
    expect(screen.queryByRole('group', { name: 'Kuukaudet' })).not.toBeInTheDocument();
  });

  async function haettava() {
    const tulos = await renderRoute('/tositteet', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite(myynti('2026-01-10', 5_000, 'Vanha myynti'));
        await c.luoTosite(myynti('2026-02-01', 10_000, 'Helmikuun myynti'));
        await c.luoTosite(myynti('2026-03-01', 25_000, 'Maaliskuun myynti'));
        await c.luoTosite(myynti('2026-04-01', 8_640, 'Toimistotarvikkeet'));
      },
    });
    await waitFor(() => expect(screen.getByText('Vanha myynti')).toBeInTheDocument());
    return tulos;
  }
  const rivienSelitteet = () =>
    within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.querySelectorAll('td')[3]?.textContent);

  it('näyttää tositteet uusin ensin', async () => {
    await haettava();
    expect(rivienSelitteet()).toEqual([
      'Toimistotarvikkeet',
      'Maaliskuun myynti',
      'Helmikuun myynti',
      'Vanha myynti',
    ]);
  });

  it('haku suodattaa otsikolla ja summalla', async () => {
    const { user } = await haettava();
    const haku = screen.getByRole('searchbox', { name: 'Hae tositteita' });
    await user.type(haku, 'myynti');
    expect(rivienSelitteet()).toEqual(['Maaliskuun myynti', 'Helmikuun myynti', 'Vanha myynti']);
    await user.clear(haku);
    await user.type(haku, '86,40');
    expect(rivienSelitteet()).toEqual(['Toimistotarvikkeet']);
    await user.clear(haku);
    await user.type(haku, '250');
    expect(rivienSelitteet()).toEqual(['Maaliskuun myynti']);
    await user.clear(haku);
    await user.type(haku, 'ei löydy');
    expect(screen.getByText(/Ei tositteita/)).toBeInTheDocument();
  });

  describe('lajittelu sarakeotsikoista', () => {
    const otsikkoNappi = (nimi: string) => screen.getByRole('button', { name: nimi });
    const sarakeotsikko = (nimi: string) => otsikkoNappi(nimi).closest('th') as HTMLElement;

    it('oletuksena uusin ensin: päivämäärä on järjestävä sarake, laskeva', async () => {
      await haettava();
      expect(sarakeotsikko('Lajittele päivämäärän mukaan')).toHaveAttribute(
        'aria-sort',
        'descending',
      );
      expect(sarakeotsikko('Lajittele summan mukaan')).not.toHaveAttribute('aria-sort');
    });

    it('klikkaus lajittelee nousevasti, toinen klikkaus kääntää, kolmas palauttaa oletuksen', async () => {
      const { user, router } = await haettava();
      const summa = 'Lajittele summan mukaan';
      await user.click(otsikkoNappi(summa));
      expect(rivienSelitteet()).toEqual([
        'Vanha myynti',
        'Toimistotarvikkeet',
        'Helmikuun myynti',
        'Maaliskuun myynti',
      ]);
      expect(sarakeotsikko(summa)).toHaveAttribute('aria-sort', 'ascending');
      expect(sarakeotsikko('Lajittele päivämäärän mukaan')).not.toHaveAttribute('aria-sort');
      expect(router.state.location.search).toEqual({ jarj: 'summa', suunta: 'nouseva' });

      await user.click(otsikkoNappi(summa));
      expect(rivienSelitteet()).toEqual([
        'Maaliskuun myynti',
        'Helmikuun myynti',
        'Toimistotarvikkeet',
        'Vanha myynti',
      ]);
      expect(sarakeotsikko(summa)).toHaveAttribute('aria-sort', 'descending');
      expect(router.state.location.search).toEqual({ jarj: 'summa', suunta: 'laskeva' });

      await user.click(otsikkoNappi(summa));
      expect(rivienSelitteet()).toEqual([
        'Toimistotarvikkeet',
        'Maaliskuun myynti',
        'Helmikuun myynti',
        'Vanha myynti',
      ]);
      expect(sarakeotsikko('Lajittele päivämäärän mukaan')).toHaveAttribute(
        'aria-sort',
        'descending',
      );
      expect(router.state.location.search).toEqual({});
    });

    it('selite lajitellaan aakkosjärjestykseen ja päivämäärän klikkaus kääntää järjestyksen', async () => {
      const { user } = await haettava();
      await user.click(otsikkoNappi('Lajittele selitteen mukaan'));
      expect(rivienSelitteet()).toEqual([
        'Helmikuun myynti',
        'Maaliskuun myynti',
        'Toimistotarvikkeet',
        'Vanha myynti',
      ]);
      await user.click(otsikkoNappi('Lajittele päivämäärän mukaan'));
      expect(rivienSelitteet()).toEqual([
        'Vanha myynti',
        'Helmikuun myynti',
        'Maaliskuun myynti',
        'Toimistotarvikkeet',
      ]);
      expect(sarakeotsikko('Lajittele päivämäärän mukaan')).toHaveAttribute(
        'aria-sort',
        'ascending',
      );
    });

    it('toimii näppäimistöllä (Enter) ja yhdessä haun kanssa', async () => {
      const { user } = await haettava();
      await user.type(screen.getByRole('searchbox', { name: 'Hae tositteita' }), 'myynti');
      otsikkoNappi('Lajittele summan mukaan').focus();
      await user.keyboard('{Enter}');
      expect(rivienSelitteet()).toEqual(['Vanha myynti', 'Helmikuun myynti', 'Maaliskuun myynti']);
      await user.keyboard('{Enter}');
      expect(rivienSelitteet()).toEqual(['Maaliskuun myynti', 'Helmikuun myynti', 'Vanha myynti']);
    });

    it('lajittelu luetaan osoitteesta ja säilyy tositteesta palatessa', async () => {
      const { user, router } = await haettava();
      await user.click(otsikkoNappi('Lajittele summan mukaan'));
      await user.click(screen.getByText('Helmikuun myynti'));
      await waitFor(() => expect(screen.getByLabelText('tosite')).toBeInTheDocument());
      router.history.back();
      await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
      expect(sarakeotsikko('Lajittele summan mukaan')).toHaveAttribute('aria-sort', 'ascending');
    });

    it('vioittunut hakuparametri putoaa oletukseen', async () => {
      await renderRoute('/tositteet?jarj=roskaa&suunta=ylos', {
        seed: SEED,
        arrange: async (c) => {
          await c.luoTosite(myynti('2026-03-01', 25_000, 'Maaliskuun myynti'));
        },
      });
      await screen.findByText('250,00 €');
      expect(sarakeotsikko('Lajittele päivämäärän mukaan')).toHaveAttribute(
        'aria-sort',
        'descending',
      );
    });
  });

  describe('Kaikki / Tulot / Menot', () => {
    const SEED_RAHAVIRTA = {
      ...SEED,
      tilit: [...SEED.tilit, { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } }],
    };
    const meno = (pvm: string, snt: number, otsikko: string, alvKoodi = 0) => ({
      pvm,
      tyyppi: 100,
      sarja: '',
      tila: 100,
      otsikko,
      viennit: [
        {
          tili: 4000,
          debet: Euro.fromCents(snt),
          kredit: Euro.fromCents(0),
          pvm,
          alvKoodi,
          alvProsentti: 0,
        },
        {
          tili: 1910,
          debet: Euro.fromCents(0),
          kredit: Euro.fromCents(snt),
          pvm,
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });
    async function sekalainen() {
      return renderRoute('/tositteet', {
        seed: SEED_RAHAVIRTA,
        arrange: async (c) => {
          await c.luoTosite(myynti('2026-03-01', 25_000, 'Revontuli'));
          await c.luoTosite(meno('2026-03-02', 4_000, 'Toimistotarvikkeet'));
        },
      });
    }

    it('oletuksena Kaikki; Tulot ja Menot rajaavat ja näyttävät laskusarakkeet', async () => {
      const { user, router } = await sekalainen();
      await screen.findByText('Revontuli');
      expect(screen.getByText('Toimistotarvikkeet')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Kaikki', pressed: true })).toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: /Eräpvm/ })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Menot' }));
      await screen.findByRole('columnheader', { name: /Eräpvm/ });
      expect(screen.getByText('Toimistotarvikkeet')).toBeInTheDocument();
      expect(screen.queryByText('Revontuli')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Erääntyneet' })).toBeInTheDocument();
      expect(router.state.location.search).toEqual({ laji: 'menot' });

      await user.click(screen.getByRole('button', { name: 'Tulot' }));
      await screen.findByText('Revontuli');
      expect(screen.queryByText('Toimistotarvikkeet')).not.toBeInTheDocument();
    });

    it('näyttää kuittikuvakkeen ja alkuperälipun ilman näkyvää tekstiä', async () => {
      await renderRoute('/tositteet', {
        seed: SEED_RAHAVIRTA,
        arrange: async (c) => {
          const kuitillinen = await c.luoTosite(meno('2026-03-02', 4_000, 'Kuitillinen', 21));
          await c.tallennaLiite({
            tosite: kuitillinen.id,
            nimi: 'kuitti.jpg',
            tyyppi: 'image/jpeg',
            luotu: '2026-03-02T00:00:00.000Z',
            data: new Uint8Array([1]),
          });
          await c.luoTosite(meno('2026-03-03', 2_000, 'Kuititon', 25));
        },
      });
      const kuitillinen = (await screen.findByText('Kuitillinen')).closest('tr') as HTMLElement;
      const kuititon = screen.getByText('Kuititon').closest('tr') as HTMLElement;

      expect(within(kuitillinen).getByRole('img', { name: '1 liite' })).toBeInTheDocument();
      expect(within(kuitillinen).getByRole('img', { name: 'Kotimaa' })).toHaveTextContent('🇫🇮');
      expect(within(kuititon).getByRole('img', { name: 'Ei kuittia' })).toHaveAttribute(
        'title',
        'Ei kuittia',
      );
      expect(within(kuititon).getByRole('img', { name: 'EU' })).toBeInTheDocument();
      expect(within(kuititon).queryByText('Ei kuittia')).not.toBeInTheDocument();
    });

    it('luonnos näkyy Menot-rajauksella Luonnokset-ryhmässä ja avaa tositteen', async () => {
      const { user } = await renderRoute('/tositteet?laji=menot', {
        seed: SEED_RAHAVIRTA,
        arrange: async (c) => {
          await c.luoTosite({ ...meno('2026-03-05', 1_000, 'Kahvila'), tila: 50 });
        },
      });
      await screen.findByText('Ei menoja. Luo ensimmäinen ostolasku.');
      await user.click(screen.getByRole('button', { name: 'Luonnokset' }));
      const rivi = (await screen.findByText('Kahvila')).closest('tr') as HTMLElement;
      expect(within(rivi).getByText('Luonnos')).toBeInTheDocument();
      await user.click(rivi);
      await waitFor(() => expect(screen.getByLabelText('tosite')).toBeInTheDocument());
    });
  });

  describe('kumppanirajaus', () => {
    async function kumppaneittain() {
      let adobe = 0;
      const tulos = await renderRoute('/tositteet', {
        seed: SEED,
        arrange: async (c) => {
          adobe = (await c.tallennaKumppani({ nimi: 'Adobe' })).id;
          const muu = (await c.tallennaKumppani({ nimi: 'Muu Oy' })).id;
          await c.luoTosite({ ...myynti('2026-03-01', 25_000, 'Lisenssi'), kumppani: adobe });
          await c.luoTosite({ ...myynti('2026-03-02', 4_000, 'Muu myynti'), kumppani: muu });
          await c.luoTosite(myynti('2026-03-03', 1_000, 'Ilman kumppania'));
          // Pennissä luotu, kumppaniton tosite, jonka otsikko on kumppanin nimi.
          await c.luoTosite(myynti('2026-03-04', 2_000, 'ADOBE'));
        },
      });
      return { ...tulos, adobe };
    }

    it('osoitteen kumppani rajaa tositteet ja näkyy poistettavana rajauksena', async () => {
      const { user, router, adobe } = await kumppaneittain();
      await screen.findByText('Ilman kumppania');
      await router.navigate({ to: '/tositteet', search: { kumppani: adobe } });
      await screen.findByText('Kumppani: Adobe');
      await waitFor(() => expect(screen.queryByText('Muu myynti')).not.toBeInTheDocument());
      expect(screen.getByText('Lisenssi')).toBeInTheDocument();
      expect(screen.getByText('ADOBE')).toBeInTheDocument();
      expect(screen.queryByText('Ilman kumppania')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Poista kumppanirajaus' }));
      await screen.findByText('Muu myynti');
      expect(screen.queryByText('Kumppani: Adobe')).not.toBeInTheDocument();
      expect(router.state.location.search).toEqual({});
    });

    it('rajaus säilyy lajia vaihdettaessa ja koskee myös tuloja', async () => {
      const { user, router, adobe } = await kumppaneittain();
      await router.navigate({ to: '/tositteet', search: { kumppani: adobe } });
      await screen.findByText('Lisenssi');
      await user.click(screen.getByRole('button', { name: 'Tulot' }));
      await screen.findByRole('columnheader', { name: /Eräpvm/ });
      expect(router.state.location.search).toEqual({ laji: 'tulot', kumppani: adobe });
      expect(screen.getByText('Lisenssi')).toBeInTheDocument();
      expect(screen.queryByText('Muu myynti')).not.toBeInTheDocument();
    });
  });

  describe('suodatinmuisti', () => {
    it('palauttaa viimeksi valitut suodattimet, kun näkymä avataan uudelleen', async () => {
      const eka = await selaus();
      await screen.findByText('250,00 €');
      await eka.user.click(screen.getByRole('button', { name: 'Luonnokset' }));
      await eka.user.click(qNappi('Q2'));
      await eka.user.click(screen.getByRole('button', { name: 'Menot' }));
      eka.unmount();

      await renderRoute('/tositteet', { seed: SEED });
      await screen.findByRole('group', { name: 'Aikaväli' });
      expect(screen.getByRole('button', { name: 'Luonnokset' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Menot' })).toHaveAttribute('aria-pressed', 'true');
      expect(qNappi('Q2')).toHaveAttribute('aria-pressed', 'true');
      // Väli lasketaan valinnasta vasta kun tilikaudet on haettu.
      await waitFor(() => expect(screen.getByLabelText('Alkaen')).toHaveValue('2026-04-01'));
    });

    it('muistaa käsin syötetyn välin päivinä', async () => {
      const eka = await selaus();
      await screen.findByText('250,00 €');
      const alkaen = screen.getByLabelText('Alkaen');
      await eka.user.clear(alkaen);
      await eka.user.type(alkaen, '2026-02-15');
      eka.unmount();

      await selaus();
      await screen.findByText('250,00 €');
      expect(screen.getByLabelText('Alkaen')).toHaveValue('2026-02-15');
      expect(painetutAikavalit()).toHaveLength(0);
    });

    it('osoitteen laji voittaa muistetun', async () => {
      const eka = await selaus();
      await screen.findByText('250,00 €');
      await eka.user.click(screen.getByRole('button', { name: 'Menot' }));
      eka.unmount();

      await renderRoute('/tulot', { seed: SEED });
      await screen.findByRole('group', { name: 'Aikaväli' });
      expect(screen.getByRole('button', { name: 'Tulot' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('vioittunut muisti putoaa oletuksiin', async () => {
      window.localStorage.setItem('penni.suodattimet.tositteet', '{"bucket":"x","valinta":7');
      await selaus();
      await screen.findByText('250,00 €');
      expect(painetutAikavalit().map((n) => n.textContent)).toEqual(['Tämä vuosi']);
      expect(screen.getByLabelText('Alkaen')).toHaveValue('2026-01-01');
      expect(screen.getByRole('button', { name: 'Kirjanpidossa' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  describe('näytetyn järjestyksen tallennus (Edellinen/Seuraava)', () => {
    const kolme = async (c: KpClient) => {
      await c.luoTosite(myynti('2026-04-01', 30_000, 'Eka')); // id 1
      await c.luoTosite(myynti('2026-04-02', 10_000, 'Toka')); // id 2
      await c.luoTosite(myynti('2026-04-03', 20_000, 'Kolmas')); // id 3
    };

    it('tallentaa rivit täsmälleen näytetyssä järjestyksessä haun ja lajittelun jälkeen', async () => {
      const { user } = await renderRoute('/tositteet?jarj=summa&suunta=laskeva', {
        seed: SEED,
        arrange: kolme,
      });
      await screen.findByText('100,00 €');
      await waitFor(() =>
        expect(lueListanJarjestys()).toEqual({ bucket: 'kirjanpidossa', idt: [1, 3, 2] }),
      );
      await user.type(screen.getByRole('searchbox', { name: 'Hae tositteita' }), 'ka');
      await waitFor(() =>
        expect(lueListanJarjestys()).toEqual({ bucket: 'kirjanpidossa', idt: [1, 2] }),
      );
    });

    it('tallentaa myös Tulot-rajauksen rivien järjestyksen', async () => {
      await renderRoute('/tositteet?laji=tulot&jarj=summa&suunta=nouseva', {
        seed: SEED,
        arrange: kolme,
      });
      await screen.findByText('Toka');
      await waitFor(() =>
        expect(lueListanJarjestys()).toEqual({ bucket: 'kirjanpidossa', idt: [2, 3, 1] }),
      );
    });

    it('tyhjä tulos tallentuu tyhjänä listana', async () => {
      const { user } = await renderRoute('/tositteet', { seed: SEED, arrange: kolme });
      await screen.findByText('Toka');
      await user.type(screen.getByRole('searchbox', { name: 'Hae tositteita' }), 'ei osumia');
      await screen.findByText('Ei tositteita valituilla ehdoilla.');
      await waitFor(() =>
        expect(lueListanJarjestys()).toEqual({ bucket: 'kirjanpidossa', idt: [] }),
      );
    });
  });
});

describe('Tositeselaus — tiliotteen loppusaldo', () => {
  const tiliote = (loppusaldo: number) => ({
    pvm: '2026-03-31',
    tyyppi: 400,
    sarja: '',
    tila: 100,
    otsikko: 'Tiliote 3/2026',
    viennit: [],
    tiliote: {
      tili: 1910,
      alkupvm: '2026-03-01',
      loppupvm: '2026-03-31',
      loppusaldo: Euro.fromCents(loppusaldo),
    },
  });

  it('näyttää loppusaldon vihreänä, kun kirjanpidon pankkisaldo täsmää', async () => {
    await renderRoute('/tositteet', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite(myynti('2026-03-01', 25_000));
        await c.luoTosite(tiliote(25_000));
      },
    });
    const summa = await screen.findByLabelText(/Loppusaldo 250,00 €\. .*täsmää/);
    expect(summa.className).toContain('text-[var(--positive)]');
  });

  it('näyttää loppusaldon punaisena ja erotuksen, kun saldo ei täsmää', async () => {
    await renderRoute('/tositteet', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite(myynti('2026-03-01', 25_000));
        await c.luoTosite(tiliote(30_000));
      },
    });
    const summa = await screen.findByLabelText(/Loppusaldo 300,00 €\. .*erotus 50,00 €/);
    expect(summa.className).toContain('text-[var(--danger)]');
  });
});
