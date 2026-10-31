import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { TositeTyyppi } from '@penni/engine';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Alv-saatava' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2920, tyyppi: 'BV', nimi: { fi: 'Verovelka' } },
    { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {
    Nimi: 'Demo Oy',
    AlvVelvollinen: 'true',
    AlvAlkaa: '2026-01-01',
    OletusMyyntitili: '3000',
    LaskuSaatavaTili: '1701',
    AlvVelkaTili: '2939',
  },
};

/** Raja helmikuun loppuun → oletuskausi on maaliskuu 2026 (menneisyydessä — Kellohuomio). */
const SEED_MAALISKUU = {
  ...SEED,
  asetukset: { ...SEED.asetukset, AlvIlmoitettu: '2026-02-28' },
};

/** Maaliskuun 2026 myynti (200 € netto à 25,5 %) + osto (100 € netto à 25,5 %):
 *  301 = 51,00 €, 307 = 25,50 €, 308 = 25,50 €. */
async function siemennaMaaliskuu(c: KpClient) {
  const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
  await c.tallennaMyyntilasku({
    pvm: '2026-03-10',
    erapvm: '2026-03-24',
    kumppani: asiakas.id,
    rivit: [{ myyntiKpl: 1, aNetto: 200, alvKoodi: 11, alvProsentti: 25.5 }],
  });
  await c.luoTosite({
    pvm: '2026-03-15',
    tyyppi: 100,
    sarja: '',
    tila: 100,
    viennit: [
      {
        tili: 4000,
        debet: Euro.fromCents(10_000),
        kredit: Euro.fromCents(0),
        pvm: '2026-03-15',
        alvKoodi: 21,
        alvProsentti: 25.5,
      },
      {
        tili: 1763,
        debet: Euro.fromCents(2_550),
        kredit: Euro.fromCents(0),
        pvm: '2026-03-15',
        alvKoodi: 221,
        alvProsentti: 25.5,
      },
      {
        tili: 1900,
        debet: Euro.fromCents(0),
        kredit: Euro.fromCents(12_550),
        pvm: '2026-03-15',
        alvKoodi: 0,
        alvProsentti: 0,
      },
    ],
  });
}

/** Huhtikuun 2026 myynti (100 € netto à 25,5 %) lisättynä maaliskuun päälle (siemennaMaaliskuu):
 *  kaksi peräkkäistä kautta ERI 301-summalla (51,00 € vs. 25,50 €), jotta remount-regressio
 *  (löydös 1) voidaan erottaa jäänteestä. */
async function siemennaMaaliskuuJaHuhtikuu(c: KpClient) {
  await siemennaMaaliskuu(c);
  const asiakas = await c.tallennaKumppani({ nimi: 'Huhtikuun asiakas' });
  await c.tallennaMyyntilasku({
    pvm: '2026-04-10',
    erapvm: '2026-04-24',
    kumppani: asiakas.id,
    rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
  });
}

