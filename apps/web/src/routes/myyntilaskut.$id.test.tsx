import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { ResourceError } from '@penni/engine';
import { Euro } from '@penni/euro';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SEED = {
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
    Ytunnus: '1234567-8',
    Osoite: 'Demokatu 1',
    Postinumero: '00100',
    Kaupunki: 'Helsinki',
    AlvVelvollinen: 'true',
    OletusMyyntitili: '3000',
    LaskuSaatavaTili: '1701',
    AlvVelkaTili: '2939',
    LaskuIban: 'FI2112345600000785',
  },
};

/** Siementää asiakkaan ja monikantaisen laskun (ensimmäinen tosite → id 1, numero '1',
 *  viite '1000193' → ryhmiteltynä '10 00193'). Summat: netto 210,00 €, alv 25,50 € +
 *  14,00 €, verollinen 249,50 €. */
async function siemenna(c: KpClient) {
  const asiakas = await c.tallennaKumppani({
    nimi: 'Asiakas Oy',
    osoite: 'Asiakkaankatu 2',
    postinumero: '00200',
    kaupunki: 'Espoo',
  });
  await c.tallennaMyyntilasku({
    pvm: '2026-06-01',
    erapvm: '2026-06-15',
    kumppani: asiakas.id,
    otsikko: 'Kesäkuun työt',
    rivit: [
      { myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5, selite: 'Konsultointi' },
      { myyntiKpl: 2, aNetto: 50, alvKoodi: 11, alvProsentti: 14, selite: 'Tarvikkeet' },
      { myyntiKpl: 1, aNetto: 10, alvKoodi: 0, alvProsentti: 0, selite: 'Veroton erä' },
    ],
  });
}

