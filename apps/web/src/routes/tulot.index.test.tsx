import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto' } },
    { numero: 2361, tyyppi: 'BY', nimi: { fi: 'Yksityissijoitukset rahana' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden voitto' } },
    { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'true' },
};

/** Yksi suora myynti (100,00 + 25,50 alv) ja yksi yksityissijoitus (70,00). */
async function siemenna(c: KpClient) {
  await c.luoTosite({
    pvm: '2026-03-01',
    tyyppi: 200,
    sarja: '',
    otsikko: 'Revontuli',
    viennit: [
      {
        tili: 1900,
        debet: Euro.fromCents(12550),
        kredit: Euro.fromCents(0),
        pvm: '2026-03-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili: 3000,
        debet: Euro.fromCents(0),
        kredit: Euro.fromCents(10000),
        pvm: '2026-03-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili: 2939,
        debet: Euro.fromCents(0),
        kredit: Euro.fromCents(2550),
        pvm: '2026-03-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
    ],
  });
  await c.luoTosite({
    pvm: '2026-03-02',
    tyyppi: 200,
    sarja: '',
    otsikko: 'Yksityissijoitus',
    viennit: [
      {
        tili: 1900,
        debet: Euro.fromCents(7000),
        kredit: Euro.fromCents(0),
        pvm: '2026-03-02',
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili: 2361,
        debet: Euro.fromCents(0),
        kredit: Euro.fromCents(7000),
        pvm: '2026-03-02',
        alvKoodi: 0,
        alvProsentti: 0,
      },
    ],
  });
}

const SEED_LASKU = {
  ...SEED,
  tilit: [...SEED.tilit, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } }],
  asetukset: {
    ...SEED.asetukset,
    OletusMyyntitili: '3000',
    LaskuSaatavaTili: '1701',
    AlvVelkaTili: '2939',
    LaskuMaksutili: '1900',
  },
};

/** Yksi myyntilasku (tyyppi 210) — erottuu Laji-sarakkeessa suorasta myynnistä. Otsikko asetettu
 *  jotta Selite-sarakkeen Nro+otsikko-yhdistelmä on testattavissa yksiselitteisesti. */
async function siemennaLasku(c: KpClient) {
  const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
  await c.tallennaMyyntilasku({
    pvm: '2026-04-01',
    erapvm: '2026-04-15',
    otsikko: 'Konsultointi',
    kumppani: asiakas.id,
    rivit: [{ myyntiKpl: 1, aNetto: 50, alvKoodi: 11, alvProsentti: 25.5 }],
  });
}