describe('ALV-sivu — laskelma ja kausikortti', () => {
  it('näyttää kauden laskelman OmaVero-koodeittain (301/307/308) senttitarkasti', async () => {
    await renderRoute('/alv', { seed: SEED_MAALISKUU, arrange: siemennaMaaliskuu });
    const kortti = await screen.findByLabelText('kausikortti');
    expect(await within(kortti).findByText('1.3.2026 – 31.3.2026')).toBeInTheDocument();
    expect(within(kortti).getByText('Kuukausi')).toBeInTheDocument();

    const taulu = await within(kortti).findByLabelText('alv-laskelma');
    const r301 = within(taulu)
      .getByText('Suoritettava 24% / 25,5%:n vero kotimaan myynnistä')
      .closest('tr');
    expect(r301).toHaveTextContent('51,00');
    const r307 = within(taulu).getByText('Verokauden vähennettävä vero').closest('tr');
    expect(r307).toHaveTextContent('25,50');
    const r308 = within(taulu)
      .getByText('Maksettava vero / Palautukseen oikeuttava vero')
      .closest('tr');
    expect(r308).toHaveTextContent('25,50');

    // Eräpäivä legacy-säännöllä; 12.5.2026 on jo ohi (oikea tänään) → danger-väri.
    const erapvm = within(within(kortti).getByText(/^Eräpäivä/)).getByText('12.5.2026');
    expect(erapvm).toHaveClass('text-[var(--danger)]');
  });

  it('tilittää kauden: dialogi → vahvistus → tosite, raja siirtyy ja kortti siirtyy seuraavaan kauteen', async () => {
    const { user, client } = await renderRoute('/alv', {
      seed: SEED_MAALISKUU,
      arrange: siemennaMaaliskuu,
    });
    const kortti = await screen.findByLabelText('kausikortti');
    await within(kortti).findByLabelText('alv-laskelma');
    await user.click(within(kortti).getByRole('button', { name: 'Tilitä' }));

    const dialogi = await screen.findByRole('dialog', { name: 'Tilitä arvonlisävero' });
    await within(dialogi).findByText('Maksettava vero / Palautukseen oikeuttava vero');
    await user.click(within(dialogi).getByRole('button', { name: 'Tilitä' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Tilitä arvonlisävero' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText(
        'Arvonlisäverolaskelma tallennettu. Huolehdi ilmoittamisesta verottajalle esimerkiksi OmaVerossa.',
      ),
    ).toBeInTheDocument();

    // Todennus oikean clientin kautta.
    const tositteet = await client.listaaTositteet({ tyyppi: TositeTyyppi.ALVLASKELMA });
    expect(tositteet).toHaveLength(1);
    expect(tositteet[0]?.otsikko).toBe('Arvonlisävero 2026-03-01 – 2026-03-31');
    const init = await client.haeInit();
    expect(init.asetukset.AlvIlmoitettu).toBe('2026-03-31');

    // Kortti siirtyi automaattisesti huhtikuuhun (frontier liikkui → key-remount).
    // Huom: remount vaihtaa DOM-solmun — kortti haetaan uudelleen vasta sisällön jälkeen.
    await waitFor(() =>
      expect(screen.getByLabelText('kausikortti')).toHaveTextContent('1.4.2026 – 30.4.2026'),
    );
    const uusiKortti = screen.getByLabelText('kausikortti');

    // Ilmoitettu kausi on luku-vain: taaksepäin → Ilmoitettu-badge, ei Tilitä-nappia.
    await user.click(within(uusiKortti).getByRole('button', { name: 'Edellinen kausi' }));
    expect(await within(uusiKortti).findByText('Ilmoitettu')).toBeInTheDocument();
    expect(within(uusiKortti).queryByRole('button', { name: 'Tilitä' })).not.toBeInTheDocument();
  });

  it('nollakausi: nollailmoitusteksti näkyy, mutta sivun Tilitä on käytössä — dialogin oma vartija torjuu aidosti tyhjän laskelman', async () => {
    // Löydös 2: sivutason nollaesto poistettu — sekä maksuperusteinen vanhennus että
    // marginaalivero tuottavat lukunsa vasta valmistelussa, joten esikatselun tyhjyys ei saa
    // estää dialogin avaamista. Aidosti tyhjälle (ei maksuperusteinen, ei marginaali) kaudelle
    // dialogin OMA post-sweep-tarkistus jättää sen Tilitä-napin disabloiduksi (vrt.
    // TilitaDialog.test.tsx: "tyhjä lopullinen laskelma pitää Tilitä-napin disabloituna").
    const { user } = await renderRoute('/alv', { seed: SEED_MAALISKUU });
    const kortti = await screen.findByLabelText('kausikortti');
    expect(
      await within(kortti).findByText(
        'Kaudella ei ole arvonlisäverollisia tapahtumia (nollailmoitus).',
      ),
    ).toBeInTheDocument();
    const nappi = within(kortti).getByRole('button', { name: 'Tilitä' });
    expect(nappi).toBeEnabled();

    await user.click(nappi);
    const dialogi = await screen.findByRole('dialog', { name: 'Tilitä arvonlisävero' });
    await waitFor(() =>
      expect(within(dialogi).queryByText('Valmistellaan laskelmaa…')).not.toBeInTheDocument(),
    );
    expect(within(dialogi).getByRole('button', { name: 'Tilitä' })).toBeDisabled();
  });

  it('kauden vaihto taustalla dialogin ollessa auki remounttaa dialogin ja valmistelee uuden kauden (regressio, löydös 1)', async () => {
    const { user } = await renderRoute('/alv', {
      seed: SEED_MAALISKUU,
      arrange: siemennaMaaliskuuJaHuhtikuu,
    });
    const kortti = await screen.findByLabelText('kausikortti');
    await within(kortti).findByLabelText('alv-laskelma');
    await user.click(within(kortti).getByRole('button', { name: 'Tilitä' }));

    const dialogiMaaliskuu = await screen.findByRole('dialog', { name: 'Tilitä arvonlisävero' });
    const r301Maaliskuu = await within(dialogiMaaliskuu).findByText(
      'Suoritettava 24% / 25,5%:n vero kotimaan myynnistä',
    );
    expect(r301Maaliskuu.closest('tr')).toHaveTextContent('51,00 €');

    // Dialogilla ei ole focus-trapia — taustan "Seuraava kausi" -nappi on yhä klikattavissa.
    // Tämä on juuri reitti, jolla vanha kaynnistetty-ref esti uudelleenvalmistelun: otsikko
    // seuraisi uutta kautta, mutta valmisteltu laskelma jäisi maaliskuun lukuihin — ja Tilitä
    // tilittäisi huhtikuun maaliskuun luvuilla näytettynä.
    await user.click(within(kortti).getByRole('button', { name: 'Seuraava kausi' }));

    // key={kausi} remounttaa dialogin -> uusi instanssi, tuoreet refit, tuore valmistelu.
    const dialogiHuhtikuu = await screen.findByRole('dialog', { name: 'Tilitä arvonlisävero' });
    expect(within(dialogiHuhtikuu).getByText(/1\.4\.2026\s*–\s*30\.4\.2026/)).toBeInTheDocument();
    const r301Huhtikuu = await within(dialogiHuhtikuu).findByText(
      'Suoritettava 24% / 25,5%:n vero kotimaan myynnistä',
    );
    expect(r301Huhtikuu.closest('tr')).toHaveTextContent('25,50 €');
  });

  it('tulevaa kautta voi esikatsella mutta ei tilittää ("Kausi on vielä kesken")', async () => {
    // Kellohuomio: moottorin kello on kiinnitetty, mutta komponentin "tänään" on selaimen
    // oikea päivä — raja kuluvan kuun loppuun tekee oletuskaudesta aidosti tulevan.
    const nyt = new Date();
    const kuluvanKuunLoppu = new Date(Date.UTC(nyt.getUTCFullYear(), nyt.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
    await renderRoute('/alv', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, AlvIlmoitettu: kuluvanKuunLoppu } },
    });
    const kortti = await screen.findByLabelText('kausikortti');
    const nappi = await within(kortti).findByRole('button', { name: 'Tilitä' });
    expect(nappi).toBeDisabled();
    expect(nappi).toHaveAttribute('title', 'Kausi on vielä kesken');
  });

  it('ei alv-velvollinen: tyhjätila ja linkki asetuksiin', async () => {
    await renderRoute('/alv', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, AlvVelvollinen: 'false' } },
    });
    const sivu = await screen.findByLabelText('alv-sivu');
    expect(
      await within(sivu).findByText(
        'Kirjanpito ei ole arvonlisäverovelvollinen. Voit ottaa alv-velvollisuuden käyttöön asetuksissa.',
      ),
    ).toBeInTheDocument();
    expect(within(sivu).getByRole('link', { name: 'Avaa asetukset' })).toBeInTheDocument();
  });

  it('näyttää Kitsas-mallisen laskelman: yritys, kausi ja erittely tositelinkkeineen', async () => {
    const { client } = await renderRoute('/alv', {
      seed: SEED_MAALISKUU,
      arrange: siemennaMaaliskuu,
    });
    const kortti = await screen.findByLabelText('kausikortti');
    const dokumentti = await within(kortti).findByRole('article', {
      name: 'arvonlisäverolaskelma',
    });
    expect(within(dokumentti).getByText('Demo Oy')).toBeInTheDocument();
    expect(within(dokumentti).getByText('01.03.2026 – 31.03.2026')).toBeInTheDocument();

    const erittely = within(dokumentti).getByLabelText('alv-erittely');
    const ryhma = within(erittely).getByText('Verollinen myynti (netto)').closest('tr');
    expect(ryhma).toHaveTextContent('25,50');
    expect(ryhma).toHaveTextContent('200,00');
    expect(
      within(erittely).getByText('VÄHENNYKSEN MÄÄRÄ Verollinen osto (netto)'),
    ).toBeInTheDocument();

    const [lasku] = await client.listaaTositteet({ tyyppi: TositeTyyppi.MYYNTILASKU });
    const myyntirivi = within(erittely).getAllByText('Asiakas Oy')[0]?.closest('tr') as HTMLElement;
    expect(myyntirivi).toHaveTextContent('10.03.2026');
    const linkki = within(myyntirivi).getByRole('link');
    expect(linkki).toHaveAttribute('href', `/tositteet/${lasku?.id}`);
    expect(linkki).toHaveTextContent(`${lasku?.sarja ?? ''} ${lasku?.tunniste}`.trim());
  });

  it('erittelyn haku epäonnistuu: ilmoituksen tiedot näkyvät ja erittelyn tilalla virhe, ei ikuista latausta', async () => {
    await renderRoute('/alv', {
      seed: SEED_MAALISKUU,
      arrange: async (client) => {
        await siemennaMaaliskuu(client);
        vi.spyOn(client, 'haeAlvErittely').mockRejectedValue(new Error('palvelin kaatui'));
      },
    });
    const kortti = await screen.findByLabelText('kausikortti');
    const dokumentti = await within(kortti).findByRole('article', {
      name: 'arvonlisäverolaskelma',
    });
    expect(within(dokumentti).getByLabelText('alv-laskelma')).toBeInTheDocument();
    expect(within(dokumentti).getByRole('alert')).toHaveTextContent('Erittelyn haku epäonnistui.');
    expect(within(dokumentti).queryByLabelText('alv-erittely')).not.toBeInTheDocument();
    expect(within(kortti).queryByText('Ladataan…')).not.toBeInTheDocument();
  });
});

