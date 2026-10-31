import { KpClientProvider } from '@/app/KpClientProvider';
import { avaimet } from '@/app/kysely';
import { renderWithProviders } from '@/test/renderWithProviders';
import { InProcessClient } from '@penni/asiakas';
import type { KpClient } from '@penni/asiakas';
import { TositeTila, TositeTyyppi } from '@penni/engine';
import { Euro } from '@penni/euro';
import { createMemoryStorage } from '@penni/storage-memory';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TilitaDialog } from './TilitaDialog.js';

const KAUSI = { alkupvm: '2026-03-01', loppupvm: '2026-03-31' };

/** renderWithProviders ei ota master-data-siementä — perustiedot ajetaan clientin läpi. */
async function perusta(c: KpClient) {
  await c.tallennaTilikausi('2026-01-01', { alkaa: '2026-01-01', loppuu: '2026-12-31' });
  await c.tallennaTili(1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
  await c.tallennaTili(1900, { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } });
  await c.tallennaTili(2920, { numero: 2920, tyyppi: 'BV', nimi: { fi: 'Verovelka' } });
  await c.tallennaTili(2939, { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } });
  await c.tallennaTili(3000, { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } });
  await c.paivitaAsetukset({
    Nimi: 'Demo Oy',
    AlvVelvollinen: 'true',
    AlvAlkaa: '2026-01-01',
    OletusMyyntitili: '3000',
    LaskuSaatavaTili: '1701',
    AlvVelkaTili: '2939',
  });
}

async function siemennaMyynti(c: KpClient) {
  await perusta(c);
  const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
  await c.tallennaMyyntilasku({
    pvm: '2026-03-10',
    erapvm: '2026-03-24',
    kumppani: asiakas.id,
    rivit: [{ myyntiKpl: 1, aNetto: 200, alvKoodi: 11, alvProsentti: 25.5 }],
  });
}

/** Maksuperusteinen kirja, jossa yli vuoden maksamatta ollut LASKU-myynti → valmistelun
 *  vanhennus kirjaa aidosti JARJESTELMATOSITE-esikirjauksen (vrt. kysely.alv.test.ts). */
async function siemennaMaksuperusteinen(c: KpClient) {
  await c.tallennaTilikausi('2025-01-01', { alkaa: '2025-01-01', loppuu: '2025-12-31' });
  await c.tallennaTilikausi('2026-01-01', { alkaa: '2026-01-01', loppuu: '2026-12-31' });
  await c.tallennaTili(1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
  await c.tallennaTili(1763, { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Alv-saatava' } });
  await c.tallennaTili(1900, { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } });
  await c.tallennaTili(2920, { numero: 2920, tyyppi: 'BV', nimi: { fi: 'Verovelka' } });
  await c.tallennaTili(2939, { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } });
  await c.tallennaTili(2941, {
    numero: 2941,
    tyyppi: 'BLM',
    nimi: { fi: 'Kohdentamaton alv-velka' },
  });
  await c.tallennaTili(3000, { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } });
  await c.paivitaAsetukset({
    Nimi: 'Demo Oy',
    AlvVelvollinen: 'true',
    AlvAlkaa: '2025-01-01',
    MaksuAlvAlkaa: '2025-01-01',
    OletusMyyntitili: '3000',
    LaskuSaatavaTili: '1701',
    AlvVelkaTili: '2939',
  });
  const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
  await c.tallennaMyyntilasku({
    pvm: '2025-03-10',
    erapvm: '2025-03-24',
    kumppani: asiakas.id,
    rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
  });
}

/** Marginaaliverotettu kausi (voittomarginaaliverotus, koodit 13/23): kauden ainoat tapahtumat
 *  syntyvät tavallisen tositeeditorin kautta (luoTosite) — esikatselulaskelma on TYHJÄ, koska
 *  marginaalivero syntyy vasta valmistelun kirjaamasta MARGINAALILASKELMA-tositteesta
 *  (kirjaaMarginaalivero). Myynti 1000,00 €, osto 600,00 € -> marginaali 400,00 €, vero
 *  roundHalfAway(2550*40000/12550) = 8127 senttiä (marginaalivero.test.ts kattaa laskun itsensä).
 */