describe('Laskudokumentti', () => {
  it('renderöi numeron, ryhmitellyn viitteen, IBANin, alv-erittelyn ja viivakoodinumerot', async () => {
    await renderRoute('/myyntilaskut/1', { seed: SEED, arrange: siemenna });
    // Tiedoston ensimmäinen testi: reitin kylmäkäännös voi ylittää findBy:n oletus-1 s:n.
    const doc = await screen.findByLabelText('laskudokumentti', undefined, { timeout: 5_000 });

    // Otsikko ja osapuolet.
    expect(within(doc).getByText('Lasku')).toBeInTheDocument();
    expect(within(doc).getAllByText('Demo Oy').length).toBeGreaterThan(0);
    expect(within(doc).getByText('Asiakas Oy')).toBeInTheDocument();

    // Laskumeta: numero, viite ryhmiteltynä (muotoileViite), maksuehto pvm-erosta.
    expect(within(doc).getByText('Laskun numero').closest('div')).toHaveTextContent('1');
    expect(within(doc).getAllByText('10 00193').length).toBeGreaterThan(0);
    expect(within(doc).getByText('Maksuehto').closest('div')).toHaveTextContent('14 pv netto');

    // Alv-erittely kannoittain + summat (NBSP normalisoituu välilyönniksi).
    expect(within(doc).getByText('Yhteensä veroton').closest('div')).toHaveTextContent('210,00 €');
    expect(within(doc).getByText('Alv 25,5 %').closest('div')).toHaveTextContent('25,50 €');
    expect(within(doc).getByText('Alv 14 %').closest('div')).toHaveTextContent('14,00 €');
    expect(within(doc).getByText('Verollinen yhteensä').closest('div')).toHaveTextContent(
      '249,50 €',
    );

    // Sarake- ja maksuosan otsikot samat kuin PDF:ssä.
    expect(within(doc).getByRole('columnheader', { name: 'Määrä' })).toBeInTheDocument();
    expect(within(doc).queryByRole('columnheader', { name: 'Kpl' })).not.toBeInTheDocument();
    expect(within(doc).getByText('Yhteensä EUR')).toBeInTheDocument();

    // Maksublokki: muotoiltu IBAN ja 54-numeroinen virtuaaliviivakoodi.
    expect(within(doc).getByText('FI21 1234 5600 0007 85')).toBeInTheDocument();
    expect(within(doc).getByText(/^4\d{53}$/)).toBeInTheDocument();

    // Lataa PDF -nappi TopBarin toiminnot-slotissa (korvasi window.print()-Tulosta-napin).
    expect(screen.getByRole('button', { name: 'Lataa PDF' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Tulosta' })).not.toBeInTheDocument();
  });

  it('ilman LaskuIbania maksukoodit jäävät pois ja näytetään vihje', async () => {
    const { LaskuIban: _pois, ...ilmanIbania } = SEED.asetukset;
    await renderRoute('/myyntilaskut/1', {
      seed: { ...SEED, asetukset: ilmanIbania },
      arrange: siemenna,
    });
    const doc = await screen.findByLabelText('laskudokumentti');
    expect(
      within(doc).getByText('Lisää IBAN asetuksissa saadaksesi viivakoodin ja QR-koodin'),
    ).toBeInTheDocument();
    expect(within(doc).queryByText(/^4\d{53}$/)).not.toBeInTheDocument();
    // Lasku on silti maksettavissa: viite ja summa näkyvät.
    expect(within(doc).getAllByText('10 00193').length).toBeGreaterThan(0);
    expect(within(doc).getByText('Verollinen yhteensä').closest('div')).toHaveTextContent(
      '249,50 €',
    );
  });

  it('käteiskuitti otsikoituu Kuitiksi ilman osoite- ja maksublokkia', async () => {
    await renderRoute('/myyntilaskut/1', {
      seed: {
        ...SEED,
        tilit: [...SEED.tilit, { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Kassa' } }],
        asetukset: { ...SEED.asetukset, LaskuKateistili: '1910' },
      },
      arrange: async (c) => {
        await c.tallennaMyyntilasku({
          pvm: '2026-06-01',
          maksutapa: 1, // Maksutapa.KATEINEN
          rivit: [{ myyntiKpl: 1, aNetto: 10, alvKoodi: 11, alvProsentti: 25.5 }],
        });
      },
    });
    const doc = await screen.findByLabelText('laskudokumentti');
    expect(within(doc).getByText('Kuitti')).toBeInTheDocument();
    expect(within(doc).queryByText('Saaja')).not.toBeInTheDocument();
    expect(within(doc).queryByText(/^4\d{53}$/)).not.toBeInTheDocument();
  });

  it('hyvittää myyntilaskun kokonaan TopBarin Hyvitä-toiminnolla (backfill)', async () => {
    const { user, client } = await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
        await c.tallennaMyyntilasku({
          pvm: '2026-06-01',
          erapvm: '2026-06-15',
          kumppani: asiakas.id,
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, selite: 'Veroton' }],
        });
      },
    });
    await screen.findByLabelText('laskudokumentti');

    await user.click(screen.getByRole('button', { name: 'Hyvitä' }));
    const dialogi = await screen.findByRole('dialog', { name: 'Hyvitä lasku' });
    await user.click(within(dialogi).getByRole('button', { name: 'Hyvitä' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Hyvitä lasku' })).not.toBeInTheDocument(),
    );

    await waitFor(async () => {
      const rivit = await client.listaaMyyntilaskut({});
      expect(rivit.find((r) => r.tosite === 1)?.avoin).toBe(0);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hyvitä' })).toBeDisabled());
  });

  it('estää hyvityksen osittain maksetulle myyntilaskulle, sallii sen täysin avoimelle', async () => {
    await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
        const lasku = await c.tallennaMyyntilasku({
          pvm: '2026-06-01',
          erapvm: '2026-06-15',
          kumppani: asiakas.id,
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, selite: 'Veroton' }],
        });
        // Osittainen maksu (40,00 €) ennen renderöintiä -> avoin 60,00 € (≠ summa 100,00 €).
        await c.tallennaSuoritus({
          tosite: lasku.id,
          pvm: '2026-06-05',
          summa: Euro.fromCents(4_000),
          rahatili: 1900,
        });
      },
    });
    await screen.findByLabelText('laskudokumentti');

    // Osittain maksettu: avoin ≠ summa → Hyvitä disabloitu.
    expect(screen.getByRole('button', { name: 'Hyvitä' })).toBeDisabled();
  });

  it('sallii hyvityksen täysin avoimelle myyntilaskulle', async () => {
    await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
        await c.tallennaMyyntilasku({
          pvm: '2026-06-01',
          erapvm: '2026-06-15',
          kumppani: asiakas.id,
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, selite: 'Veroton' }],
        });
      },
    });
    await screen.findByLabelText('laskudokumentti');

    // Täysin avoin (avoin === summa): Hyvitä käytössä.
    expect(screen.getByRole('button', { name: 'Hyvitä' })).not.toBeDisabled();
  });

  it('ohjaa muut tositetyypit tavalliseen tositenäkymään', async () => {
    await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-06-01',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [
            {
              tili: 1900,
              debet: Euro.fromCents(5_000),
              kredit: Euro.fromCents(0),
              pvm: '2026-06-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(5_000),
              pvm: '2026-06-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        });
      },
    });
    // Vartija ohjaa /tositteet/1:een → tositenäkymän sektio renderöityy.
    expect(await screen.findByLabelText('tosite')).toBeInTheDocument();
  });
});