describe('ALV-sivu — EU-myynti ja maksuperusteinen', () => {
  it('näyttää EU-myynnin yhteenvedon ja varoittaa puuttuvasta alv-tunnuksesta', async () => {
    await renderRoute('/alv', {
      seed: SEED_MAALISKUU,
      arrange: async (c) => {
        const de = await c.tallennaKumppani({
          nimi: 'Deutsche GmbH',
          alvtunnus: 'DE123456789',
          maa: 'de',
        });
        const ee = await c.tallennaKumppani({ nimi: 'Eesti OÜ' }); // ei alv-tunnusta
        await c.tallennaMyyntilasku({
          pvm: '2026-03-05',
          erapvm: '2026-03-19',
          kumppani: de.id,
          rivit: [{ myyntiKpl: 1, aNetto: 500, alvKoodi: 14, alvProsentti: 0 }],
        });
        await c.tallennaMyyntilasku({
          pvm: '2026-03-06',
          erapvm: '2026-03-20',
          kumppani: ee.id,
          rivit: [{ myyntiKpl: 1, aNetto: 300, alvKoodi: 15, alvProsentti: 0 }],
        });
      },
    });
    const eu = await screen.findByLabelText('eu-myynti');
    const riviDe = within(eu).getByText('Deutsche GmbH').closest('tr');
    expect(riviDe).toHaveTextContent('DE123456789');
    expect(riviDe).toHaveTextContent('500,00 €');
    expect(within(eu).getByText('Eesti OÜ').closest('tr')).toHaveTextContent('300,00 €');
    expect(
      within(eu).getByText(
        'Kaikilla yhteisömyynnin asiakkailla ei ole ALV-tunnusta — täydennä tunnukset ennen yhteenvetoilmoituksen antamista.',
      ),
    ).toBeInTheDocument();
    // Peruste näkyy myös laskelmassa (311).
    const taulu = await screen.findByLabelText('alv-laskelma');
    expect(
      within(taulu).getByText('Tavaroiden myynnit muihin EU-maihin').closest('tr'),
    ).toHaveTextContent('500,00');
  });

  it('maksuperusteinen: badge näkyy, Tilitä avautuu tyhjästäkin esikatselusta ja valmistelu kirjaa vanhennuksen', async () => {
    const seed = {
      ...SEED,
      tilit: [
        ...SEED.tilit,
        { numero: 2941, tyyppi: 'BLM', nimi: { fi: 'Kohdentamaton alv-velka' } },
      ],
      tilikaudet: [
        { alkaa: '2025-01-01', loppuu: '2025-12-31' },
        { alkaa: '2026-01-01', loppuu: '2026-12-31' },
      ],
      asetukset: {
        ...SEED.asetukset,
        AlvAlkaa: '2025-01-01',
        MaksuAlvAlkaa: '2025-01-01',
      },
    };
    const { user, client } = await renderRoute('/alv', {
      seed,
      arrange: async (c) => {
        const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
        // Yli vuoden maksamatta ollut LASKU-myynti — lykätty vero odottaa vanhennusta.
        await c.tallennaMyyntilasku({
          pvm: '2025-03-10',
          erapvm: '2025-03-24',
          kumppani: asiakas.id,
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
        });
        // Raja asetetaan vasta laskun kirjauksen jälkeen (PVMALV lukitsisi muuten kauden).
        await c.paivitaAsetukset({ AlvIlmoitettu: '2026-04-30' });
      },
    });
    const kortti = await screen.findByLabelText('kausikortti');
    expect(await within(kortti).findByText('1.5.2026 – 31.5.2026')).toBeInTheDocument();
    expect(within(kortti).getByText('Maksuperusteinen')).toBeInTheDocument();

    // Esikatselulaskelma on tyhjä, mutta maksuperusteisella Tilitä EI ole disabloitu
    // (poikkeama 2) — vanhennus tuottaa tilitettävän vasta valmistelussa.
    const nappi = within(kortti).getByRole('button', { name: 'Tilitä' });
    expect(nappi).toBeEnabled();
    await user.click(nappi);

    const dialogi = await screen.findByRole('dialog', { name: 'Tilitä arvonlisävero' });
    expect(
      await within(dialogi).findByText(
        /Valmistelu kirjasi tositteet: Maksuperusteisen alv:n vanhennus/,
      ),
    ).toBeInTheDocument();
    const r301 = within(dialogi)
      .getByText('Suoritettava 24% / 25,5%:n vero kotimaan myynnistä')
      .closest('tr');
    expect(r301).toHaveTextContent('25,50 €');
    // Vanhennustosite syntyi oikeasti.
    const jarjestelma = await client.listaaTositteet({ tyyppi: TositeTyyppi.JARJESTELMATOSITE });
    expect(jarjestelma).toHaveLength(1);
  });
});

