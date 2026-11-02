import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tarkistaIban, tarkistaRfViite, tarkistaViite } from '@penni/validator';
import { describe, expect, it } from 'vitest';
import type { Tiliote } from '../poimiKuukausitiliote.js';
import { jaaCsv, poimiCsv } from './csv.js';
import { tunnistaCsvPankki } from './csvPankit.js';
import { TiliotetiedostoVirhe, dekoodaa } from './yhteiset.js';

const fixture = (nimi: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${nimi}`, import.meta.url)), 'utf8');

/** Windows-1252-koodaus suomalaisille merkeille; muut kuin ASCII ja nämä ovat testin virhe. */
const W1252: Record<string, number> = {
  ä: 0xe4,
  ö: 0xf6,
  å: 0xe5,
  Ä: 0xc4,
  Ö: 0xd6,
  Å: 0xc5,
  '€': 0x80,
};
function windows1252(teksti: string): Uint8Array {
  return Uint8Array.from([...teksti], (m) => {
    const koodi = m.charCodeAt(0);
    if (koodi < 0x80) return koodi;
    const tavu = W1252[m];
    if (tavu === undefined) throw new Error(`ei 1252-koodia merkille ${m}`);
    return tavu;
  });
}

function lue(teksti: string): { pankki: string | undefined; tiliote: Tiliote | undefined } {
  const pankki = tunnistaCsvPankki(jaaCsv(teksti).otsikot);
  return { pankki: pankki?.pankki, tiliote: pankki && poimiCsv(teksti, pankki.sarakkeet) };
}

const kausi = (alkaa: string, loppuu: string) => ({ alkaa, loppuu });

const ODOTETUT: Record<string, { pankki: string; tiliote: Tiliote }> = {
  'csv-nordea.csv': {
    pankki: 'Nordea',
    tiliote: {
      muoto: 'tapahtumat',
      lahde: 'csv',
      kausi: kausi('2026-10-02', '2026-10-28'),
      kausiPaatelty: true,
      tapahtumat: [
        {
          pvm: '2026-10-02',
          nimi: 'Vuokranantaja Oy',
          maara: -30000,
          viesti: 'Vuokra lokakuu',
          viite: '123453',
        },
        { pvm: '2026-10-15', nimi: 'Kahvila Esimerkki', maara: -1250, viesti: 'Kahvi' },
        {
          pvm: '2026-10-15',
          nimi: 'Maija Malli',
          maara: 125000,
          viesti: 'Lasku 12',
          viite: '10003',
        },
        { pvm: '2026-10-28', nimi: 'Kauppa Malli Oy', maara: -4590, viesti: 'Korttiosto' },
      ],
    } as Tiliote,
  },
  'csv-nordea-vanha.txt': {
    pankki: 'Nordea (vanha)',
    tiliote: {
      muoto: 'tapahtumat',
      lahde: 'csv',
      kausi: kausi('2026-10-01', '2026-10-20'),
      kausiPaatelty: true,
      tapahtumat: [
        {
          pvm: '2026-10-01',
          nimi: 'Vuokranantaja Oy',
          maara: -30000,
          viesti: 'Vuokra lokakuu Tilisiirto',
          viite: '123453',
          iban: 'FI2298765400000003',
        },
        {
          pvm: '2026-10-05',
          nimi: 'Maija Malli',
          maara: 125000,
          viesti: 'Viitesiirto',
          viite: '10003',
          iban: 'FI1612345600000002',
        },
        { pvm: '2026-10-20', nimi: 'Kauppa Malli Oy', maara: -4590, viesti: 'Ostos Korttiosto' },
      ],
    } as Tiliote,
  },
  'csv-op.csv': {
    pankki: 'OP',
    tiliote: {
      muoto: 'tapahtumat',
      lahde: 'csv',
      kausi: kausi('2026-10-03', '2026-10-25'),
      kausiPaatelty: true,
      tapahtumat: [
        {
          pvm: '2026-10-03',
          nimi: 'Vuokranantaja Oy',
          maara: -123456,
          viesti: 'Vuokra lokakuu TILISIIRTO',
          viite: '123453',
          iban: 'FI2298765400000003',
          arkistotunnus: '20261003/5ABC1/000001',
        },
        {
          pvm: '2026-10-12',
          nimi: 'Maija Malli',
          maara: 50000,
          viesti: 'VIITESIIRTO',
          viite: '10003',
          iban: 'FI1612345600000002',
          arkistotunnus: '20261012/5ABC1/000002',
        },
        {
          pvm: '2026-10-25',
          nimi: 'Kauppa Malli Oy',
          maara: -999,
          viesti: 'Ostos ääkkösillä € PKORTTIMAKSU',
          arkistotunnus: '20261025/5ABC1/000003',
        },
      ],
    } as Tiliote,
  },
  'csv-spankki.csv': {
    pankki: 'S-Pankki',
    tiliote: {
      muoto: 'tapahtumat',
      lahde: 'csv',
      kausi: kausi('2026-10-02', '2026-10-30'),
      kausiPaatelty: true,
      tapahtumat: [
        {
          pvm: '2026-10-02',
          nimi: 'Kauppa Malli Oy',
          maara: -2500,
          viesti: 'Lasku 7 TILISIIRTO',
          iban: 'FI2755555500000004',
          arkistotunnus: '20261002ABCD0001',
        },
        {
          pvm: '2026-10-14',
          nimi: 'Maija Malli',
          maara: 80000,
          viesti: 'TILISIIRTO',
          viite: '20261010',
          iban: 'FI4312345600000001',
          arkistotunnus: '20261014ABCD0002',
        },
        {
          pvm: '2026-10-30',
          nimi: 'Testipankki',
          maara: -450,
          viesti: 'PALVELUMAKSU',
          arkistotunnus: '20261030ABCD0003',
        },
      ],
    } as Tiliote,
  },
  'csv-danske.csv': {
    pankki: 'Danske Bank',
    tiliote: {
      muoto: 'kuukausitiliote',
      lahde: 'csv',
      kausi: kausi('2026-10-01', '2026-10-29'),
      kausiPaatelty: true,
      alkusaldo: 100000,
      loppusaldo: 189160,
      tapahtumat: [
        { pvm: '2026-10-01', nimi: 'Vuokranantaja Oy', maara: -30000 },
        { pvm: '2026-10-15', nimi: 'Kahvila Esimerkki', maara: -1250 },
        { pvm: '2026-10-15', nimi: 'Maija Malli', maara: 125000 },
        { pvm: '2026-10-29', nimi: 'Kauppa Malli Oy', maara: -4590 },
      ],
    } as Tiliote,
  },
  'csv-holvi.csv': {
    pankki: 'Holvi',
    tiliote: {
      muoto: 'tapahtumat',
      lahde: 'csv',
      kausi: kausi('2026-10-04', '2026-10-27'),
      kausiPaatelty: true,
      tapahtumat: [
        {
          pvm: '2026-10-04',
          nimi: 'Kauppa Malli Oy',
          maara: -1990,
          viesti: 'Card payment',
          arkistotunnus: 'HOLVI-0001',
        },
        {
          pvm: '2026-10-11',
          nimi: 'Maija Malli',
          maara: 125000,
          viesti: 'Lasku 12 Bank transfer',
          viite: 'RF6810003',
          arkistotunnus: 'HOLVI-0002',
        },
        {
          pvm: '2026-10-27',
          nimi: 'Testi Oy',
          maara: -700,
          viesti: 'Kuukausimaksu "lokakuu" Fee, monthly',
          arkistotunnus: 'HOLVI-0003',
        },
      ],
    } as Tiliote,
  },
};

describe('tunnistaCsvPankki', () => {
  for (const [nimi, odotettu] of Object.entries(ODOTETUT)) {
    it(`${nimi} → ${odotettu.pankki}, rivit täsmälleen`, () => {
      expect(lue(fixture(nimi))).toEqual(odotettu);
    });
  }

  it('lisäsarake Nordean otsikossa ei estä tunnistusta', () => {
    const teksti = fixture('csv-nordea.csv')
      .split('\n')
      .map((r) => (r === '' ? r : `${r};lisä`))
      .join('\n');
    expect(lue(teksti)).toEqual(ODOTETUT['csv-nordea.csv']);
  });

  it('sarakkeet paikannetaan nimen eikä järjestyksen mukaan', () => {
    const p = tunnistaCsvPankki([
      'Summa',
      'Kirjauspäivä',
      'Maksupäivä',
      'Tapahtumalaji',
      'Maksaja',
      'Saajan nimi',
      'Saajan tilinumero',
      'Saajan BIC-tunnus',
      'Viitenumero',
      'Viesti',
      'Arkistointitunnus',
    ]);
    expect(p?.pankki).toBe('S-Pankki');
    expect(p?.sarakkeet.maara).toBe(0);
    expect(p?.sarakkeet.pvm).toBe(1);
  });

  it('Nordean Valuutta- ja Holvin Currency-sarake: muu kuin EUR on virhe rivinumeroineen', () => {
    for (const [nimi, vanha, uusi, rivi] of [
      ['csv-nordea.csv', ';EUR\n2026/10/15;-12,50', ';USD\n2026/10/15;-12,50', 3],
      ['csv-holvi.csv', '-7.00,EUR', '-7.00,GBP', 4],
    ] as const) {
      const teksti = fixture(nimi).replace(vanha, uusi);
      expect(teksti).not.toBe(fixture(nimi));
      const pankki = tunnistaCsvPankki(jaaCsv(teksti).otsikot);
      expect(pankki?.sarakkeet.valuutta).toBeDefined();
      let virhe: unknown;
      try {
        poimiCsv(
          teksti,
          pankki?.sarakkeet ?? { pvm: 0, pvmMuoto: 'd.m.yyyy', nimi: [], viesti: [] },
        );
      } catch (e) {
        virhe = e;
      }
      expect(virhe).toBeInstanceOf(TiliotetiedostoVirhe);
      expect((virhe as TiliotetiedostoVirhe).koodi).toBe('VALUUTTA');
      expect((virhe as TiliotetiedostoVirhe).rivi).toBe(rivi);
    }
  });

  it('tuntematon otsikko → undefined', () => {
    expect(tunnistaCsvPankki(jaaCsv(fixture('csv-tuntematon.csv')).otsikot)).toBeUndefined();
  });

  it('OP:n tiedosto Windows-1252-tavuina dekoodaa-funktion kautta', () => {
    const tavut = windows1252(fixture('csv-op.csv'));
    expect(tavut).toContain(0xe4); // Määrä → ä = 0xE4
    expect(lue(dekoodaa(tavut))).toEqual(ODOTETUT['csv-op.csv']);
  });

  it('OP:n tiedosto UTF-8 BOM:in kanssa, tavuina ja tekstinä', () => {
    const utf8 = new TextEncoder().encode(fixture('csv-op.csv'));
    const bomilla = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8]);
    expect(lue(dekoodaa(bomilla))).toEqual(ODOTETUT['csv-op.csv']);
    expect(lue(`\uFEFF${fixture('csv-op.csv')}`)).toEqual(ODOTETUT['csv-op.csv']);
  });
});

describe('aineistot ovat synteettisiä mutta kelvollisia', () => {
  it('IBANit ja viitteet läpäisevät tarkisteen', () => {
    const ibanit = new Set<string>();
    const viitteet = new Set<string>();
    for (const { tiliote } of Object.values(ODOTETUT))
      for (const t of tiliote.tapahtumat) {
        if (t.iban) ibanit.add(t.iban);
        if (t.viite) viitteet.add(t.viite);
      }
    expect(ibanit.size).toBeGreaterThan(0);
    for (const iban of ibanit) expect(tarkistaIban(iban), iban).toBe(true);
    for (const viite of viitteet)
      expect(tarkistaViite(viite) || tarkistaRfViite(viite), viite).toBe(true);
  });
});
