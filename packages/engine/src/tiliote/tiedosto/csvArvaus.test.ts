import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { jaaCsv, poimiCsv } from './csv.js';
import { ehdotaCsvSarakkeet } from './csvArvaus.js';

const fixture = (nimi: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${nimi}`, import.meta.url)), 'utf8');

describe('ehdotaCsvSarakkeet', () => {
  it('tuntematon asettelu: päivä, kuvaus, vastapuoli, IBAN, viite, summa ja saldo', () => {
    const sarakkeet = ehdotaCsvSarakkeet(jaaCsv(fixture('csv-tuntematon.csv')));
    expect(sarakkeet).toEqual({
      pvm: 0,
      pvmMuoto: 'yyyy-mm-dd',
      viesti: [1],
      nimi: [2],
      iban: 3,
      viite: 4,
      maara: 5,
      saldo: 6,
    });
    const t = poimiCsv(fixture('csv-tuntematon.csv'), sarakkeet);
    expect(t.muoto).toBe('kuukausitiliote');
    expect(t.alkusaldo).toBe(100000);
    expect(t.loppusaldo).toBe(190410);
  });

  it('debet- ja kredit-otsikot: debet/kredit-pari eikä määrää', () => {
    const sarakkeet = ehdotaCsvSarakkeet(jaaCsv(fixture('csv-debetkredit.csv')));
    expect(sarakkeet).toEqual({
      pvm: 0,
      pvmMuoto: 'd.m.yyyy',
      viesti: [1],
      nimi: [],
      debet: 2,
      kredit: 3,
    });
  });

  it('ensimmäinen päivä- ja rahasarake voittavat; viite-otsikko ja arkisto tunnistetaan otsikosta', () => {
    const sarakkeet = ehdotaCsvSarakkeet(
      jaaCsv(
        [
          'Kirjattu;Arvopäivä;Summa;Toinen summa;Maksajan viite;Arkistotunnus;Saajan tili;Saaja',
          '2026/10/01;2026/10/02;-1,00;5,00;abc;A1;FI-tekstiä;Testi Oy',
          '2026/10/03;2026/10/03;2,00;6,00;;A2;;Maija Malli',
        ].join('\n'),
      ),
    );
    expect(sarakkeet).toEqual({
      pvm: 0,
      pvmMuoto: 'yyyy/mm/dd',
      maara: 2,
      viite: 4,
      arkistotunnus: 5,
      nimi: [7],
      viesti: [],
    });
  });

  it('valuutta- tai currency-otsikko → valuutta', () => {
    expect(ehdotaCsvSarakkeet(jaaCsv('pvm;summa;Valuutta\n1.10.2026;1,00;EUR\n')).valuutta).toBe(2);
    expect(ehdotaCsvSarakkeet(jaaCsv('Date,Currency,Amount\n2026-10-01,EUR,1.00\n')).valuutta).toBe(
      1,
    );
  });

  it('suomalainen ja vinoviivapäivä', () => {
    expect(ehdotaCsvSarakkeet(jaaCsv('a;b\n31/10/2026;1,00\n1/9/2026;2,00\n')).pvmMuoto).toBe(
      'd/m/yyyy',
    );
    expect(ehdotaCsvSarakkeet(jaaCsv('a;b\n31.10.2026;1,00\n')).pvmMuoto).toBe('d.m.yyyy');
  });
});