describe('ALV-sivu — navigaatio', () => {
  it('ALV-kohta näkyy sivupalkissa Raportit- ja Tilikartta-kohtien välissä', async () => {
    await renderRoute('/alv', { seed: SEED });
    await screen.findByLabelText('alv-sivu');
    const linkit = screen.getAllByRole('link').map((l) => l.textContent);
    const raportit = linkit.findIndex((t) => t?.includes('Raportit'));
    const alv = linkit.findIndex((t) => t?.includes('ALV'));
    const tilikartta = linkit.findIndex((t) => t?.includes('Tilikartta'));
    expect(alv).toBeGreaterThan(raportit);
    expect(tilikartta).toBeGreaterThan(alv);
  });
});

describe('ALV-sivu — annetut ilmoitukset ja poisto', () => {
  /** Kaksi tilitettyä kautta: tammikuu (myynti 100 € → maksettava 25,50 €) ja
   *  helmikuu (myynti 200 € → maksettava 51,00 €). Raja päätyy 28.2.2026:een. */
  async function siemennaKaksiIlmoitusta(c: KpClient) {
    const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
    await c.tallennaMyyntilasku({
      pvm: '2026-01-10',
      erapvm: '2026-01-24',
      kumppani: asiakas.id,
      rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
    });
    await c.tallennaAlvTilitys({ alkupvm: '2026-01-01', loppupvm: '2026-01-31' });
    await c.tallennaMyyntilasku({
      pvm: '2026-02-10',
      erapvm: '2026-02-24',
      kumppani: asiakas.id,
      rivit: [{ myyntiKpl: 1, aNetto: 200, alvKoodi: 11, alvProsentti: 25.5 }],
    });
    await c.tallennaAlvTilitys({ alkupvm: '2026-02-01', loppupvm: '2026-02-28' });
  }

  it('listaa ilmoitukset uusin ensin sarakkeineen ja valinta avaa kauden luku-vain-tilassa', async () => {
    const { user } = await renderRoute('/alv', {
      seed: SEED,
      arrange: siemennaKaksiIlmoitusta,
    });
    const historia = await screen.findByLabelText('annetut-ilmoitukset');
    const rivit = within(historia).getAllByRole('row');
    expect(rivit).toHaveLength(3); // otsikkorivi + 2 ilmoitusta
    // Uusin ensin; Kausi parsittu otsikosta, Eräpäivä legacy-säännöllä (12.4.2026 on
    // sunnuntai → 13.4.), Maksettava tositteen VEROVELKA-viennistä.
    expect(rivit[1]).toHaveTextContent('1.2.2026 – 28.2.2026');
    expect(rivit[1]).toHaveTextContent('13.4.2026');
    expect(rivit[1]).toHaveTextContent('51,00 €');
    expect(rivit[2]).toHaveTextContent('1.1.2026 – 31.1.2026');
    expect(rivit[2]).toHaveTextContent('12.3.2026');
    expect(rivit[2]).toHaveTextContent('25,50 €');
    expect(within(historia).getAllByRole('link', { name: 'Tosite' })).toHaveLength(2);

    // Rivin valinta → kausikortti luku-vain-tilaan (Ilmoitettu-badge, ei Tilitä-nappia).
    await user.click(within(historia).getByText('1.1.2026 – 31.1.2026'));
    const kortti = await screen.findByLabelText('kausikortti');
    expect(
      await within(kortti).findByRole('heading', { name: '1.1.2026 – 31.1.2026' }),
    ).toBeInTheDocument();
    expect(within(kortti).getByText('Ilmoitettu')).toBeInTheDocument();
    expect(within(kortti).queryByRole('button', { name: 'Tilitä' })).not.toBeInTheDocument();
  });

  it('poistaa vain uusimman: raja kelautuu taakse ja kauden voi tilittää uudelleen', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, client } = await renderRoute('/alv', {
      seed: SEED,
      arrange: siemennaKaksiIlmoitusta,
    });
    const historia = await screen.findByLabelText('annetut-ilmoitukset');
    const poistoNapit = within(historia).getAllByRole('button', { name: 'Poista ilmoitus' });
    expect(poistoNapit).toHaveLength(2);
    // Vanhempi (alempi rivi) on disabloitu vihjeellä.
    expect(poistoNapit[1]).toBeDisabled();
    expect(poistoNapit[1]).toHaveAttribute('title', 'Vain uusimman ilmoituksen voi poistaa');

    await user.click(poistoNapit[0] as HTMLElement);
    expect(confirmSpy).toHaveBeenCalledWith(
      'Haluatko todellakin poistaa valitun alv-ilmoituksen?\nPoistamisen jälkeen sinun on laadittava uusi alv-ilmoitus.',
    );

    // Raja kelautui tammikuun loppuun (jäljelle jääneen ilmoituksen parsittu loppupvm).
    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.asetukset.AlvIlmoitettu).toBe('2026-01-31');
    });
    // Helmikuu vapautui: kortti näyttää sen ja Tilitä on taas mahdollinen.
    // Huom: rajan siirto remounttaa näkymän (key) — kortti haetaan sisällön kautta.
    await waitFor(() =>
      expect(screen.getByLabelText('kausikortti')).toHaveTextContent('1.2.2026 – 28.2.2026'),
    );
    const kortti = screen.getByLabelText('kausikortti');
    await waitFor(() =>
      expect(within(kortti).getByRole('button', { name: 'Tilitä' })).toBeEnabled(),
    );
    confirmSpy.mockRestore();
  });

  it('viimeisen ilmoituksen poisto poistaa AlvIlmoitettu-avaimen kokonaan', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, client } = await renderRoute('/alv', {
      seed: SEED,
      arrange: async (c) => {
        const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
        await c.tallennaMyyntilasku({
          pvm: '2026-01-10',
          erapvm: '2026-01-24',
          kumppani: asiakas.id,
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
        });
        await c.tallennaAlvTilitys({ alkupvm: '2026-01-01', loppupvm: '2026-01-31' });
      },
    });
    const historia = await screen.findByLabelText('annetut-ilmoitukset');
    await user.click(within(historia).getByRole('button', { name: 'Poista ilmoitus' }));

    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.asetukset.AlvIlmoitettu).toBeUndefined();
    });
    // Historia tyhjeni (remountin jälkeinen solmu haetaan sisällön kautta).
    await waitFor(() =>
      expect(screen.getByLabelText('annetut-ilmoitukset')).toHaveTextContent(
        'Ei annettuja ilmoituksia.',
      ),
    );
    confirmSpy.mockRestore();
  });

  it('uusimman ilmoituksen otsikko ei parsiudu: poisto on silti sallittu tositepäivä-varajärjestelyllä (regressio, löydös 3)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, client } = await renderRoute('/alv', {
      seed: SEED,
      arrange: async (c) => {
        // Tosite luodaan suoraan luoTosite-kutsulla (ei tallennaAlvTilitys), jotta otsikko on
        // epästandardi eikä parsiIlmoitusOtsikko tunnista siitä kautta. Ilman fallbackia
        // (parsittu.loppupvm ?? tosite.pvm) uusin-vertailu ei koskaan täsmäisi rajaan, ja rivi
        // jäisi pysyvästi poistokelvottomaksi.
        await c.luoTosite({
          pvm: '2026-01-31',
          tyyppi: TositeTyyppi.ALVLASKELMA,
          sarja: '',
          tila: 100,
          otsikko: 'Epästandardi ilmoitusotsikko',
          viennit: [],
        });
        await c.paivitaAsetukset({ AlvIlmoitettu: '2026-01-31' });
      },
    });
    const historia = await screen.findByLabelText('annetut-ilmoitukset');
    const poistoNappi = within(historia).getByRole('button', { name: 'Poista ilmoitus' });
    expect(poistoNappi).toBeEnabled();

    await user.click(poistoNappi);
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.asetukset.AlvIlmoitettu).toBeUndefined();
    });
    confirmSpy.mockRestore();
  });
  it('tuotu kirja ilman AlvIlmoitettu-rajaa: avautuu viimeisen ilmoitetun kauden jälkeiselle kaudelle eikä tarjoa Tilitä ilmoitetulle', async () => {
    const { user } = await renderRoute('/alv', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, AlvKausi: '3' } },
      arrange: async (c) => {
        // Kitsaksesta tuotu ilmoitus: otsikon päivät muodossa pp.kk.vvvv.
        await c.luoTosite({
          pvm: '2026-03-31',
          tyyppi: TositeTyyppi.ALVLASKELMA,
          sarja: '',
          tila: 100,
          otsikko: 'Arvonlisäveroilmoitus 01.01.2026 - 31.03.2026',
          viennit: [],
        });
      },
    });
    const kortti = await screen.findByLabelText('kausikortti');
    expect(await within(kortti).findByText('1.4.2026 – 30.6.2026')).toBeInTheDocument();
    await user.click(within(kortti).getByRole('button', { name: 'Edellinen kausi' }));
    expect(
      await within(kortti).findByRole('heading', { name: '1.1.2026 – 31.3.2026' }),
    ).toBeInTheDocument();
    expect(within(kortti).getByText('Ilmoitettu')).toBeInTheDocument();
    expect(within(kortti).queryByRole('button', { name: 'Tilitä' })).not.toBeInTheDocument();
  });
});