async function siemennaMarginaali(c: KpClient) {
  await perusta(c);
  await c.tallennaTili(4000, { numero: 4000, tyyppi: 'D', nimi: { fi: 'Marginaaliostot' } });
  // Vain kauppatavaran/myyntitilin rivi kantaa marginaalikoodin (13/23) — vastatili (pankki) on
  // alvKoodilla 0, aivan kuten marginaalivero.test.ts:n myyntiMarginaali/ostoMarginaali-apurit.
  await c.luoTosite({
    pvm: '2026-03-05',
    tyyppi: TositeTyyppi.TULO,
    sarja: '',
    tila: TositeTila.KIRJANPIDOSSA,
    viennit: [
      {
        tili: 1900,
        debet: Euro.fromCents(100_000),
        kredit: Euro.fromCents(0),
        pvm: '2026-03-05',
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili: 3000,
        debet: Euro.fromCents(0),
        kredit: Euro.fromCents(100_000),
        pvm: '2026-03-05',
        alvKoodi: 13,
        alvProsentti: 25.5,
      },
    ],
  });
  await c.luoTosite({
    pvm: '2026-03-10',
    tyyppi: TositeTyyppi.MENO,
    sarja: '',
    tila: TositeTila.KIRJANPIDOSSA,
    viennit: [
      {
        tili: 4000,
        debet: Euro.fromCents(60_000),
        kredit: Euro.fromCents(0),
        pvm: '2026-03-10',
        alvKoodi: 23,
        alvProsentti: 25.5,
      },
      {
        tili: 1900,
        debet: Euro.fromCents(0),
        kredit: Euro.fromCents(60_000),
        pvm: '2026-03-10',
        alvKoodi: 0,
        alvProsentti: 0,
      },
    ],
  });
}