describe('Laskudokumentti — hyvityslasku', () => {
  it('näyttää hyvityslaskun otsikon ja hyvitettävän laskun ilman maksuosaa', async () => {
    await renderRoute('/myyntilaskut/2', {
      seed: SEED,
      arrange: async (c) => {
        await siemenna(c); // id 1
        await c.tallennaHyvityslasku({ alkuperainenTosite: 1, pvm: '2026-06-20' }); // id 2
      },
    });
    const doc = await screen.findByLabelText('laskudokumentti');

    expect(within(doc).getByText('Hyvityslasku')).toBeInTheDocument();
    expect(within(doc).getByText('Hyvitettävä lasku')).toBeInTheDocument();
    // Hyvityslaskulla ei ole maksuosaa eikä viivakoodia.
    expect(within(doc).queryByText('Saaja')).not.toBeInTheDocument();
    expect(within(doc).queryByText(/^4\d{53}$/)).not.toBeInTheDocument();
    // Summat käännettynä negatiivisiksi.
    expect(within(doc).getByText('Verollinen yhteensä').closest('div')).toHaveTextContent(
      '−249,50 €',
    );
  });

  it('numeroton hyvityslasku näyttää numeron paikalla viivan', async () => {
    await renderRoute('/myyntilaskut/2', {
      seed: SEED,
      arrange: async (c) => {
        await siemenna(c); // id 1
        await c.luoTosite({
          pvm: '2026-06-20',
          tyyppi: 214,
          sarja: '',
          tila: 100,
          alkuperainenTosite: 1,
          viennit: [],
        });
      },
    });
    const doc = await screen.findByLabelText('laskudokumentti');
    expect(within(doc).getByText('Laskun numero').closest('div')).toHaveTextContent('—');
  });
});

describe('Laskudokumentti — ei rivejä', () => {
  const VAROITUS = 'Laskulla ei ole rivejä — alkuperäinen lasku ja viennit ovat tositteella.';

  function odotaPaneeli(doc: HTMLElement, tositeId: number) {
    expect(within(doc).getByText(VAROITUS)).toBeInTheDocument();
    expect(within(doc).getByRole('link', { name: /tositteella|tosite/i })).toHaveAttribute(
      'href',
      `/tositteet/${tositeId}`,
    );
    // Ei tyhjää taulukkoa, nollasummia eikä maksuosaa.
    expect(within(doc).queryByRole('table')).not.toBeInTheDocument();
    expect(within(doc).queryByText(/Verollinen yhteensä|Yhteensä veroton/)).not.toBeInTheDocument();
    expect(within(doc).queryByText(/0,00/)).not.toBeInTheDocument();
    expect(within(doc).queryByText('Saaja')).not.toBeInTheDocument();
  }

  it('tuotu myyntilasku ilman rivejä näyttää paneelin ja linkin tositteelle', async () => {
    await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-06-01',
          erapvm: '2026-06-15',
          tyyppi: 210,
          sarja: '',
          tila: 100,
          numero: '1',
          viite: '1000193',
          rivit: [],
          viennit: [],
        });
      },
    });
    const doc = await screen.findByLabelText('laskudokumentti');
    odotaPaneeli(doc, 1);
  });

  it('hyvityslasku ilman alkuperäistä laskua näyttää paneelin ja linkin tositteelle', async () => {
    await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-06-20',
          tyyppi: 214,
          sarja: '',
          tila: 100,
          numero: '1',
          viennit: [],
        });
      },
    });
    const doc = await screen.findByLabelText('laskudokumentti');
    odotaPaneeli(doc, 1);
  });

  it('hyvityslasku, jonka alkuperäisellä ei ole rivejä, näyttää paneelin', async () => {
    await renderRoute('/myyntilaskut/2', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-06-01',
          tyyppi: 210,
          sarja: '',
          tila: 100,
          rivit: [],
          viennit: [],
        });
        await c.luoTosite({
          pvm: '2026-06-20',
          tyyppi: 214,
          sarja: '',
          tila: 100,
          alkuperainenTosite: 1,
          viennit: [],
        });
      },
    });
    const doc = await screen.findByLabelText('laskudokumentti');
    odotaPaneeli(doc, 2);
  });

  it('tavallinen lasku ei näytä paneelia', async () => {
    await renderRoute('/myyntilaskut/1', { seed: SEED, arrange: siemenna });
    const doc = await screen.findByLabelText('laskudokumentti');
    expect(within(doc).queryByText(VAROITUS)).not.toBeInTheDocument();
    expect(within(doc).getByRole('table')).toBeInTheDocument();
  });
});