/** Neljännesvuosi-ilmoittaja, Q2 ilmoitettu → oletuskausi Q3/2026. Keksitty Y-tunnus. */
const SEED_Q3 = {
  ...SEED,
  asetukset: {
    ...SEED.asetukset,
    AlvKausi: '3',
    AlvIlmoitettu: '2026-06-30',
    Ytunnus: '1234567-1',
  },
};

/** Q3/2026: myynti 200 € netto à 25,5 % (301 = 51,00) + osto 100 € netto (307 = 25,50). */
async function siemennaQ3(c: KpClient) {
  const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
  await c.tallennaMyyntilasku({
    pvm: '2026-08-10',
    erapvm: '2026-08-24',
    kumppani: asiakas.id,
    rivit: [{ myyntiKpl: 1, aNetto: 200, alvKoodi: 11, alvProsentti: 25.5 }],
  });
  const vienti = (tili: number, debet: number, kredit: number, alvKoodi: number) => ({
    tili,
    debet: Euro.fromCents(debet),
    kredit: Euro.fromCents(kredit),
    pvm: '2026-09-15',
    alvKoodi,
    alvProsentti: alvKoodi === 0 ? 0 : 25.5,
  });
  await c.luoTosite({
    pvm: '2026-09-15',
    tyyppi: 100,
    sarja: '',
    tila: 100,
    viennit: [vienti(4000, 10_000, 0, 21), vienti(1763, 2_550, 0, 221), vienti(1900, 0, 12_550, 0)],
  });
}

