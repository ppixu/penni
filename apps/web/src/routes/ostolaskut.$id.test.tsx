import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Arvonlisäverosaatava' } },
    { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden voitto' } },
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

/** Yksi veroton ostolasku (50,00 €): kaksi vientiä (menotili debet, ostovelkatili kredit). */
async function siemenna(c: KpClient) {
  const toimittaja = await c.tallennaKumppani({ nimi: 'Tukku Oy' });
  return c.tallennaOstolasku({
    pvm: '2026-05-01',
    erapvm: '2026-08-01',
    viite: 'V-1',
    kumppani: toimittaja.id,
    rivit: [{ myyntiKpl: 1, aNetto: 50, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
  });
}

describe('Ostolaskunäkymä', () => {
  it('näyttää otsikkotiedot, tositteen viennit ja kirjaa suorituksia', async () => {
    let id = 0;
    const { user } = await renderRoute('/ostolaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        const tosite = await siemenna(c);
        id = tosite.id;
      },
    });

    // renderRoute navigoi kiinteään '/ostolaskut/1' polkuun; ostolasku on ensimmäinen
    // luotu tosite, joten sen id on aina 1 tässä testissä (varmistetaan silti).
    expect(id).toBe(1);

    const sivu = await screen.findByLabelText('ostolaskunäkymä');

    // Otsikkotiedot.
    expect(within(sivu).getByText('Tukku Oy')).toBeInTheDocument();
    expect(within(sivu).getByText('V-1')).toBeInTheDocument();
    expect(within(sivu).getByText('1.5.2026')).toBeInTheDocument(); // laskun pvm
    expect(within(sivu).getByText('1.8.2026')).toBeInTheDocument(); // eräpäivä

    // Tila: summa ja avoin ovat yhtä suuret alussa (ei suorituksia).
    expect(within(sivu).getAllByText('50,00 €').length).toBeGreaterThanOrEqual(2);

    // Viennit: menotili ja ostovelkatili nimineen.
    expect(within(sivu).getByText('4000 Ostot')).toBeInTheDocument();
    expect(within(sivu).getByText('2871 Ostovelat')).toBeInTheDocument();

    // Kirjaa suoritus: osittainen maksu (20,00 €) → avoin pienenee.
    await user.click(screen.getByRole('button', { name: 'Kirjaa suoritus' }));
    const dialogi1 = await screen.findByRole('dialog', { name: 'Kirjaa maksu' });
    const summaKentta1 = within(dialogi1).getByLabelText('Summa');
    await user.clear(summaKentta1);
    await user.type(summaKentta1, '20');
    await user.tab(); // EuroInput committoi blurissa
    await user.click(within(dialogi1).getByRole('button', { name: 'Tallenna' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Kirjaa maksu' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(within(sivu).getByText('30,00 €')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Kirjaa suoritus' })).not.toBeDisabled();

    // Loppusumman maksu (30,00 €) → avoin nollaan, Kirjaa suoritus disabloituu.
    await user.click(screen.getByRole('button', { name: 'Kirjaa suoritus' }));
    const dialogi2 = await screen.findByRole('dialog', { name: 'Kirjaa maksu' });
    await user.click(within(dialogi2).getByRole('button', { name: 'Tallenna' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Kirjaa maksu' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Kirjaa suoritus' })).toBeDisabled(),
    );
  });

  it('estää hyvityksen osittain maksetulle laskulle ja disabloi suorituksen kirjaamisen täysin maksetulle', async () => {
    let id = 0;
    const { user } = await renderRoute('/ostolaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        const toimittaja = await c.tallennaKumppani({ nimi: 'Tukku Oy' });
        const tosite = await c.tallennaOstolasku({
          pvm: '2026-05-01',
          erapvm: '2026-08-01',
          viite: 'V-2',
          kumppani: toimittaja.id,
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
        });
        id = tosite.id;
        // Osittainen maksu (40,00 €) ennen renderöintiä -> avoin 60,00 € (≠ summa 100,00 €).
        await c.tallennaSuoritus({ tosite: id, pvm: '2026-05-10', summa: Euro.fromCents(4_000) });
      },
    });
    expect(id).toBe(1);

    const sivu = await screen.findByLabelText('ostolaskunäkymä');
    expect(within(sivu).getByText('Summa').nextElementSibling).toHaveTextContent('100,00 €');
    expect(within(sivu).getByText('Avoinna').nextElementSibling).toHaveTextContent('60,00 €');

    // Osittain maksettu: avoin (60,00 €) ≠ summa (100,00 €) → Hyvitä disabloitu.
    // Kirjaa suoritus pysyy käytössä (avoin > 0).
    expect(screen.getByRole('button', { name: 'Hyvitä' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kirjaa suoritus' })).not.toBeDisabled();

    // Loppuosan maksu (60,00 €) UI:sta → avoin nollaan → Kirjaa suoritus disabloituu
    // (Hyvitä pysyy disabloituna, koska avoin edelleen ≠ summa).
    await user.click(screen.getByRole('button', { name: 'Kirjaa suoritus' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Kirjaa maksu' });
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Kirjaa maksu' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(within(sivu).getByText('0,00 €')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Kirjaa suoritus' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hyvitä' })).toBeDisabled();
  });

  it('hyvittää laskun kokonaan ja disabloi Hyvitä- ja Kirjaa suoritus -painikkeet', async () => {
    const { user } = await renderRoute('/ostolaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await siemenna(c);
      },
    });

    const sivu = await screen.findByLabelText('ostolaskunäkymä');
    expect(within(sivu).getAllByText('50,00 €').length).toBeGreaterThanOrEqual(2);

    // Täysin avoin lasku (avoin === summa): Hyvitä on käytössä.
    expect(screen.getByRole('button', { name: 'Hyvitä' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Hyvitä' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Hyvitä lasku' });
    expect(within(dialogi).getByText('Hyvitetäänkö lasku kokonaan?')).toBeInTheDocument();
    await user.click(within(dialogi).getByRole('button', { name: 'Hyvitä' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Hyvitä lasku' })).not.toBeInTheDocument(),
    );

    // Avoinna nollautuu ja molemmat toiminnot disabloituvat (täysi hyvitys).
    await waitFor(() => expect(within(sivu).getByText('0,00 €')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Hyvitä' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kirjaa suoritus' })).toBeDisabled();
  });

  it('vieras tositetyyppi ohjaa tositelistan Menot-rajaukseen', async () => {
    const { router } = await renderRoute('/ostolaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        // Tavallinen tosite (ei ostolasku) — ei löydy ostolaskulistalta.
        await c.luoTosite({
          pvm: '2026-05-01',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [
            {
              tili: 1900,
              debet: Euro.fromCents(1_000),
              kredit: Euro.fromCents(0),
              pvm: '2026-05-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 4000,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(1_000),
              pvm: '2026-05-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        });
      },
    });
    // OstolaskuDetalji ohjaa suoraan tositteiden Menot-rajaukseen (korvasi Ostolaskut-listan).
    await waitFor(() => expect(screen.getByLabelText('tositteselaus')).toBeInTheDocument());
    expect(router.state.location.search).toEqual({ laji: 'menot' });
  });
});

describe('Ostolaskunäkymä — Edellinen / Seuraava', () => {
  it('selaa ostolaskuja numerojärjestyksessä ohittaen muut tositteet', async () => {
    const { user, router } = await renderRoute('/ostolaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await siemenna(c); // id 1
        await c.luoTosite({
          pvm: '2026-05-02',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [
            {
              tili: 1900,
              debet: Euro.fromCents(1_000),
              kredit: Euro.fromCents(0),
              pvm: '2026-05-02',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 4000,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(1_000),
              pvm: '2026-05-02',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        }); // id 2, ei ostolasku
        await c.tallennaOstolasku({
          pvm: '2026-04-01',
          erapvm: '2026-08-01',
          viite: 'V-3',
          rivit: [{ myyntiKpl: 1, aNetto: 20, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
        }); // id 3
      },
    });
    expect(await screen.findByText('Ostolasku V-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edellinen lasku' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Seuraava lasku' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ostolaskut/3'));
    expect(await screen.findByText('Ostolasku V-3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seuraava lasku' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Edellinen lasku' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ostolaskut/1'));
  });
});