describe('Laskunäkymä — Edellinen / Seuraava', () => {
  it('selaa myyntilaskuja numerojärjestyksessä ohittaen muut tositteet', async () => {
    const { user, router } = await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await siemenna(c); // id 1
        await c.luoTosite({
          pvm: '2026-06-02',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [
            {
              tili: 1900,
              debet: Euro.fromCents(5_000),
              kredit: Euro.fromCents(0),
              pvm: '2026-06-02',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(5_000),
              pvm: '2026-06-02',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        }); // id 2, ei myyntilasku
        await c.tallennaMyyntilasku({
          pvm: '2026-05-01',
          erapvm: '2026-05-15',
          otsikko: 'Toukokuu',
          rivit: [{ myyntiKpl: 1, aNetto: 10, alvKoodi: 0, alvProsentti: 0, selite: 'Työ' }],
        }); // id 3
      },
    });
    await screen.findByLabelText('laskudokumentti');
    const seuraava = screen.getByRole('button', { name: 'Seuraava lasku' });
    await waitFor(() => expect(seuraava).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Edellinen lasku' })).toBeDisabled();
    await user.click(seuraava);
    await waitFor(() => expect(router.state.location.pathname).toBe('/myyntilaskut/3'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Seuraava lasku' })).toBeDisabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Edellinen lasku' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/myyntilaskut/1'));
  });
});

describe('Lataa PDF', () => {
  const alkuperaiset = {
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  afterEach(() => {
    Object.assign(URL, alkuperaiset);
    vi.restoreAllMocks();
  });

  it('on pois käytöstä ilman LaskuIbania ja kertoo syyn', async () => {
    const { LaskuIban: _pois, ...ilmanIbania } = SEED.asetukset;
    await renderRoute('/myyntilaskut/1', {
      seed: { ...SEED, asetukset: ilmanIbania },
      arrange: siemenna,
    });
    await screen.findByLabelText('laskudokumentti');
    const nappi = screen.getByRole('button', { name: 'Lataa PDF' });
    expect(nappi).toBeDisabled();
    expect(nappi).toHaveAttribute('title', expect.stringContaining('IBAN'));
  });

  it('on pois käytöstä laskulta, jolla ei ole rivejä', async () => {
    await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-06-01',
          tyyppi: 210,
          sarja: '',
          tila: 100,
          rivit: [],
          viennit: [],
        });
      },
    });
    await screen.findByLabelText('laskudokumentti');
    const nappi = screen.getByRole('button', { name: 'Lataa PDF' });
    expect(nappi).toBeDisabled();
    expect(nappi).toHaveAttribute('title', expect.stringContaining('ei ole rivejä'));
  });

  it('käteiskuitti ilman IBANia saa ladata PDF:n', async () => {
    const { LaskuIban: _pois, ...ilmanIbania } = SEED.asetukset;
    await renderRoute('/myyntilaskut/1', {
      seed: {
        ...SEED,
        tilit: [...SEED.tilit, { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Kassa' } }],
        asetukset: { ...ilmanIbania, LaskuKateistili: '1910' },
      },
      arrange: async (c) => {
        await c.tallennaMyyntilasku({
          pvm: '2026-06-01',
          maksutapa: 1, // Maksutapa.KATEINEN
          rivit: [{ myyntiKpl: 1, aNetto: 10, alvKoodi: 11, alvProsentti: 25.5 }],
        });
      },
    });
    await screen.findByLabelText('laskudokumentti');
    expect(screen.getByRole('button', { name: 'Lataa PDF' })).toBeEnabled();
  });

  it('klikkaus lataa PDF:n ja tallentaa sen liitteeksi; uusi klikkaus ei lisää kopiota', async () => {
    const luo = vi.fn(() => 'blob:lasku');
    Object.assign(URL, { createObjectURL: luo, revokeObjectURL: vi.fn() });
    const klikki = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user, client } = await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: siemenna,
    });
    await screen.findByLabelText('laskudokumentti');

    await user.click(screen.getByRole('button', { name: 'Lataa PDF' }));
    await waitFor(async () => {
      const liitteet = await client.haeLiitteet(1);
      expect(liitteet).toHaveLength(1);
      expect(liitteet[0]).toMatchObject({ tyyppi: 'application/pdf', nimi: 'lasku-1.pdf' });
    });
    await waitFor(() => expect(klikki).toHaveBeenCalledTimes(1));
    expect(luo).toHaveBeenCalledTimes(1);

    // Sama sisältö → ei toista kopiota, mutta lataus tapahtuu silti.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lataa PDF' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Lataa PDF' }));
    await waitFor(() => expect(klikki).toHaveBeenCalledTimes(2));
    expect(await client.haeLiitteet(1)).toHaveLength(1);
  }, 30_000);
  it('haeLiitteet-virhe ei estä latausta: PDF ladataan ja huomautus kertoo tallennuksen jääneen', async () => {
    const luo = vi.fn(() => 'blob:lasku');
    Object.assign(URL, { createObjectURL: luo, revokeObjectURL: vi.fn() });
    const klikki = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user, client } = await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await siemenna(c);
        vi.spyOn(c, 'haeLiitteet').mockRejectedValue(new Error('verkko poikki'));
      },
    });
    await screen.findByLabelText('laskudokumentti');

    await user.click(screen.getByRole('button', { name: 'Lataa PDF' }));

    await waitFor(() => expect(klikki).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('PDF:ää ei voitu tallentaa liitteeksi')).toBeInTheDocument();
    expect(screen.queryByText(/muodostus epäonnistui/)).not.toBeInTheDocument();
    expect(client.haeLiitteet).toHaveBeenCalled();
  }, 30_000);

  it('lukittu kausi: lataus onnistuu ja huomautus mainitsee lukituksen', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:lasku'), revokeObjectURL: vi.fn() });
    const klikki = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user } = await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await siemenna(c);
        vi.spyOn(c, 'lisaaLiite').mockRejectedValue(
          new ResourceError('PVMLUKITTU', 'Tilikausi on lukittu'),
        );
      },
    });
    await screen.findByLabelText('laskudokumentti');

    await user.click(screen.getByRole('button', { name: 'Lataa PDF' }));

    expect(
      await screen.findByText('PDF:ää ei voitu tallentaa liitteeksi (kausi lukittu)'),
    ).toBeInTheDocument();
    expect(klikki).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('muu tallennusvirhe: huomautus ei väitä kauden olevan lukittu', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:lasku'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user } = await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await siemenna(c);
        vi.spyOn(c, 'lisaaLiite').mockRejectedValue(new Error('levy täynnä'));
      },
    });
    await screen.findByLabelText('laskudokumentti');

    await user.click(screen.getByRole('button', { name: 'Lataa PDF' }));

    const huomio = await screen.findByText(/PDF:ää ei voitu tallentaa liitteeksi/);
    expect(huomio).not.toHaveTextContent('lukittu');
  }, 30_000);
});

describe('Laskunäkymä — asiakkaiden lataus', () => {
  it('odottaa asiakkaat ennen dokumenttia, jotta PDF:ään tulee ostajan osoite', async () => {
    let vapauta: (k: Awaited<ReturnType<KpClient['haeKumppanit']>>) => void = () => {};
    const viive = new Promise<Awaited<ReturnType<KpClient['haeKumppanit']>>>((resolve) => {
      vapauta = resolve;
    });
    let oikeat: Awaited<ReturnType<KpClient['haeKumppanit']>> = [];
    await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await siemenna(c);
        oikeat = await c.haeKumppanit();
        vi.spyOn(c, 'haeKumppanit').mockReturnValue(viive);
      },
    });
    // Asiakkaat vielä latautumatta → ei dokumenttia, ei PDF-nappia.
    expect(await screen.findByText('Ladataan…')).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(screen.queryByLabelText('laskudokumentti')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lataa PDF' })).not.toBeInTheDocument();

    vapauta(oikeat);
    const doc = await screen.findByLabelText('laskudokumentti');
    expect(within(doc).getByText('Asiakkaankatu 2')).toBeInTheDocument();
  });
});