/** Lue jsdomin Blob tekstiksi (FileReader on jsdomissa toteutettu). */
function blobTekstiksi(blob: Blob): Promise<string> {
  return new Promise((ok, virhe) => {
    const lukija = new FileReader();
    lukija.onload = () => ok(String(lukija.result));
    lukija.onerror = () => virhe(lukija.error);
    lukija.readAsText(blob);
  });
}

describe('ALV-sivu — OmaVero-täyttöapu', () => {
  it('näyttää kauden, eräpäivän ja kentät OmaVeron järjestyksessä syötemuodossa', async () => {
    await renderRoute('/alv', { seed: SEED_Q3, arrange: siemennaQ3 });
    const apu = await screen.findByLabelText('omavero-tayttoapu');
    expect(apu).toHaveTextContent('Q3/2026, 1.7.–30.9.2026');
    expect(within(apu).getByText('12.11.2026')).toBeInTheDocument();

    const rivit = within(apu)
      .getAllByRole('row')
      .map((r) => r.textContent);
    expect(rivit).toEqual([
      'Vero kotimaan myynnistä verokannoittain',
      '25,5 %:n vero51,00Kopioi',
      'Vähennettävä vero',
      'Verokauden vähennettävä vero25,50Kopioi',
      'Maksettava vero tai palautukseen oikeuttava vero',
      'Maksettava vero25,50OmaVero laskee',
    ]);
  });

  it('kopioi rivin arvon leikepöydälle ja kuittaa kopioinnin', async () => {
    const { user } = await renderRoute('/alv', { seed: SEED_Q3, arrange: siemennaQ3 });
    const apu = await screen.findByLabelText('omavero-tayttoapu');
    await user.click(within(apu).getByRole('button', { name: 'Kopioi 25,5 %:n vero' }));

    expect(await navigator.clipboard.readText()).toBe('51,00');
    expect(within(apu).getByRole('button', { name: 'Kopioi 25,5 %:n vero' })).toHaveTextContent(
      '✓ Kopioitu',
    );
    expect(within(apu).getByText('Kopioitu: 25,5 %:n vero 51,00')).toBeInTheDocument();
    // Muut rivit eivät kuittaa.
    expect(
      within(apu).getByRole('button', { name: 'Kopioi Verokauden vähennettävä vero' }),
    ).toHaveTextContent(/^Kopioi$/);
  });

  it('nollakausi: ohjaa rastimaan "Ei toimintaa verokaudella"', async () => {
    await renderRoute('/alv', { seed: SEED_Q3 });
    const apu = await screen.findByLabelText('omavero-tayttoapu');
    expect(apu).toHaveTextContent('Ei toimintaa verokaudella');
    expect(within(apu).queryByRole('button', { name: /^Kopioi/ })).not.toBeInTheDocument();
  });

  it('lataa Ilmoitin.fi-tiedoston (VSRALVKV) kauden luvuista', async () => {
    const blobit: Blob[] = [];
    const luoUrl = vi.fn((b: Blob) => {
      blobit.push(b);
      return 'blob:testi';
    });
    const alkupLuo = URL.createObjectURL;
    const alkupVapauta = URL.revokeObjectURL;
    URL.createObjectURL = luoUrl;
    URL.revokeObjectURL = vi.fn();
    const klikki = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      const { user } = await renderRoute('/alv', { seed: SEED_Q3, arrange: siemennaQ3 });
      const apu = await screen.findByLabelText('omavero-tayttoapu');
      await user.click(within(apu).getByRole('button', { name: 'Lataa Ilmoitin.fi-tiedosto' }));

      expect(klikki).toHaveBeenCalledTimes(1);
      const linkki = klikki.mock.contexts[0] as HTMLAnchorElement;
      expect(linkki.download).toBe('ALV_Q3_2026_1234567-1.txt');
      const blob = blobit[0];
      if (blob === undefined) throw new Error('blob puuttuu');
      const rivit = (await blobTekstiksi(blob)).split('\r\n');
      expect(rivit[0]).toBe('000:VSRALVKV');
      expect(rivit[1]).toMatch(/^198:\d{14}$/);
      expect(rivit.slice(2)).toEqual([
        '048:Penni',
        '014:1234567-1_PE',
        '010:1234567-1',
        '050:Q',
        '052:3',
        '053:2026',
        '301:51,00',
        '307:25,50',
        '308:25,50',
        '999:1',
      ]);
    } finally {
      URL.createObjectURL = alkupLuo;
      URL.revokeObjectURL = alkupVapauta;
      klikki.mockRestore();
    }
  });

  it('Ilmoitin-lataus on pois käytöstä ilman kelvollista Y-tunnusta', async () => {
    await renderRoute('/alv', {
      seed: { ...SEED_Q3, asetukset: { ...SEED_Q3.asetukset, Ytunnus: '1234567-8' } },
      arrange: siemennaQ3,
    });
    const apu = await screen.findByLabelText('omavero-tayttoapu');
    expect(within(apu).getByRole('button', { name: 'Lataa Ilmoitin.fi-tiedosto' })).toBeDisabled();
    expect(
      within(apu).getByText('Tiedosto vaatii kelvollisen Y-tunnuksen asetuksissa.'),
    ).toBeInTheDocument();
  });
});

