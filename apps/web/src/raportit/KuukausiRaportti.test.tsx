import { renderRoute } from '@/test/renderRoute';
import type { RaporttiRivi } from '@penni/engine';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { kuukaudet, kuukausiOtsikko, yhdistaKuukaudet } from './KuukausiRaportti';

const TULOS = JSON.stringify({
  nimi: { fi: 'Tuloslaskelma' },
  muoto: { fi: 'Yleinen' },
  rivit: [
    { fi: 'Liikevaihto', L: '30..35 S *', M: 'bold' },
    { fi: 'Tilikauden tulos', L: '3..9 S', M: 'bold' },
  ],
});
const TASE = JSON.stringify({
  nimi: { fi: 'Tase' },
  muoto: { fi: 'Yleinen' },
  rivit: [{ fi: 'Vastaavaa yhteensä', L: '1 S', M: 'bold' }],
});

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tulos' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {
    Nimi: 'Demo Oy',
    AlvVelvollinen: 'false',
    'tulos/yleinen': TULOS,
    'tase/yleinen': TASE,
  },
};

const vienti = (tili: number, debet: number, kredit: number, pvm: string) => ({
  tili,
  debet: Euro.fromCents(debet),
  kredit: Euro.fromCents(kredit),
  pvm,
  alvKoodi: 0,
  alvProsentti: 0,
});

/** Myynti: debet pankki, kredit myynti. */
const myynti = (pvm: string, sentit: number) => ({
  pvm,
  tyyppi: 200,
  sarja: '',
  tila: 100,
  viennit: [vienti(1900, sentit, 0, pvm), vienti(3000, 0, sentit, pvm)],
});

const rivi = (
  teksti: string,
  arvo: number | null,
  lisa: Partial<RaporttiRivi> = {},
): RaporttiRivi => ({
  teksti,
  sisennys: 0,
  lihava: false,
  arvo: arvo === null ? null : Euro.fromCents(arvo),
  ...lisa,
});

describe('kuukaudet', () => {
  it('antaa kalenterikuukaudet ja rajaa ensimmäisen ja viimeisen jaksoon', () => {
    expect(kuukaudet('2026-01-01', '2026-03-31')).toEqual([
      { alkaa: '2026-01-01', loppuu: '2026-01-31' },
      { alkaa: '2026-02-01', loppuu: '2026-02-28' },
      { alkaa: '2026-03-01', loppuu: '2026-03-31' },
    ]);
    expect(kuukaudet('2026-03-15', '2027-02-14')).toHaveLength(12);
    expect(kuukaudet('2026-03-15', '2026-04-14')).toEqual([
      { alkaa: '2026-03-15', loppuu: '2026-03-31' },
      { alkaa: '2026-04-01', loppuu: '2026-04-14' },
    ]);
    expect(kuukaudet('2028-02-01', '2028-02-29')[0]?.loppuu).toBe('2028-02-29');
  });

  it('otsikoi kuukauden M/yyyy', () => {
    expect(kuukausiOtsikko({ alkaa: '2026-03-01', loppuu: '2026-03-31' })).toBe('3/2026');
  });
});

