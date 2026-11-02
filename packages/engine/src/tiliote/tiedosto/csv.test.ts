import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type CsvSarakkeet, jaaCsv, lueCsvSumma, onkoCsv, otsikkoAvain, poimiCsv } from './csv.js';
import { TiliotetiedostoVirhe } from './yhteiset.js';

const fixture = (nimi: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${nimi}`, import.meta.url)), 'utf8');

/** Heittää ja palauttaa virheen, jotta koodi ja rivi voidaan tarkistaa. */
function virhe(f: () => unknown): TiliotetiedostoVirhe {
  try {
    f();
  } catch (e) {
    if (e instanceof TiliotetiedostoVirhe) return e;
    throw e;
  }
  throw new Error('ei heittänyt');
}

/** Yksinkertainen sarakejako: pvm, määrä, nimi, viesti. */
const PERUS: CsvSarakkeet = { pvm: 0, pvmMuoto: 'd.m.yyyy', maara: 1, nimi: [2], viesti: [3] };

describe('jaaCsv', () => {
  it('haistaa puolipisteen, ja puolipiste voittaa tasatilanteen', () => {
    const t = jaaCsv('a;b,c\n1;2,3\n');
    expect(t.otsikot).toEqual(['a', 'b,c']);
    expect(t.rivit).toEqual([['1', '2,3']]);
  });

  it('haistaa sarkaimen', () => {
    expect(jaaCsv('a\tb\tc,d\n1\t2\t3,4\n').otsikot).toEqual(['a', 'b', 'c,d']);
  });

  it('haistaa pilkun, eikä laske lainausmerkkien sisäisiä erottimia', () => {
    const t = jaaCsv('a,"b;c;d",e\n1,"2;3;4",5\n');
    expect(t.otsikot).toEqual(['a', 'b;c;d', 'e']);
    expect(t.rivit).toEqual([['1', '2;3;4', '5']]);
  });

  it('tulkitsee lainauksen sisäisen "" lainausmerkiksi', () => {
    const t = jaaCsv('a;b\n1;"sanoi ""hei""; heti"\n');
    expect(t.rivit).toEqual([['1', 'sanoi "hei"; heti']]);
  });

  it('ohittaa johdannon: otsikko on ensimmäinen rivi, jossa on tavallisin sarakemäärä', () => {
    const t = jaaCsv(fixture('csv-johdanto.csv'));
    expect(t.otsikkorivi).toBe(5);
    expect(t.otsikot).toEqual(['Kirjauspäivä', 'Määrä', 'Saaja/Maksaja', 'Viesti']);
    expect(t.rivit).toHaveLength(3);
    expect(t.rivit[0]).toEqual(['1.10.2026', '-300,00', 'Vuokranantaja Oy', 'Vuokra']);
  });

  it('ei haista erotinta johdannon pilkusta, vaan rivien yhtenäisestä erotinmäärästä', () => {
    const t = jaaCsv(
      [
        'Tili FI7455550000012343, Testi Oy',
        'Kirjauspäivä;Määrä;Saaja/Maksaja;Viesti',
        '1.10.2026;-12,50;Kauppa Malli Oy;Ostos',
        '2.10.2026;100,00;Maija Malli;Lasku 12',
      ].join('\n'),
    );
    expect(t.otsikot).toEqual(['Kirjauspäivä', 'Määrä', 'Saaja/Maksaja', 'Viesti']);
    expect(t.rivit[0]).toEqual(['1.10.2026', '-12,50', 'Kauppa Malli Oy', 'Ostos']);
    expect(t.rivit).toHaveLength(2);
  });

  it('ohittaa tyhjät rivit ja BOM:n, pudottaa otsikon perässä olevan tyhjän sarakkeen (OP)', () => {
    const t = jaaCsv('\uFEFFa;b;\r\n\r\n1;2\r\n3;4\r\n');
    expect(t.otsikot).toEqual(['a', 'b']);
    expect(t.otsikkorivi).toBe(1);
    expect(t.rivit).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });
});

describe('onkoCsv', () => {
  it('hyväksyy pankkien CSV-tiedostot', () => {
    for (const nimi of [
      'csv-nordea.csv',
      'csv-nordea-vanha.txt',
      'csv-op.csv',
      'csv-spankki.csv',
      'csv-danske.csv',
      'csv-holvi.csv',
      'csv-johdanto.csv',
    ])
      expect(onkoCsv(fixture(nimi)), nimi).toBe(true);
  });

  it('hylkää tekstin ilman sarakkeita, yksirivisen ja epäyhtenäisen tiedoston', () => {
    expect(onkoCsv('Hei maailma\nToinen rivi\nKolmas rivi\n')).toBe(false);
    expect(onkoCsv('a;b;c\n')).toBe(false);
    expect(onkoCsv('a;b;c\n1;2;3\n1;2\n1;2;3;4;5\n1;2;3\n')).toBe(false);
  });

  it('hylkää binäärisisällön', () => {
    expect(onkoCsv('\u0000\u0001\u0002;\u0003\u0004\n\u0005;\u0006\u0007\n')).toBe(false);
  });
});

describe('otsikkoAvain', () => {
  it('normalisoi: pienaakkoset, trimmaus, ei BOM:ia, | välissä', () => {
    expect(otsikkoAvain(['\uFEFFKirjauspäivä ', ' Määrä EUROA'])).toBe('kirjauspäivä|määrä euroa');
  });
});

describe('lueCsvSumma', () => {
  it.each([
    ['-1 234,56', -123456],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['12,50-', -1250],
    ['+5', 500],
    ['€ 3,00', 300],
    [' 1 000,00', 100000],
    ['1\u00a0000,5', 100050],
    ['-19.90', -1990],
    ['EUR 3,00', 300],
    ['3,00 eur', 300],
  ])('%s → %i', (s, sentit) => {
    expect(lueCsvSumma(s)).toBe(sentit);
  });

  it.each(['abc', '', '-', '1,2,3x', '--5', '$5', '£5,00', '5,00 USD'])(
    '"%s" heittää VAARA_MUOTO',
    (s) => {
      expect(virhe(() => lueCsvSumma(s)).koodi).toBe('VAARA_MUOTO');
    },
  );
});

describe('poimiCsv', () => {
  it('debet/kredit-tila: debet on aina negatiivinen', () => {
    const t = poimiCsv(fixture('csv-debetkredit.csv'), {
      pvm: 0,
      pvmMuoto: 'd.m.yyyy',
      debet: 2,
      kredit: 3,
      nimi: [],
      viesti: [1],
    });
    expect(t.tapahtumat.map((x) => [x.pvm, x.maara, x.viesti])).toEqual([
      ['2026-10-01', -30000, 'Vuokra'],
      ['2026-10-15', 125000, 'Lasku 12'],
      ['2026-10-28', -4590, 'Korttiosto'],
    ]);
  });

  it('kääntää uusin ensin -tiedoston niin, että saman päivän rivit säilyttävät todellisen järjestyksensä', () => {
    const teksti = [
      'pvm;määrä;nimi;viesti',
      '20.10.2026;-1,00;C;',
      '10.10.2026;-2,00;B2;',
      '10.10.2026;-3,00;B1;',
      '1.10.2026;-4,00;A;',
    ].join('\n');
    expect(poimiCsv(teksti, PERUS).tapahtumat.map((x) => x.nimi)).toEqual(['A', 'B1', 'B2', 'C']);
  });

  it('ei käännä vanhin ensin -tiedostoa, ja lajittelee vakaasti', () => {
    const teksti = [
      'pvm;määrä;nimi;viesti',
      '1.10.2026;-1,00;A;',
      '10.10.2026;-2,00;B1;',
      '5.10.2026;-3,00;X;',
      '10.10.2026;-4,00;B2;',
    ].join('\n');
    expect(poimiCsv(teksti, PERUS).tapahtumat.map((x) => x.nimi)).toEqual(['A', 'X', 'B1', 'B2']);
  });

  it('saldosarakkeesta alku- ja loppusaldo, muoto kuukausitiliote', () => {
    const t = poimiCsv(fixture('csv-danske.csv'), {
      pvm: 0,
      pvmMuoto: 'd.m.yyyy',
      maara: 2,
      nimi: [1],
      viesti: [],
      saldo: 3,
    });
    expect(t).toEqual({
      muoto: 'kuukausitiliote',
      lahde: 'csv',
      kausi: { alkaa: '2026-10-01', loppuu: '2026-10-29' },
      kausiPaatelty: true,
      alkusaldo: 100000,
      loppusaldo: 189160,
      tapahtumat: [
        { pvm: '2026-10-01', nimi: 'Vuokranantaja Oy', maara: -30000 },
        { pvm: '2026-10-15', nimi: 'Kahvila Esimerkki', maara: -1250 },
        { pvm: '2026-10-15', nimi: 'Maija Malli', maara: 125000 },
        { pvm: '2026-10-29', nimi: 'Kauppa Malli Oy', maara: -4590 },
      ],
    });
  });

  it('katkeava saldoketju heittää ja nimeää rivin', () => {
    const teksti = [
      'pvm;määrä;nimi;viesti;saldo',
      '1.10.2026;-10,00;A;;90,00',
      '2.10.2026;-10,00;B;;80,00',
      '3.10.2026;-10,00;C;;75,00',
    ].join('\n');
    const v = virhe(() => poimiCsv(teksti, { ...PERUS, saldo: 4 }));
    expect(v.koodi).toBe('VAARA_MUOTO');
    expect(v.rivi).toBe(4);
  });

  it('ilman saldoa: muoto tapahtumat, kausi tapahtumista ja kausiPaatelty', () => {
    const t = poimiCsv(fixture('csv-johdanto.csv'), PERUS);
    expect(t.muoto).toBe('tapahtumat');
    expect(t.kausi).toEqual({ alkaa: '2026-10-01', loppuu: '2026-10-28' });
    expect(t.kausiPaatelty).toBe(true);
    expect(t.alkusaldo).toBeUndefined();
    expect(t.loppusaldo).toBeUndefined();
  });

  it('etumerkin mukainen nimi: plus → maksaja, miinus → saaja, muuten nimi-sarakkeet', () => {
    const teksti = [
      'pvm;määrä;maksaja;saaja;nimi',
      '1.10.2026;10,00;Maija Malli;Testi Oy;',
      '2.10.2026;-5,00;Testi Oy;Kauppa Oy;',
      '3.10.2026;-5,00;Testi Oy;;Varanimi',
    ].join('\n');
    const t = poimiCsv(teksti, {
      pvm: 0,
      pvmMuoto: 'd.m.yyyy',
      maara: 1,
      maksaja: 2,
      saaja: 3,
      nimi: [4],
      viesti: [],
    });
    expect(t.tapahtumat.map((x) => x.nimi)).toEqual(['Maija Malli', 'Kauppa Oy', 'Varanimi']);
  });

  it('poistaa viitteestä välit ja yhdistää viestisarakkeet', () => {
    const t = poimiCsv('pvm;määrä;viite;a;b\n1.10.2026;5,00;RF68 1000 3;eka;\n', {
      pvm: 0,
      pvmMuoto: 'd.m.yyyy',
      maara: 1,
      nimi: [],
      viesti: [3, 4],
      viite: 2,
    });
    expect(t.tapahtumat).toEqual([
      { pvm: '2026-10-01', nimi: '', maara: 500, viite: 'RF6810003', viesti: 'eka' },
    ]);
  });

  it('ohittaa tyhjät rivit ja viimeisen rivin jälkeisen yhteensä-alatunnisteen', () => {
    const teksti = [
      'pvm;määrä;nimi;viesti',
      '1.10.2026;-1,00;A;',
      ';;;',
      '',
      '2.10.2026;-2,00;B;',
      'Yhteensä;;;',
    ].join('\n');
    expect(poimiCsv(teksti, PERUS).tapahtumat.map((x) => x.nimi)).toEqual(['A', 'B']);
  });

  it('kelvoton päivä kesken tiedoston heittää ja nimeää rivin', () => {
    const teksti = [
      'pvm;määrä;nimi;viesti',
      '1.10.2026;-1,00;A;',
      'xx.10.2026;-5,00;B;',
      '3.10.2026;-2,00;C;',
    ].join('\n');
    const v = virhe(() => poimiCsv(teksti, PERUS));
    expect(v.koodi).toBe('VAARA_MUOTO');
    expect(v.rivi).toBe(3);
  });

  it('alatunnisteen näköinen rivi ennen viimeistä tapahtumaa on virhe', () => {
    const teksti = ['pvm;määrä;nimi;viesti', 'Yhteensä;;;', '3.10.2026;-2,00;C;'].join('\n');
    expect(virhe(() => poimiCsv(teksti, PERUS)).rivi).toBe(2);
  });

  it('kelvoton summa heittää ja nimeää rivin', () => {
    const teksti = ['pvm;määrä;nimi;viesti', '1.10.2026;-1,00;A;', '2.10.2026;kymppi;B;'].join(
      '\n',
    );
    const v = virhe(() => poimiCsv(teksti, PERUS));
    expect(v.koodi).toBe('VAARA_MUOTO');
    expect(v.rivi).toBe(3);
  });

  it('rivinumero lasketaan tiedoston todellisista riveistä johdannon kanssa', () => {
    const teksti = fixture('csv-johdanto.csv').replace('15.10.2026;1250,00', '15.10.2026;x');
    expect(virhe(() => poimiCsv(teksti, PERUS)).rivi).toBe(7);
  });

  it('vaatii joko määrän tai sekä debet- että kredit-sarakkeen', () => {
    const v = virhe(() =>
      poimiCsv(fixture('csv-johdanto.csv'), {
        pvm: 0,
        pvmMuoto: 'd.m.yyyy',
        debet: 1,
        nimi: [],
        viesti: [],
      }),
    );
    expect(v.koodi).toBe('CSV_SARAKKEET');
  });

  it('valuuttasarake: EUR (kirjainkoosta riippumatta) ja tyhjä kelpaavat, muu valuutta on virhe', () => {
    const sarakkeet: CsvSarakkeet = { ...PERUS, valuutta: 4 };
    const ok = [
      'pvm;määrä;nimi;viesti;valuutta',
      '1.10.2026;-1,00;A;;EUR',
      '2.10.2026;-2,00;B;;eur',
      '3.10.2026;-3,00;C;;',
    ];
    expect(poimiCsv(ok.join('\n'), sarakkeet).tapahtumat).toHaveLength(3);
    const usd = [...ok.slice(0, 2), '2.10.2026;-2,00;B;;USD'].join('\n');
    const v = virhe(() => poimiCsv(usd, sarakkeet));
    expect(v.koodi).toBe('VALUUTTA');
    expect(v.rivi).toBe(3);
  });

  it('saldoketju ratkaisee suunnan, kun uusin ensin -tiedoston rivit ovat samalta päivältä', () => {
    const teksti = [
      'Pvm;Saaja/Maksaja;Määrä;Saldo',
      '15.10.2026;Maija Malli;1 250,00;1 937,50',
      '15.10.2026;Kahvila Esimerkki;-12,50;687,50',
    ].join('\n');
    const t = poimiCsv(teksti, {
      pvm: 0,
      pvmMuoto: 'd.m.yyyy',
      maara: 2,
      nimi: [1],
      viesti: [],
      saldo: 3,
    });
    expect(t.tapahtumat.map((x) => x.nimi)).toEqual(['Kahvila Esimerkki', 'Maija Malli']);
    expect(t.alkusaldo).toBe(70000);
    expect(t.loppusaldo).toBe(193750);
    expect(t.muoto).toBe('kuukausitiliote');
  });

  it('tuntematon päivämuoto (esim. rikkinäinen tallennettu jako) → CSV_SARAKKEET, ei kaatumista', () => {
    const sarakkeet = { ...PERUS, pvmMuoto: 'kk/pp' } as unknown as CsvSarakkeet;
    expect(virhe(() => poimiCsv(fixture('csv-johdanto.csv'), sarakkeet)).koodi).toBe(
      'CSV_SARAKKEET',
    );
  });
});