describe('TilitaDialog', () => {
  it('valmistelee laskelman, tilittää kauden ja kutsuu onValmis', async () => {
    const onValmis = vi.fn();
    const { user, client } = await renderWithProviders(
      <TilitaDialog kausi={KAUSI} kausiKk={1} onPeruuta={() => {}} onValmis={onValmis} />,
      { seed: siemennaMyynti },
    );
    const dialogi = await screen.findByRole('dialog', { name: 'Tilitä arvonlisävero' });
    expect(
      within(dialogi).getByText(
        'Kaikki arvonlisäverolliset kirjaukset pitää tehdä ennen alv-ilmoituksen antamista.',
      ),
    ).toBeInTheDocument();
    // Valmistelu valmistuu → dialogi näyttää täsmälleen tilitettävät luvut ja eräpäivän.
    const maksettava = await within(dialogi).findByText(
      'Maksettava vero / Palautukseen oikeuttava vero',
    );
    expect(maksettava.closest('tr')).toHaveTextContent('51,00 €');
    expect(within(dialogi).getByText(/Eräpäivä/)).toHaveTextContent('12.5.2026');
    // Ei esikirjaushuomautusta (ei maksuperusteinen, ei marginaalikirjauksia).
    expect(within(dialogi).queryByText(/Valmistelu kirjasi tositteet/)).not.toBeInTheDocument();

    await user.click(within(dialogi).getByRole('button', { name: 'Tilitä' }));
    await waitFor(() => expect(onValmis).toHaveBeenCalledTimes(1));

    // Todennus oikean clientin kautta: tosite syntyi ja raja siirtyi.
    const tositteet = await client.listaaTositteet({ tyyppi: TositeTyyppi.ALVLASKELMA });
    expect(tositteet).toHaveLength(1);
    expect(tositteet[0]?.otsikko).toBe('Arvonlisävero 2026-03-01 – 2026-03-31');
    const init = await client.haeInit();
    expect(init.asetukset.AlvIlmoitettu).toBe('2026-03-31');
  });

  it('tyhjä lopullinen laskelma pitää Tilitä-napin disabloituna', async () => {
    await renderWithProviders(
      <TilitaDialog kausi={KAUSI} kausiKk={1} onPeruuta={() => {}} onValmis={() => {}} />,
      { seed: perusta },
    );
    const dialogi = await screen.findByRole('dialog', { name: 'Tilitä arvonlisävero' });
    await waitFor(() =>
      expect(within(dialogi).queryByText('Valmistellaan laskelmaa…')).not.toBeInTheDocument(),
    );
    expect(within(dialogi).getByRole('button', { name: 'Tilitä' })).toBeDisabled();
  });

  it('jo ilmoitettu kausi: JOILMOITETTU näkyy dialogissa eikä onValmis kutsuta', async () => {
    const onValmis = vi.fn();
    const { user } = await renderWithProviders(
      <TilitaDialog kausi={KAUSI} kausiKk={1} onPeruuta={() => {}} onValmis={onValmis} />,
      {
        seed: async (c) => {
          await siemennaMyynti(c);
          await c.tallennaAlvTilitys(KAUSI);
        },
      },
    );
    const dialogi = await screen.findByRole('dialog', { name: 'Tilitä arvonlisävero' });
    // Laskelma näkyy (tilitysviennit ovat summaukselle näkymättömiä), mutta moottorin
    // frontier torjuu uuden tilityksen.
    await within(dialogi).findByText('Maksettava vero / Palautukseen oikeuttava vero');
    await user.click(within(dialogi).getByRole('button', { name: 'Tilitä' }));
    expect(await within(dialogi).findByText('Kausi on jo ilmoitettu')).toBeInTheDocument();
    expect(onValmis).not.toHaveBeenCalled();
  });

  it('StrictMode ei tuplakäynnistä valmistelua: vanhennus kirjautuu täsmälleen kerran', async () => {
    // StrictMode ajaa mount-efektin kahdesti; moottorin idempotenssivartijat ovat peräkkäisiä
    // lue-sitten-kirjoita-tarkistuksia (TOCTOU), joten kaksi rinnakkaista valmisteluketjua
    // kirjaisi vanhennuksen kahdesti. Refin pitää estää toinen käynnistys.
    // React 19 tuplakäynnistää efektit vain kun StrictMode on renderöitävän puun JUURESSA
    // (kuten main.tsx:ssä) — renderWithProviders-wrapper veisi sen sisemmäs eikä tupla-ajoa
    // tapahtuisi, joten providerit kootaan tässä käsin samalla oikealla clientillä.
    const client: KpClient = new InProcessClient(
      createMemoryStorage(),
      () => '2026-06-01T00:00:00.000Z',
    );
    await siemennaMaksuperusteinen(client);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <KpClientProvider client={client}>
            <TilitaDialog kausi={KAUSI} kausiKk={1} onPeruuta={() => {}} onValmis={() => {}} />
          </KpClientProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
    const dialogi = await screen.findByRole('dialog', { name: 'Tilitä arvonlisävero' });
    // Valmistelu valmis: laskelma näkyy (vanhennuksen tunnistama vero mukana).
    await within(dialogi).findByText('Maksettava vero / Palautukseen oikeuttava vero');
    const esikirjaukset = await client.listaaTositteet({
      tyyppi: TositeTyyppi.JARJESTELMATOSITE,
    });
    expect(esikirjaukset).toHaveLength(1);
    expect(esikirjaukset[0]?.otsikko).toBe('Maksuperusteisen alv:n vanhennus');
  });

  it('marginaaliverokausi: tyhjä esikatselu ei estä avaamista, valmistelu kirjaa marginaaliveron ja Tilitä onnistuu (regressio, löydös 2)', async () => {
    // Kausi ei ole maksuperusteinen — ainoat 25,5%:n verolliset viennit ovat 13/23-koodeilla,
    // joten esikatselu (haeAlvLaskelma ilman esikirjauksia) on tyhjä. Ilman löydös 2:n korjausta
    // sivun nollaesto olisi jättänyt tämän kauden pysyvästi tilittämättömäksi.
    const onValmis = vi.fn();
    const { user, client } = await renderWithProviders(
      <TilitaDialog kausi={KAUSI} kausiKk={1} onPeruuta={() => {}} onValmis={onValmis} />,
      { seed: siemennaMarginaali },
    );
    const dialogi = await screen.findByRole('dialog', { name: 'Tilitä arvonlisävero' });
    // Valmistelu kirjasi MARGINAALILASKELMA-tositteen — dialogi näyttää 301-perheen luvut.
    expect(
      await within(dialogi).findByText(/Valmistelu kirjasi tositteet: Marginaalivero/),
    ).toBeInTheDocument();
    const r301 = within(dialogi)
      .getByText('Suoritettava 24% / 25,5%:n vero kotimaan myynnistä')
      .closest('tr');
    expect(r301).toHaveTextContent('81,27 €');
    expect(within(dialogi).getByRole('button', { name: 'Tilitä' })).toBeEnabled();

    await user.click(within(dialogi).getByRole('button', { name: 'Tilitä' }));
    await waitFor(() => expect(onValmis).toHaveBeenCalledTimes(1));

    // Todennus oikean clientin kautta: post-sweep-laskelma täsmää dialogin näyttämään, tosite
    // syntyi ja raja siirtyi.
    const laskelmaPostSweep = await client.haeAlvLaskelma(KAUSI);
    expect(laskelmaPostSweep.maksettava).toBe(8127);
    const tositteet = await client.listaaTositteet({ tyyppi: TositeTyyppi.ALVLASKELMA });
    expect(tositteet).toHaveLength(1);
    const init = await client.haeInit();
    expect(init.asetukset.AlvIlmoitettu).toBe('2026-03-31');
  });

  it('valmistelu joka kirjaa esikirjauksen mitätöi laskenta-, tosite- ja saldokyselyt heti — ei vasta tilityksen onnistuessa (regressio, löydös 4)', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    // Sivun taakse jäävä esikatselukysely esitäytetään "vanhalla" tyhjällä laskelmalla — juuri
    // se tila, jonka kanssa kysely.ts:n avaimet-rakentajat tuottavat kausikortin datan.
    queryClient.setQueryData(avaimet.alvLaskelma(KAUSI), {
      alkupvm: KAUSI.alkupvm,
      loppupvm: KAUSI.loppupvm,
      koodit: new Map(),
      maksettava: 0,
    });
    queryClient.setQueryData(avaimet.alvErittely(KAUSI), {
      alkupvm: KAUSI.alkupvm,
      loppupvm: KAUSI.loppupvm,
      rivit: [],
    });
    queryClient.setQueryData(avaimet.tositteet({}), []);

    await renderWithProviders(
      <TilitaDialog kausi={KAUSI} kausiKk={1} onPeruuta={() => {}} onValmis={() => {}} />,
      { seed: siemennaMaksuperusteinen, queryClient },
    );
    const dialogi = await screen.findByRole('dialog', { name: 'Tilitä arvonlisävero' });
    // Vanhennus kirjasi oikean, pysyvän JARJESTELMATOSITE-tositteen jo valmistelussa.
    await within(dialogi).findByText(/Valmistelu kirjasi tositteet/);

    // Peruminen (ei Tilitä) ei saa jättää taustalla olevia kyselyitä vanhaan tilaan — sweepit
    // ovat todellisia postauksia riippumatta siitä, tilitetäänkö kausi tästä eteenpäin.
    await waitFor(() =>
      expect(queryClient.getQueryState(avaimet.alvLaskelma(KAUSI))?.isInvalidated).toBe(true),
    );
    expect(queryClient.getQueryState(avaimet.tositteet({}))?.isInvalidated).toBe(true);
    // Erittely kuuluu samaan laskelmaan: sen on päivityttävä yhdessä yhteenvedon kanssa.
    expect(queryClient.getQueryState(avaimet.alvErittely(KAUSI))?.isInvalidated).toBe(true);
  });
});