describe('yhdistaKuukaudet', () => {
  it('yhdistää rivit avaimella, vaikka kuukausien rivirakenne eroaa', () => {
    const tammi = [
      rivi('Liikevaihto', 100, { kaavarivi: 0 }),
      rivi('3000 Myynti', 100, { tili: 3000, sisennys: 1, kaavarivi: 0 }),
      rivi('Tulos', 100, { kaavarivi: 1 }),
    ];
    // Helmikuussa myyntitili on nolla (erittelyrivi puuttuu) ja uusi tili 3100 tulee mukaan.
    const helmi = [
      rivi('Liikevaihto', 50, { kaavarivi: 0 }),
      rivi('3100 Muu', 50, { tili: 3100, sisennys: 1, kaavarivi: 0 }),
      rivi('Tulos', 50, { kaavarivi: 1 }),
    ];
    const rivit = yhdistaKuukaudet([tammi, helmi]);
    expect(rivit.map((r) => r.avain)).toEqual(['0', '0>3000', '0>3100', '1']);
    expect(rivit.map((r) => r.arvot)).toEqual([
      [100, 50],
      [100, undefined],
      [undefined, 50],
      [100, 50],
    ]);
  });

  it('erottaa samannimiset kaavarivit indeksillä, kun ensimmäinen puuttuu alkukuukausilta', () => {
    // Kaavassa "Saamiset" kahdesti (rivit 3 ja 5, kuten Myyntisaamiset 160..162 / 170..172).
    // Tammikuussa vain jälkimmäisellä on saldoa, maaliskuussa molemmilla.
    const tammi = [rivi('Saamiset', 70, { kaavarivi: 5 })];
    const maalis = [rivi('Saamiset', 50, { kaavarivi: 3 }), rivi('Saamiset', 70, { kaavarivi: 5 })];
    const rivit = yhdistaKuukaudet([tammi, maalis]);
    expect(rivit.map((r) => [r.avain, r.arvot])).toEqual([
      ['3', [undefined, 50]],
      ['5', [70, 70]],
    ]);
  });

  it('sijoittaa myöhemmässä kuussa ilmestyvän kaavarivin emonsa erittelyrivien jälkeen', () => {
    // Tammikuu: myyntiä tilillä 3000. Helmikuu: ei myyntiä, mutta muita tuottoja (rivi 3).
    const tammi = [
      rivi('Liikevaihto', 1000, { kaavarivi: 0 }),
      rivi('3000 Myynti', 1000, { tili: 3000, sisennys: 1, kaavarivi: 0 }),
    ];
    const helmi = [
      rivi('Liikevaihto', 0, { kaavarivi: 0 }),
      rivi('Muut tuotot', 500, { kaavarivi: 3 }),
      rivi('3700 Muu', 500, { tili: 3700, sisennys: 1, kaavarivi: 3 }),
    ];
    expect(yhdistaKuukaudet([tammi, helmi]).map((r) => r.avain)).toEqual([
      '0',
      '0>3000',
      '3',
      '3>3700',
    ]);
  });

  it('sovelletaan Kitsaksen näyttösäännöt kerran kuukausien yli', () => {
    const laji = (l: RaporttiRivi['kaavaLaji']) => ({ kaavaLaji: l });
    // Rivit: 0 Tuotto, 1 '=' välisumma, 2 Avustukset (88 *), 3 '=' Tulos, 4 Tyhjä (ei koskaan).
    const kk = (avustus: number | null) => {
      const r: RaporttiRivi[] = [
        rivi('Tuotto', 600, { kaavarivi: 0 }),
        rivi('Tuotto/kulujäämä', 600, { kaavarivi: 1, ...laji('valisumma') }),
        rivi('Avustukset', avustus ?? 0, {
          kaavarivi: 2,
          ...(avustus === null ? laji('ohitettava') : {}),
        }),
        rivi('Tulos', 600 + (avustus ?? 0), { kaavarivi: 3, ...laji('valisumma') }),
        rivi('Tyhjä', 0, { kaavarivi: 4, ...laji('ohitettava') }),
      ];
      return r;
    };
    const rivit = yhdistaKuukaudet([kk(null), kk(100)]);
    // Avustukset ja Tulos näkyvät (avustus on tammikuussa tyhjä mutta helmikuussa ei), Tyhjä ei.
    expect(rivit.map((r) => [r.teksti, r.arvot])).toEqual([
      ['Tuotto', [600, 600]],
      ['Tuotto/kulujäämä', [600, 600]],
      ['Avustukset', [0, 100]],
      ['Tulos', [600, 700]],
    ]);
    // Jos avustuksia ei ole missään kuussa: Avustukset pois, jolloin Tulos olisi toinen välisumma
    // peräkkäin ja jää pois.
    expect(yhdistaKuukaudet([kk(null), kk(null)]).map((r) => r.teksti)).toEqual([
      'Tuotto',
      'Tuotto/kulujäämä',
    ]);
  });

  it('muistaa välirivit kuukausien yli', () => {
    const tyhja = { ...rivi('', null), tyhja: true };
    const tammi = [rivi('A', 1, { kaavarivi: 0 }), rivi('B', 2, { kaavarivi: 1 })];
    const helmi = [rivi('A', 1, { kaavarivi: 0 }), tyhja, rivi('B', 2, { kaavarivi: 1 })];
    expect(yhdistaKuukaudet([tammi, helmi]).map((r) => [r.avain, r.tyhjaEnnen])).toEqual([
      ['0', false],
      ['1', true],
    ]);
  });
});