const SEED_MAKSU = {
  tilit: [
    { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden voitto' } },
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
  },
};

/** Kolme laskua: A erääntynyt (12,55 €, eräpäivä menneisyydessä), B avoin (25,10 €,
 *  eräpäivä kaukana tulevaisuudessa), C maksettu (8,00 € veroton + täysi suoritus).
 *  Eräpäivät on valittu niin, ettei "tänään"-kellonluenta voi kääntää tulosta.
 *  Siirretty myyntilaskut.index.test.tsx:stä — direct sale ei kerrytä avointa saldoa,
 *  joten Kirjaa maksu -toiminto tarvitsee testattavakseen oikean laskun. */
async function siemennaMaksu(c: KpClient) {
  const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
  await c.tallennaMyyntilasku({
    pvm: '2026-01-10',
    erapvm: '2026-01-15',
    kumppani: asiakas.id,
    rivit: [{ myyntiKpl: 1, aNetto: 10, alvKoodi: 11, alvProsentti: 25.5 }],
  });
  await c.tallennaMyyntilasku({
    pvm: '2026-06-01',
    erapvm: '2099-12-31',
    kumppani: asiakas.id,
    rivit: [{ myyntiKpl: 1, aNetto: 20, alvKoodi: 11, alvProsentti: 25.5 }],
  });
  const maksettu = await c.tallennaMyyntilasku({
    pvm: '2026-06-02',
    erapvm: '2026-07-01',
    kumppani: asiakas.id,
    rivit: [{ myyntiKpl: 1, aNetto: 8, alvKoodi: 0, alvProsentti: 0 }],
  });
  await c.tallennaSuoritus({ tosite: maksettu.id, pvm: '2026-06-05', summa: Euro.fromCents(800) });
}

describe('Tulot', () => {
  it('näyttää suoran myynnin netto/alv/summa-erittelyllä', async () => {
    await renderRoute('/tulot', { seed: SEED, arrange: siemenna });
    const sivu = await screen.findByLabelText('tositteselaus');

    expect(await within(sivu).findByText('Revontuli')).toBeInTheDocument();
    expect(within(sivu).getByText('100,00 €')).toBeInTheDocument();
    expect(within(sivu).getByText('25,50 €')).toBeInTheDocument();
    expect(within(sivu).getByText('125,50 €')).toBeInTheDocument();
    expect(within(sivu).getByText('Suora')).toBeInTheDocument();
  });

  it('ei näytä yksityissijoitusta tulona', async () => {
    await renderRoute('/tulot', { seed: SEED, arrange: siemenna });
    const sivu = await screen.findByLabelText('tositteselaus');

    expect(await within(sivu).findByText('Revontuli')).toBeInTheDocument();
    expect(within(sivu).queryByText('Yksityissijoitus')).not.toBeInTheDocument();
  });

  it('Avoimet-suodatin tyhjentää listan kun eriä ei ole', async () => {
    const { user } = await renderRoute('/tulot', { seed: SEED, arrange: siemenna });
    const sivu = await screen.findByLabelText('tositteselaus');
    await within(sivu).findByText('Revontuli');

    await user.click(within(sivu).getByRole('button', { name: 'Avoimet' }));

    expect(within(sivu).queryByText('Revontuli')).not.toBeInTheDocument();
  });

  it('erottaa laskun suorasta myynnistä Laji-sarakkeessa ja avaa laskudokumentin klikattaessa', async () => {
    const { user } = await renderRoute('/tulot', { seed: SEED_LASKU, arrange: siemennaLasku });
    const sivu = await screen.findByLabelText('tositteselaus');

    const rivi = (await within(sivu).findByText('Lasku')).closest('tr');
    expect(rivi).not.toBeNull();

    await user.click(rivi as HTMLElement);

    expect(await screen.findByLabelText('laskudokumentti')).toBeInTheDocument();
  });

  it('näyttää laskun numeron Selite-sarakkeessa ja eräpäivän Eräpvm-sarakkeessa', async () => {
    await renderRoute('/tulot', { seed: SEED_LASKU, arrange: siemennaLasku });
    const sivu = await screen.findByLabelText('tositteselaus');

    const rivi = (await within(sivu).findByText('1 · Konsultointi')).closest('tr');
    expect(rivi).not.toBeNull();
    expect(within(rivi as HTMLElement).getByText('15.4.2026')).toBeInTheDocument();
  });

  it('myyntilaskun hyvitys badgeaa Lasku ja avaa laskudokumentin', async () => {
    const { user } = await renderRoute('/tulot', {
      seed: SEED_LASKU,
      arrange: async (c) => {
        const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
        const lasku = await c.tallennaMyyntilasku({
          pvm: '2026-04-01',
          erapvm: '2026-04-15',
          kumppani: asiakas.id,
          rivit: [{ myyntiKpl: 1, aNetto: 50, alvKoodi: 11, alvProsentti: 25.5 }],
        });
        // HYVITYSLASKU (214) — ONKO_LASKU.tulot luokittelee sen laskuksi (RahavirtaTaulu.tsx),
        // ja '/myyntilaskut/$id' renderöi sen hyvityslaskudokumenttina.
        await c.tallennaHyvityslasku({
          alkuperainenTosite: lasku.id,
          pvm: '2026-04-02',
          otsikko: 'Hyvitys',
        });
      },
    });
    const sivu = await screen.findByLabelText('tositteselaus');

    const rivi = (await within(sivu).findByText(/Hyvitys$/)).closest('tr');
    expect(rivi).not.toBeNull();
    expect(within(rivi as HTMLElement).getByText('Lasku')).toBeInTheDocument();

    await user.click(rivi as HTMLElement);

    const doc = await screen.findByLabelText('laskudokumentti');
    expect(within(doc).getByText('Hyvityslasku')).toBeInTheDocument();
  });

  it('hyvityslasku ilman alkuperäistä (Kitsas-tuonti) avaa tositteen, ei laskudokumenttia', async () => {
    const { user } = await renderRoute('/tulot', {
      seed: SEED_LASKU,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-02',
          tyyppi: 214,
          sarja: '',
          tila: 100,
          otsikko: 'Tuotu hyvitys',
          viennit: [
            {
              tili: 3000,
              debet: Euro.fromCents(5000),
              kredit: Euro.fromCents(0),
              pvm: '2026-04-02',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 1900,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(5000),
              pvm: '2026-04-02',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        });
      },
    });
    const sivu = await screen.findByLabelText('tositteselaus');

    const rivi = (await within(sivu).findByText('Tuotu hyvitys')).closest('tr');
    expect(rivi).not.toBeNull();
    expect(within(rivi as HTMLElement).getByText('Suora')).toBeInTheDocument();

    await user.click(rivi as HTMLElement);

    expect(await screen.findByLabelText('tosite')).toBeInTheDocument();
    expect(screen.queryByLabelText('laskudokumentti')).not.toBeInTheDocument();
  });

  it('kirjaa täyden maksun ja Avoin päivittyy nollaan', async () => {
    const { user, client } = await renderRoute('/tulot', {
      seed: SEED_MAKSU,
      arrange: siemennaMaksu,
    });
    const sivu = await screen.findByLabelText('tositteselaus');

    const rivi = (await within(sivu).findAllByText('25,10 €'))[0]?.closest('tr');
    expect(rivi).not.toBeNull();
    await user.click(within(rivi as HTMLElement).getByRole('button', { name: 'Kirjaa maksu' }));

    const dialogi = await screen.findByRole('dialog', { name: 'Kirjaa maksu' });
    // Summa esitäytetty avoimella; rahatili esivalittu LaskuMaksutili-asetuksesta.
    expect(within(dialogi).getByLabelText('Summa')).toHaveValue('25,10');
    expect(within(dialogi).getByRole('combobox', { name: 'Rahatili' })).toHaveValue(
      '1900 Pankkitili',
    );
    // otsikko-oletus laskun numerolla (RahavirtaRivi kantaa nyt numero/viite-kentät).
    expect(within(dialogi).getByLabelText('Otsikko')).toHaveValue('Suoritus: lasku 2');
    // Maksupäivä eksplisiittisesti tilikaudelle (ei kellosidontaa).
    const pvmKentta = within(dialogi).getByLabelText('Maksupäivä');
    await user.clear(pvmKentta);
    await user.type(pvmKentta, '2026-06-20');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));

    // Dialogi sulkeutuu ja invalidointi päivittää Avoin-sarakkeen. Kolme 0,00 €:
    // C:n Alv-sarake (veroton lasku), C:n Avoin (jo maksettu siemennässä) ja nyt myös B:n Avoin.
    // RahavirtaTaulu näyttää Netto/Alv omina sarakkeinaan (toisin kuin vanha Laskulista), joten
    // lukumäärä poikkeaa alkuperäisestä myyntilaskut.index.test.tsx:n vastaavasta testistä.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Kirjaa maksu' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(within(sivu).getAllByText('0,00 €')).toHaveLength(3));

    const lista = await client.listaaMyyntilaskut({});
    expect(lista.find((r) => r.numero === '2')?.avoin).toBe(Euro.fromCents(0));
  });

  it('kirjaa osittaisen maksun ja jäännös jää avoimeksi', async () => {
    const { user, client } = await renderRoute('/tulot', {
      seed: SEED_MAKSU,
      arrange: siemennaMaksu,
    });
    const sivu = await screen.findByLabelText('tositteselaus');

    const rivi = (await within(sivu).findAllByText('25,10 €'))[0]?.closest('tr');
    await user.click(within(rivi as HTMLElement).getByRole('button', { name: 'Kirjaa maksu' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Kirjaa maksu' });

    const pvmKentta = within(dialogi).getByLabelText('Maksupäivä');
    await user.clear(pvmKentta);
    await user.type(pvmKentta, '2026-06-20');
    const summaKentta = within(dialogi).getByLabelText('Summa');
    await user.clear(summaKentta);
    await user.type(summaKentta, '10');
    await user.tab(); // EuroInput committoi blurissa
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));

    await waitFor(() => expect(within(sivu).getByText('15,10 €')).toBeInTheDocument());
    expect(within(sivu).getByText('15,10 €')).toHaveAttribute('title', 'Osittain maksettu');
    const lista = await client.listaaMyyntilaskut({});
    expect(lista.find((r) => r.numero === '2')?.avoin).toBe(Euro.fromCents(1_510));
  });

  it('Erääntyneet-suodatin näyttää vain erääntyneen laskun', async () => {
    const { user } = await renderRoute('/tulot', { seed: SEED_MAKSU, arrange: siemennaMaksu });
    const sivu = await screen.findByLabelText('tositteselaus');
    await within(sivu).findAllByText('12,55 €');

    await user.click(within(sivu).getByRole('button', { name: 'Erääntyneet' }));

    // A (erääntynyt) jää; B (avoin, eräpäivä kaukana) ja C (maksettu) putoavat pois.
    await waitFor(() => expect(within(sivu).queryByText('25,10 €')).not.toBeInTheDocument());
    expect(within(sivu).queryByText('8,00 €')).not.toBeInTheDocument();
    expect(within(sivu).getAllByText('12,55 €')).not.toHaveLength(0);
  });

  it('laskupvm-väli suodattaa Alkaen-päivän mukaan', async () => {
    const { user } = await renderRoute('/tulot', { seed: SEED_MAKSU, arrange: siemennaMaksu });
    const sivu = await screen.findByLabelText('tositteselaus');
    await within(sivu).findAllByText('12,55 €');

    // A:n laskupvm on 2026-01-10 — Alkaen 2026-05-01 pudottaa sen pois; B (2026-06-01) jää.
    // Oletuksena väli on tilikausi; käsin syötetty päivä korvaa sen (ja irrottaa pikavalinnasta).
    const alkaen = within(sivu).getByLabelText('Alkaen');
    await user.clear(alkaen);
    await user.type(alkaen, '2026-05-01');

    await waitFor(() => expect(within(sivu).queryByText('12,55 €')).not.toBeInTheDocument());
    expect(within(sivu).getAllByText('25,10 €')).not.toHaveLength(0);
  });

  it('tyhjä tila näyttää toimintakehotuksen ja ohjaa laskun luontiin', async () => {
    const { user } = await renderRoute('/tulot', { seed: SEED });
    const sivu = await screen.findByLabelText('tositteselaus');

    expect(await within(sivu).findByText('Ei tuloja. Luo ensimmäinen lasku.')).toBeInTheDocument();
    // Tyhjän tilan oma kontrolli ("Luo lasku") on eri kuin headerin ("+ Uusi myyntilasku") —
    // täsmälleen yksi ainoa, ei sama nodi kahdesti.
    const linkki = within(sivu).getByRole('link', { name: 'Luo lasku' });
    await user.click(linkki);

    expect(await screen.findByLabelText('laskulomake')).toBeInTheDocument();
  });

  it('/tulot avaa Tositteet-listan Tulot-rajauksella eikä sivupalkissa ole omaa Tulot-kohtaa', async () => {
    const { router } = await renderRoute('/tulot', { seed: SEED });
    await screen.findByLabelText('tositteselaus');
    expect(router.state.location.pathname).toBe('/tositteet');
    expect(screen.getByRole('button', { name: 'Tulot' })).toHaveAttribute('aria-pressed', 'true');
    const linkit = screen.getAllByRole('link').map((l) => l.textContent ?? '');
    expect(linkit.some((t) => t.includes('Tulot'))).toBe(false);
  });

  describe('lajittelu sarakeotsikoista', () => {
    /** Summa-sarakkeen (7.) arvot näkyvässä järjestyksessä. */
    function summat(sivu: HTMLElement): string[] {
      return within(sivu)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.querySelectorAll('td')[6]?.textContent ?? '');
    }
    const sentit = (teksti: string) => Number(teksti.replace(/[^0-9,-]/g, '').replace(',', '.'));

    it('oletuksena uusin ensin; summan otsikko lajittelee nousevasti ja sitten laskevasti', async () => {
      const { user, router } = await renderRoute('/tulot', {
        seed: SEED_MAKSU,
        arrange: siemennaMaksu,
      });
      const sivu = await screen.findByLabelText('tositteselaus');
      await waitFor(() => expect(summat(sivu).length).toBeGreaterThan(1));
      const pvm = within(sivu).getByRole('button', { name: 'Lajittele päivämäärän mukaan' });
      expect(pvm.closest('th')).toHaveAttribute('aria-sort', 'descending');

      const summa = within(sivu).getByRole('button', { name: 'Lajittele summan mukaan' });
      await user.click(summa);
      const nousevat = summat(sivu).map(sentit);
      expect(nousevat.length).toBeGreaterThan(1);
      expect(nousevat).toEqual([...nousevat].sort((a, b) => a - b));
      expect(summa.closest('th')).toHaveAttribute('aria-sort', 'ascending');
      expect(router.state.location.search).toEqual({
        laji: 'tulot',
        jarj: 'summa',
        suunta: 'nouseva',
      });

      await user.click(summa);
      expect(summat(sivu).map(sentit)).toEqual([...nousevat].reverse());
    });
  });
});
