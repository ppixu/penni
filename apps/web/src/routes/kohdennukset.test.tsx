import { renderRoute } from '@/test/renderRoute';
import { KohdennusTyyppi } from '@penni/engine';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy' },
};

const { KUSTANNUSPAIKKA, PROJEKTI, MERKKAUS } = KohdennusTyyppi;

async function siemen(client: import('@penni/asiakas').KpClient) {
  const kp = await client.tallennaKohdennus({
    tyyppi: KUSTANNUSPAIKKA,
    nimi: { fi: 'Nuorisotoiminta' },
  });
  await client.tallennaKohdennus({ tyyppi: PROJEKTI, kuuluu: kp.id, nimi: { fi: 'Kesäleiri' } });
  await client.tallennaKohdennus({ tyyppi: MERKKAUS, nimi: { fi: 'Avustus' } });
}

describe('/kohdennukset', () => {
  it('luo kustannuspaikan, projektin sen alle ja merkkauksen; lista sisentää projektin', async () => {
    const { user, client, storage } = await renderRoute('/kohdennukset', { seed: SEED });
    expect(await screen.findByText('Ei kohdennuksia.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Uusi kustannuspaikka' }));
    await user.type(screen.getByLabelText('Nimi'), 'Kerhotalo');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await screen.findByRole('button', { name: 'Muokkaa Kerhotalo' });

    await user.click(screen.getByRole('button', { name: 'Uusi projekti' }));
    await user.type(screen.getByLabelText('Nimi'), 'Remontti');
    await user.selectOptions(screen.getByLabelText('Kuuluu'), 'Kerhotalo');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await screen.findByRole('button', { name: 'Muokkaa Kerhotalo/Remontti' });

    await user.click(screen.getByRole('button', { name: 'Uusi merkkaus' }));
    await user.type(screen.getByLabelText('Nimi'), 'Avustus');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await screen.findByRole('button', { name: 'Muokkaa Avustus' });

    const kustannuspaikat = screen.getByRole('region', { name: 'Kustannuspaikat' });
    const rivit = within(kustannuspaikat).getAllByRole('listitem');
    expect(rivit.map((r) => [r.getAttribute('data-taso'), r.textContent])).toEqual([
      ['0', expect.stringContaining('Kerhotalo')],
      ['1', expect.stringContaining('Remontti')],
    ]);
    const tallennetut = await client.haeKohdennukset();
    expect(tallennetut.map((k) => [k.nimi.fi, k.tyyppi, k.kuuluu])).toEqual([
      ['Kerhotalo', KUSTANNUSPAIKKA, undefined],
      ['Remontti', PROJEKTI, tallennetut[0]?.id],
      ['Avustus', MERKKAUS, undefined],
    ]);
    // UI ei lähetä johdettua lkm-kenttää: tallennetuilla riveillä ei ole sitä.
    expect((await storage.getKohdennukset()).some((k) => 'lkm' in k)).toBe(false);
  });

  it('listaa kustannuspaikan projekteineen ja merkkaukset omissa ryhmissään', async () => {
    await renderRoute('/kohdennukset', { seed: SEED, arrange: siemen });
    const kp = await screen.findByRole('region', { name: 'Kustannuspaikat' });
    const rivit = within(kp).getAllByRole('listitem');
    expect(rivit).toHaveLength(2);
    expect(rivit[1]).toHaveAttribute('data-taso', '1');
    expect(rivit[1]).toHaveTextContent('Projekti');
    const merkkaukset = screen.getByRole('region', { name: 'Merkkaukset' });
    expect(within(merkkaukset).getByText('Avustus')).toBeInTheDocument();
  });

  it('projekti Yleisen alla näkyy Yleinen-ryhmässä', async () => {
    await renderRoute('/kohdennukset', {
      seed: SEED,
      arrange: async (c) => {
        await c.tallennaKohdennus({ tyyppi: PROJEKTI, nimi: { fi: 'Arpajaiset' } });
      },
    });
    const yleinen = await screen.findByRole('region', { name: 'Yleinen' });
    expect(within(yleinen).getByText('Arpajaiset')).toBeInTheDocument();
  });

  it('muokkaus nimeää uudelleen, säilyttää lomakkeen ulkopuoliset kentät eikä tallenna lkm:ää', async () => {
    const { user, client, storage } = await renderRoute('/kohdennukset', {
      seed: SEED,
      arrange: async (c) => {
        const kp = await c.tallennaKohdennus({
          tyyppi: KUSTANNUSPAIKKA,
          nimi: { fi: 'Nuorisotoiminta', sv: 'Ungdom' },
          kitsasAvain: 7,
        });
        await c.tallennaKohdennus({ tyyppi: PROJEKTI, kuuluu: kp.id, nimi: { fi: 'Kesäleiri' } });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Muokkaa Nuorisotoiminta' }));
    const nimi = screen.getByLabelText('Nimi');
    await user.clear(nimi);
    await user.type(nimi, 'Nuoriso');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await screen.findByRole('button', { name: 'Muokkaa Nuoriso' });
    await screen.findByRole('button', { name: 'Muokkaa Nuoriso/Kesäleiri' });
    expect(await client.haeKohdennukset()).toHaveLength(2);
    expect((await storage.getKohdennukset()).find((k) => k.tyyppi === KUSTANNUSPAIKKA)).toEqual({
      id: 1,
      tyyppi: KUSTANNUSPAIKKA,
      nimi: { fi: 'Nuoriso', sv: 'Ungdom' },
      kitsasAvain: 7,
    });
  });

  it('Määräaikainen paljastaa päivät tilikaudesta ja tallentaa ne; voimassaolo näkyy listalla', async () => {
    const { user } = await renderRoute('/kohdennukset', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: 'Uusi merkkaus' }));
    expect(screen.queryByLabelText('Alkaa')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Nimi'), 'Kampanja');
    await user.click(screen.getByLabelText('Määräaikainen'));
    expect(screen.getByLabelText('Alkaa')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('Päättyy')).toHaveValue('2026-12-31');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText('Voimassa 1.1.2026–31.12.2026')).toBeInTheDocument();
  });

  it('käytössä olevan kohdennuksen tyyppi on lukittu ja poisto estetty selityksellä', async () => {
    const { user } = await renderRoute('/kohdennukset', {
      seed: SEED,
      arrange: async (client) => {
        const kp = await client.tallennaKohdennus({
          tyyppi: KUSTANNUSPAIKKA,
          nimi: { fi: 'Kerhotalo' },
        });
        await client.luoTosite({
          pvm: '2026-06-01',
          tyyppi: 0,
          sarja: '',
          viennit: [
            { tili: 1900, debet: 100, kredit: 0, pvm: '2026-06-01', alvKoodi: 0, alvProsentti: 0 },
            {
              tili: 3000,
              debet: 0,
              kredit: 100,
              pvm: '2026-06-01',
              alvKoodi: 0,
              alvProsentti: 0,
              kohdennus: kp.id,
            },
          ],
        } as never);
      },
    });
    const poista = await screen.findByRole('button', { name: 'Poista Kerhotalo' });
    expect(poista).toBeDisabled();
    expect(poista).toHaveAttribute('title', 'Käytössä 1 viennillä');
    await user.click(screen.getByRole('button', { name: 'Muokkaa Kerhotalo' }));
    expect(screen.getByLabelText('Tyyppi')).toBeDisabled();
  });

  it('budjetoidun kohdennuksen tyyppi on lukittu selityksellä', async () => {
    const { user } = await renderRoute('/kohdennukset', {
      seed: SEED,
      arrange: async (client) => {
        const kp = await client.tallennaKohdennus({
          tyyppi: KUSTANNUSPAIKKA,
          nimi: { fi: 'Kerhotalo' },
        });
        await client.tallennaKohdennus({ tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Vapaa' } });
        await client.tallennaBudjetti('2026-01-01', [
          { kohdennus: kp.id, tili: 3000, sentit: 500 as never },
        ]);
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Muokkaa Kerhotalo' }));
    await waitFor(() => expect(screen.getByLabelText('Tyyppi')).toBeDisabled());
    expect(screen.getByLabelText('Tyyppi')).toHaveAttribute(
      'title',
      'Kohdennuksella on budjetti, tyyppiä ei voi vaihtaa',
    );
    await user.click(screen.getByRole('button', { name: 'Peruuta' }));
    await user.click(screen.getByRole('button', { name: 'Muokkaa Vapaa' }));
    expect(screen.getByLabelText('Tyyppi')).toBeEnabled();
  });

  it('kustannuspaikan poisto estetty, kun sillä on projekteja', async () => {
    await renderRoute('/kohdennukset', { seed: SEED, arrange: siemen });
    const poista = await screen.findByRole('button', { name: 'Poista Nuorisotoiminta' });
    expect(poista).toBeDisabled();
    expect(poista).toHaveAttribute('title', 'Kustannuspaikalla on projekteja');
  });

  it('käyttämättömän poisto vaatii vahvistuksen ja poistaa', async () => {
    const { user, client } = await renderRoute('/kohdennukset', { seed: SEED, arrange: siemen });
    await user.click(await screen.findByRole('button', { name: 'Poista Avustus' }));
    await user.click(screen.getByRole('button', { name: 'Vahvista poisto: Avustus' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Muokkaa Avustus' })).not.toBeInTheDocument(),
    );
    expect((await client.haeKohdennukset()).map((k) => k.nimi.fi)).toEqual([
      'Nuorisotoiminta',
      'Kesäleiri',
    ]);
  });

  it('lomake tarkistaa päivämäärävälin paikallisesti', async () => {
    const { user } = await renderRoute('/kohdennukset', {
      seed: SEED,
      arrange: async (c) => {
        await c.tallennaKohdennus({ tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Kerhotalo' } });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Muokkaa Kerhotalo' }));
    await user.click(screen.getByLabelText('Määräaikainen'));
    await user.clear(screen.getByLabelText('Alkaa'));
    await user.type(screen.getByLabelText('Alkaa'), '2026-12-31');
    await user.clear(screen.getByLabelText('Päättyy'));
    await user.type(screen.getByLabelText('Päättyy'), '2026-01-01');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Päättymispäivä/);
  });

  it('palvelimen ResourceError näkyy lomakkeella, ja lomake jää auki', async () => {
    const { user, client } = await renderRoute('/kohdennukset', {
      seed: SEED,
      arrange: async (c) => {
        await c.tallennaKohdennus({ tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Kerhotalo' } });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Uusi projekti' }));
    await user.type(screen.getByLabelText('Nimi'), 'Remontti');
    await user.selectOptions(screen.getByLabelText('Kuuluu'), 'Kerhotalo');
    // Kustannuspaikka poistuu palvelimelta lomakkeen ollessa auki (lista ei ole vielä päivittynyt).
    const [kerhotalo] = await client.haeKohdennukset();
    await client.poistaKohdennus(kerhotalo?.id as number);
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Projektin on kuuluttava kustannuspaikkaan tai Yleiseen',
    );
    expect(screen.getByLabelText('Nimi')).toHaveValue('Remontti');
  });

  it('palvelimen ResourceError poistossa näkyy sivulla', async () => {
    const { user, client } = await renderRoute('/kohdennukset', { seed: SEED, arrange: siemen });
    await user.click(await screen.findByRole('button', { name: 'Poista Avustus' }));
    // Merkkaus tulee käyttöön vahvistusvaiheen aikana (lista ei ole vielä päivittynyt).
    const avustus = (await client.haeKohdennukset()).find((k) => k.nimi.fi === 'Avustus');
    await client.luoTosite({
      pvm: '2026-06-01',
      tyyppi: 0,
      sarja: '',
      viennit: [
        { tili: 1900, debet: 100, kredit: 0, pvm: '2026-06-01', alvKoodi: 0, alvProsentti: 0 },
        {
          tili: 3000,
          debet: 0,
          kredit: 100,
          pvm: '2026-06-01',
          alvKoodi: 0,
          alvProsentti: 0,
          merkkaukset: [avustus?.id],
        },
      ],
    } as never);
    await user.click(screen.getByRole('button', { name: 'Vahvista poisto: Avustus' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kohdennusta käytetään 1 kirjauksessa, eikä sitä voi poistaa',
    );
    expect(screen.getByRole('button', { name: 'Muokkaa Avustus' })).toBeInTheDocument();
  });

  it('nimi on pakollinen', async () => {
    const { user } = await renderRoute('/kohdennukset', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: 'Uusi projekti' }));
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Anna kohdennuksen nimi.');
  });

  it('näyttää Mikä tämä on? -ohjeen esimerkkeineen', async () => {
    await renderRoute('/kohdennukset', { seed: SEED });
    const yhteenveto = await screen.findByText('Mikä tämä on?');
    expect(yhteenveto.closest('details')).toHaveTextContent('Kesäleiri');
  });
});

describe('Asetukset — Kohdennukset-osio', () => {
  it('näyttää määrän ja linkin Kohdennukset-sivulle', async () => {
    const { user, router } = await renderRoute('/asetukset', { seed: SEED, arrange: siemen });
    expect(await screen.findByText('3 kohdennusta')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Muokkaa kohdennuksia' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/kohdennukset'));
    expect(await screen.findByRole('button', { name: 'Uusi kustannuspaikka' })).toBeInTheDocument();
  });

  it('ilman kohdennuksia kertoo, ettei niitä vielä ole', async () => {
    await renderRoute('/asetukset', { seed: SEED });
    expect(await screen.findByText('Ei vielä kohdennuksia.')).toBeInTheDocument();
  });
});