describe('Tuloslaskelma kuukausittain', () => {
  it('näyttää sarakkeen jokaiselle kuukaudelle ja Yhteensä-sarakkeen', async () => {
    const { user } = await renderRoute('/raportit', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite(myynti('2026-03-10', 10_000));
        await c.luoTosite(myynti('2026-03-20', 5_000));
        await c.luoTosite(myynti('2026-05-02', 2_500));
      },
    });
    const valitsin = await screen.findByLabelText('Raportti');
    await within(valitsin).findByRole('option', { name: 'Tuloslaskelma kuukausittain' });
    await user.selectOptions(valitsin, 'Tuloslaskelma kuukausittain');

    const otsikot = await screen.findAllByRole('columnheader');
    expect(otsikot.map((o) => o.textContent)).toEqual([
      'Rivi',
      ...Array.from({ length: 12 }, (_, i) => `${i + 1}/2026`),
      'Yhteensä',
    ]);

    const liikevaihto = (await screen.findByText('Liikevaihto')).closest('tr') as HTMLElement;
    const solut = within(liikevaihto)
      .getAllByRole('cell')
      .map((s) => s.textContent?.replace(/\u00a0/g, ' '));
    // Rivi, 12 kuukautta, yhteensä. Maalis 150,00, touko 25,00, muut nollia.
    expect(solut[0]).toBe('Liikevaihto');
    expect(solut[3]).toBe('150,00 €');
    expect(solut[5]).toBe('25,00 €');
    expect(solut[1]).toBe('0,00 €');
    expect(solut[13]).toBe('175,00 €');

    // Tilirivit mukana, ja "Näytä tilit" piilottaa ne.
    const tili = screen.getByText('3000 Myynti').closest('tr') as HTMLElement;
    expect(within(tili).getAllByRole('cell')[3]).toHaveTextContent('150,00 €');
    await user.click(screen.getByRole('checkbox', { name: 'Näytä tilit' }));
    expect(screen.queryByText('3000 Myynti')).not.toBeInTheDocument();
  });
});

describe('Tase kuukausittain', () => {
  it('näyttää kuukauden lopun saldon ilman Yhteensä-saraketta', async () => {
    const { user } = await renderRoute('/raportit', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite(myynti('2026-03-10', 10_000));
        await c.luoTosite(myynti('2026-05-02', 2_500));
      },
    });
    const valitsin = await screen.findByLabelText('Raportti');
    await within(valitsin).findByRole('option', { name: 'Tase kuukausittain' });
    await user.selectOptions(valitsin, 'Tase kuukausittain');

    await waitFor(() => expect(screen.getByText('Vastaavaa yhteensä')).toBeInTheDocument());
    expect(screen.queryByRole('columnheader', { name: 'Yhteensä' })).not.toBeInTheDocument();
    const solut = within(screen.getByText('Vastaavaa yhteensä').closest('tr') as HTMLElement)
      .getAllByRole('cell')
      .map((s) => s.textContent?.replace(/\u00a0/g, ' '));
    expect(solut).toHaveLength(13);
    // Tase on kertyvä: helmikuu 0, maalis 100,00, huhti 100,00, touko 125,00 …
    expect(solut[2]).toBe('0,00 €');
    expect(solut[3]).toBe('100,00 €');
    expect(solut[4]).toBe('100,00 €');
    expect(solut[5]).toBe('125,00 €');
    expect(solut[12]).toBe('125,00 €');
  });
});