describe('ALV-sivu — taittuvat osiot', () => {
  it('laskelma ja annetut ilmoitukset auki, erittely ja täyttöapu kiinni; tila säilyy kauden vaihdossa', async () => {
    const { user } = await renderRoute('/alv', {
      seed: SEED_MAALISKUU,
      arrange: siemennaMaaliskuu,
    });
    const kortti = await screen.findByLabelText('kausikortti');
    await within(kortti).findByLabelText('alv-erittely');
    const osio = (nimi: string) => within(kortti).getByRole('button', { name: nimi });
    expect(osio('Arvonlisäveroilmoituksen tiedot')).toHaveAttribute('aria-expanded', 'true');
    expect(osio('Erittely')).toHaveAttribute('aria-expanded', 'false');
    expect(osio('OmaVero-täyttöapu')).toHaveAttribute('aria-expanded', 'false');
    expect(osio('Annetut ilmoitukset')).toHaveAttribute('aria-expanded', 'true');

    // Kiinni oleva erittely on DOMissa mutta piilossa, ja tulostuu silti kokonaan.
    const rivit = document.getElementById(
      osio('Erittely').getAttribute('aria-controls') ?? '',
    ) as HTMLElement;
    expect(rivit).toHaveClass('hidden', 'print:table-row-group');

    await user.click(osio('Erittely'));
    expect(osio('Erittely')).toHaveAttribute('aria-expanded', 'true');
    expect(rivit).not.toHaveClass('hidden');

    await user.click(within(kortti).getByRole('button', { name: 'Seuraava kausi' }));
    await within(kortti).findByText('1.4.2026 – 30.4.2026');
    await within(kortti).findByLabelText('alv-erittely');
    expect(osio('Erittely')).toHaveAttribute('aria-expanded', 'true');
  });

  it('Tilitä ja Tulosta ovat ilmoituksen tietojen alla, erittelyn yläpuolella', async () => {
    await renderRoute('/alv', { seed: SEED_MAALISKUU, arrange: siemennaMaaliskuu });
    const kortti = await screen.findByLabelText('kausikortti');
    const tilita = await within(kortti).findByRole('button', { name: 'Tilitä' });
    const tulosta = within(kortti).getByRole('button', { name: 'Tulosta' });
    const laskelma = within(kortti).getByRole('table', { name: 'alv-laskelma' });
    const erittely = within(kortti).getByRole('table', { name: 'alv-erittely' });
    for (const nappi of [tilita, tulosta]) {
      expect(
        laskelma.compareDocumentPosition(nappi) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        nappi.compareDocumentPosition(erittely) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // Tarttuvaan kausiriviin jää vain kausi.
    expect(tilita.closest('.sticky')).toBeNull();
  });
});

describe('ALV-sivu — tulostus', () => {
  it('Tulosta avaa selaimen tulostuksen ja tulosteeseen jää vain laskelma', async () => {
    const tulosta = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { user } = await renderRoute('/alv', {
      seed: SEED_MAALISKUU,
      arrange: siemennaMaaliskuu,
    });
    const kortti = await screen.findByLabelText('kausikortti');
    await within(kortti).findByLabelText('alv-erittely');
    await user.click(within(kortti).getByRole('button', { name: 'Tulosta' }));
    expect(tulosta).toHaveBeenCalledTimes(1);

    const piilossa = (el: Element) => el.closest('.print\\:hidden') !== null;
    expect(piilossa(screen.getByRole('article', { name: 'arvonlisäverolaskelma' }))).toBe(false);
    expect(piilossa(within(kortti).getByRole('button', { name: 'Edellinen kausi' }))).toBe(true);
    expect(piilossa(within(kortti).getByRole('button', { name: 'Tilitä' }))).toBe(true);
    expect(piilossa(within(kortti).getByRole('button', { name: 'Tulosta' }))).toBe(true);
    expect(piilossa(screen.getByLabelText('omavero-tayttoapu'))).toBe(true);
    expect(piilossa(screen.getByLabelText('annetut-ilmoitukset'))).toBe(true);
    // Erittely alkaa uudelta sivulta (Kitsas lisaaSivunvaihto, alvlaskelma.cpp:52) ja sivu
    // saa jatkua usealle tulostesivulle.
    expect(screen.getByLabelText('alv-erittely')).toHaveClass('print:break-before-page');
    expect(screen.getByLabelText('alv-sivu')).toHaveClass('print:overflow-visible');
  });

  it('Tilitä-dialogi ei tulostu laskelman päälle', async () => {
    const { user } = await renderRoute('/alv', {
      seed: SEED_MAALISKUU,
      arrange: siemennaMaaliskuu,
    });
    const kortti = await screen.findByLabelText('kausikortti');
    await within(kortti).findByLabelText('alv-erittely');
    await user.click(within(kortti).getByRole('button', { name: 'Tilitä' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Tilitä arvonlisävero' });
    expect(dialogi).toHaveClass('print:hidden');
  });
});

describe('Alv-sivu — verokauden pituuden historia', () => {
  const HISTORIA = JSON.stringify([
    { alkaa: '', kk: 3 },
    { alkaa: '2026-07-01', kk: 1 },
  ]);

  it('menneet kaudet säilyttävät pituutensa ja selaus ylittää vaihdoksen', async () => {
    const { user } = await renderRoute('/alv', {
      seed: {
        ...SEED,
        asetukset: { ...SEED.asetukset, AlvKausiHistoria: HISTORIA, AlvIlmoitettu: '2026-03-31' },
      },
    });
    const kortti = await screen.findByLabelText('kausikortti');
    expect(await within(kortti).findByText('1.4.2026 – 30.6.2026')).toBeInTheDocument();
    expect(
      within(kortti).getByRole('button', { name: 'Verokausi: Neljännesvuosi' }),
    ).toBeInTheDocument();
    await user.click(within(kortti).getByRole('button', { name: 'Seuraava kausi' }));
    expect(await within(kortti).findByText('1.7.2026 – 31.7.2026')).toBeInTheDocument();
    expect(within(kortti).getByRole('button', { name: 'Verokausi: Kuukausi' })).toBeInTheDocument();
  });

  it('muutos kirjataan alkupäivällä; alkupäivän on oltava kauden alku', async () => {
    const { user, client } = await renderRoute('/alv', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, AlvIlmoitettu: '2026-02-28' } },
    });
    const kortti = await screen.findByLabelText('kausikortti');
    await user.click(await within(kortti).findByRole('button', { name: /^Verokausi:/ }));
    const paneeli = screen.getByRole('region', { name: 'verokausi' });
    await user.click(within(paneeli).getByRole('button', { name: 'Muuta verokautta' }));
    await user.click(within(paneeli).getByRole('button', { name: 'Vuosi' }));
    const alkaen = within(paneeli).getByLabelText('Uusi verokausi alkaen');
    await user.clear(alkaen);
    await user.type(alkaen, '2027-02-01');
    expect(
      within(paneeli).getByText(/Vuosi voi alkaa vain vuoden ensimmäisestä päivästä/),
    ).toBeInTheDocument();
    expect(within(paneeli).getByRole('button', { name: 'Tallenna muutos' })).toBeDisabled();
    await user.clear(alkaen);
    await user.type(alkaen, '2027-01-01');
    await user.click(within(paneeli).getByRole('button', { name: 'Tallenna muutos' }));
    await waitFor(async () => {
      const init = await client.haeInit();
      expect(JSON.parse(init.asetukset.AlvKausiHistoria ?? '[]')).toEqual([
        { alkaa: '', kk: 1 },
        { alkaa: '2027-01-01', kk: 12 },
      ]);
    });
  });
});