describe('Tase kuukausittain, samannimiset kaavarivit', () => {
  it('pitää saman tekstin rivit erillään, kun ensimmäisellä ei ole saldoa alkukuukausina', async () => {
    const taseKaksoset = JSON.stringify({
      nimi: { fi: 'Tase' },
      muoto: { fi: 'Yleinen' },
      rivit: [
        { fi: 'Saamiset', L: '16' },
        { fi: 'Saamiset', L: '17' },
      ],
    });
    const { user } = await renderRoute('/raportit', {
      seed: {
        ...SEED,
        tilit: [
          ...SEED.tilit,
          { numero: 1600, tyyppi: 'AS', nimi: { fi: 'Saatava A' } },
          { numero: 1700, tyyppi: 'AS', nimi: { fi: 'Saatava B' } },
        ],
        asetukset: { ...SEED.asetukset, 'tase/yleinen': taseKaksoset },
      },
      arrange: async (c) => {
        // Tammikuu: vain 17x saa saldoa. Maaliskuu: myös 16x.
        await c.luoTosite({
          pvm: '2026-01-10',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [vienti(1700, 7_000, 0, '2026-01-10'), vienti(3000, 0, 7_000, '2026-01-10')],
        });
        await c.luoTosite({
          pvm: '2026-03-10',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [vienti(1600, 5_000, 0, '2026-03-10'), vienti(3000, 0, 5_000, '2026-03-10')],
        });
      },
    });
    const valitsin = await screen.findByLabelText('Raportti');
    await within(valitsin).findByRole('option', { name: 'Tase kuukausittain' });
    await user.selectOptions(valitsin, 'Tase kuukausittain');

    const rivit = await screen.findAllByText('Saamiset');
    expect(rivit).toHaveLength(2);
    const solut = (e: HTMLElement) =>
      within(e.closest('tr') as HTMLElement)
        .getAllByRole('cell')
        .map((s) => s.textContent?.replace(/\u00a0/g, ' '));
    const ensimmainen = solut(rivit[0] as HTMLElement); // 16x
    const toinen = solut(rivit[1] as HTMLElement); // 17x
    // [rivi, tammi, helmi, maalis, ...]
    expect(ensimmainen.slice(1, 4)).toEqual(['0,00 €', '0,00 €', '50,00 €']);
    expect(toinen.slice(1, 4)).toEqual(['70,00 €', '70,00 €', '70,00 €']);
  });
});

describe('Tuloslaskelma kuukausittain, välisummat', () => {
  it('näyttää välisumman oikein kuukausissa, joissa moottori ohittaisi sen', async () => {
    // Kitsas yhdistys tulos/yleinen: '=' (17), '88 *' (18), '=' (19).
    const yhdistys = JSON.stringify({
      nimi: { fi: 'Tuloslaskelma' },
      muoto: { fi: 'Yhdistys' },
      rivit: [
        { fi: 'Tuotto', L: '3 S' },
        { fi: 'Tuotto/kulujäämä', L: '=' },
        { fi: 'Avustukset', L: '88 *' },
        { fi: 'Tilikauden tulos', L: '=' },
      ],
    });
    const { user } = await renderRoute('/raportit', {
      seed: {
        ...SEED,
        tilit: [...SEED.tilit, { numero: 8800, tyyppi: 'C', nimi: { fi: 'Avustus' } }],
        asetukset: { ...SEED.asetukset, 'tulos/yleinen': yhdistys },
      },
      arrange: async (c) => {
        await c.luoTosite(myynti('2026-01-10', 60_000));
        await c.luoTosite({
          pvm: '2026-02-10',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [vienti(1900, 10_000, 0, '2026-02-10'), vienti(8800, 0, 10_000, '2026-02-10')],
        });
      },
    });
    const valitsin = await screen.findByLabelText('Raportti');
    await within(valitsin).findByRole('option', { name: 'Tuloslaskelma kuukausittain' });
    await user.selectOptions(valitsin, 'Tuloslaskelma kuukausittain');
    const tulos = (await screen.findByText('Tilikauden tulos')).closest('tr') as HTMLElement;
    const solut = within(tulos)
      .getAllByRole('cell')
      .map((s) => s.textContent?.replace(/\u00a0/g, ' '));
    // Tammikuu 600,00 (moottori ohitti rivin: 0,00), helmikuu 100,00, Yhteensä 700,00.
    expect(solut[1]).toBe('600,00 €');
    expect(solut[2]).toBe('100,00 €');
    expect(solut[13]).toBe('700,00 €');
  });
});
