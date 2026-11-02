import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Euro } from '@penni/euro';
import { tarkistaIban, tarkistaViite } from '@penni/validator';
import { describe, expect, it } from 'vitest';
import { poimiCamt } from './camt.js';
import { TiliotetiedostoVirhe } from './yhteiset.js';

const lataa = (nimi: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${nimi}`, import.meta.url)), 'utf8');

const e = (s: string) => Euro.fromString(s);

function virhe(f: () => unknown): TiliotetiedostoVirhe {
  try {
    f();
  } catch (x) {
    if (x instanceof TiliotetiedostoVirhe) return x;
    throw x;
  }
  throw new Error('odotettiin TiliotetiedostoVirhe, mutta virhettä ei tullut');
}

/** Pieni camt.053-tiedosto yhdellä kirjatulla veloituksella/hyvityksellä, testien muokattavaksi. */
function minimi(
  ntry: string,
  stmtLisa = '<FrToDt><FrDtTm>2026-10-01T00:00:00Z</FrDtTm><ToDtTm>2026-10-31T23:59:59Z</ToDtTm></FrToDt>',
): string {
  return `<Document><BkToCstmrStmt><Stmt><Id>1</Id>${stmtLisa}<Acct><Id><IBAN>FI7455550000012343</IBAN></Id><Ccy>EUR</Ccy></Acct>${ntry}</Stmt></BkToCstmrStmt></Document>`;
}
const merkinta = (amt: string, ind = 'CRDT', loppu = '') =>
  `<Ntry><Amt Ccy="EUR">${amt}</Amt><CdtDbtInd>${ind}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-05</Dt></BookgDt>${loppu}</Ntry>`;

describe('fixtureiden synteettiset tunnukset', () => {
  it('IBANit ja viitteet läpäisevät tarkisteet', () => {
    const kaikki = [
      'camt053-perus.xml',
      'camt053-era.xml',
      'camt053-etuliite-v02.xml',
      'camt053-kaksi-otetta.xml',
      'camt054.xml',
    ]
      .map(lataa)
      .join('\n');
    const ibanit = [...kaikki.matchAll(/<(?:ns2:)?IBAN>([^<]+)</g)].map((m) => m[1] ?? '');
    expect(ibanit.length).toBeGreaterThan(5);
    for (const iban of ibanit) expect(tarkistaIban(iban), iban).toBe(true);
    const viitteet = [...kaikki.matchAll(/<(?:ns2:)?Ref>([^<]+)</g)].map((m) => m[1] ?? '');
    expect(viitteet.length).toBeGreaterThan(5);
    for (const v of viitteet) expect(tarkistaViite(v), v).toBe(true);
  });
});

describe('poimiCamt: camt.053 perus', () => {
  const tiliote = poimiCamt(lataa('camt053-perus.xml'));

  it('lukee kauden, saldot ja tilin', () => {
    expect(tiliote.lahde).toBe('camt053');
    expect(tiliote.muoto).toBe('kuukausitiliote');
    expect(tiliote.iban).toBe('FI7455550000012343');
    expect(tiliote.kausi).toEqual({ alkaa: '2026-10-01', loppuu: '2026-10-31' });
    expect(tiliote.alkusaldo).toBe(100000);
    expect(tiliote.loppusaldo).toBe(218450);
    expect(tiliote.kausiPaatelty).toBeUndefined();
  });

  it('lukee kirjatut tapahtumat ja ohittaa odottavan', () => {
    expect(tiliote.tapahtumat).toEqual([
      {
        pvm: '2026-10-05',
        nimi: 'Testikauppa Ltd',
        maara: -4990,
        viesti: 'Korttiosto',
        arkistotunnus: '202610050001',
        alkuperainen: { valuutta: 'USD', maara: 5420 },
      },
      {
        pvm: '2026-10-12',
        nimi: 'Maija Malli',
        maara: 123450,
        viite: '123453',
        viesti: 'Lasku 12345 Kiitos',
        arkistotunnus: '202610120042',
        iban: 'FI1522220000045675',
      },
      {
        pvm: '2026-10-31',
        nimi: 'Tilinhoitomaksu',
        maara: -10,
        arkistotunnus: '202610310007',
      },
    ]);
  });

  it('saldot täsmäävät tapahtumiin', () => {
    const summa = tiliote.tapahtumat.reduce((s, t) => s + t.maara, 0);
    expect((tiliote.alkusaldo ?? 0) + summa).toBe(tiliote.loppusaldo);
  });
});

describe('poimiCamt: summat', () => {
  it.each([
    ['1234.5', 123450],
    ['0.10', 10],
    ['1000', 100000],
    ['0.01', 1],
    ['12345678.90', 1234567890],
  ])('Amt %s → %d senttiä', (amt, sentit) => {
    expect(poimiCamt(minimi(merkinta(amt))).tapahtumat[0]?.maara).toBe(sentit);
    expect(poimiCamt(minimi(merkinta(amt, 'DBIT'))).tapahtumat[0]?.maara).toBe(-sentit);
  });

  it.each(['abc', '12,50', '', '-5.00', '1.234'])(
    'virheellinen summa "%s" → VAARA_MUOTO',
    (amt) => {
      expect(virhe(() => poimiCamt(minimi(merkinta(amt)))).koodi).toBe('VAARA_MUOTO');
    },
  );

  it('muu kuin euromääräinen rivi → VALUUTTA', () => {
    const xml = minimi(merkinta('5.00')).replace('<Amt Ccy="EUR">5.00', '<Amt Ccy="USD">5.00');
    expect(virhe(() => poimiCamt(xml)).koodi).toBe('VALUUTTA');
  });

  it('tilin valuutta USD → VALUUTTA', () => {
    const xml = lataa('camt053-perus.xml').replace('<Ccy>EUR</Ccy>', '<Ccy>USD</Ccy>');
    expect(virhe(() => poimiCamt(xml)).koodi).toBe('VALUUTTA');
  });

  it('EUR-muotoinen InstdAmt ei tuota alkuperäistä summaa', () => {
    const xml = minimi(
      merkinta(
        '5.00',
        'DBIT',
        '<NtryDtls><TxDtls><AmtDtls><InstdAmt><Amt Ccy="EUR">5.00</Amt></InstdAmt></AmtDtls></TxDtls></NtryDtls>',
      ),
    );
    expect(poimiCamt(xml).tapahtumat[0]?.alkuperainen).toBeUndefined();
  });
});

describe('poimiCamt: erät', () => {
  const tiliote = poimiCamt(lataa('camt053-era.xml'));

  it('jakaa erän maksuiksi, joilla on omat summat', () => {
    expect(tiliote.tapahtumat.slice(0, 3)).toEqual([
      {
        pvm: '2026-10-08',
        nimi: 'Maija Malli',
        maara: e('100.00'),
        viite: '10016',
        arkistotunnus: '202610080001-1',
        iban: 'FI1522220000045675',
      },
      {
        pvm: '2026-10-08',
        nimi: 'Matti Meikäläinen',
        maara: e('120.00'),
        viite: '10029',
        arkistotunnus: '202610080001-2',
      },
      {
        pvm: '2026-10-08',
        nimi: 'Kaisa Kokeilu',
        maara: e('80.00'),
        viite: '10032',
        arkistotunnus: '202610080001-3',
      },
    ]);
  });

  it('erä ilman maksukohtaisia summia on yksi rivi "N maksua"', () => {
    expect(tiliote.tapahtumat).toHaveLength(4);
    expect(tiliote.tapahtumat[3]).toEqual({
      pvm: '2026-10-20',
      nimi: '2 maksua',
      maara: e('50.00'),
      arkistotunnus: '202610200003',
    });
  });

  it('saldot täsmäävät', () => {
    const summa = tiliote.tapahtumat.reduce((s, t) => s + t.maara, 0);
    expect((tiliote.alkusaldo ?? 0) + summa).toBe(tiliote.loppusaldo);
  });

  it('erätason alkuperäinen summa ei periydy puretuille maksuille', () => {
    const xml = lataa('camt053-era.xml').replace(
      '<AcctSvcrRef>202610080001</AcctSvcrRef>',
      '<AcctSvcrRef>202610080001</AcctSvcrRef><AmtDtls><InstdAmt><Amt Ccy="USD">330.00</Amt></InstdAmt></AmtDtls>',
    );
    expect(xml).toContain('USD');
    const rivit = poimiCamt(xml).tapahtumat.slice(0, 3);
    expect(rivit).toHaveLength(3);
    for (const r of rivit) expect(r.alkuperainen).toBeUndefined();
  });

  it('maksun oma InstdAmt säilyy puretulla rivillä', () => {
    const xml = lataa('camt053-era.xml').replace(
      '<Amt Ccy="EUR">100.00</Amt>',
      '<Amt Ccy="EUR">100.00</Amt><AmtDtls><InstdAmt><Amt Ccy="USD">110.00</Amt></InstdAmt></AmtDtls>',
    );
    const rivit = poimiCamt(xml).tapahtumat;
    expect(rivit[0]?.alkuperainen).toEqual({ valuutta: 'USD', maara: 11000 });
    expect(rivit[1]?.alkuperainen).toBeUndefined();
  });

  it('erätason InstdAmt säilyy purkamattomalla erärivillä', () => {
    const xml = lataa('camt053-era.xml').replace(
      '<AcctSvcrRef>202610200003</AcctSvcrRef>',
      '<AcctSvcrRef>202610200003</AcctSvcrRef><AmtDtls><InstdAmt><Amt Ccy="USD">55.00</Amt></InstdAmt></AmtDtls>',
    );
    expect(poimiCamt(xml).tapahtumat[3]?.alkuperainen).toEqual({ valuutta: 'USD', maara: 5500 });
  });

  it('maksujen summa, joka ei vastaa erän summaa → virhe', () => {
    const xml = lataa('camt053-era.xml').replace(
      '<Amt Ccy="EUR">80.00</Amt>',
      '<Amt Ccy="EUR">70.00</Amt>',
    );
    const v = virhe(() => poimiCamt(xml));
    expect(v.koodi).toBe('VAARA_MUOTO');
    expect(v.message).toMatch(/290,00/);
    expect(v.message).toMatch(/300,00/);
  });

  it('erä, jossa vain osalla maksuista on summa, on yksi rivi', () => {
    const xml = lataa('camt053-era.xml').replace(
      /<Amt Ccy="EUR">100\.00<\/Amt>\s*<CdtDbtInd>CRDT<\/CdtDbtInd>\s*<RltdPties>/,
      '<RltdPties>',
    );
    const t = poimiCamt(xml).tapahtumat;
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ nimi: '3 maksua', maara: e('300.00') });
  });
});

describe('poimiCamt: nimiavaruus ja versiot', () => {
  it('etuliitteellinen camt.053.001.02 antaa samat arvot kuin etuliitteetön .001.08', () => {
    expect(poimiCamt(lataa('camt053-etuliite-v02.xml'))).toEqual(
      poimiCamt(lataa('camt053-perus.xml')),
    );
  });
});

describe('poimiCamt: useita tiliotteita', () => {
  it('yhdistää kaksi Stmt-lohkoa yhdeksi kuukaudeksi', () => {
    const t = poimiCamt(lataa('camt053-kaksi-otetta.xml'));
    expect(t.kausi).toEqual({ alkaa: '2026-10-01', loppuu: '2026-10-31' });
    expect(t.alkusaldo).toBe(100000);
    expect(t.loppusaldo).toBe(105000);
    expect(t.muoto).toBe('kuukausitiliote');
    expect(t.lahde).toBe('camt053');
    expect(t.iban).toBe('FI7455550000012343');
    expect(t.tapahtumat.map((x) => [x.pvm, x.maara])).toEqual([
      ['2026-10-07', 10000],
      ['2026-10-20', -5000],
    ]);
  });

  it('saldoketjun katkeaminen → virhe', () => {
    const xml = lataa('camt053-kaksi-otetta.xml').replace(
      '<Amt Ccy="EUR">1100.00</Amt>\n        <CdtDbtInd>CRDT</CdtDbtInd>\n        <Dt>\n          <Dt>2026-10-16</Dt>',
      '<Amt Ccy="EUR">1111.00</Amt>\n        <CdtDbtInd>CRDT</CdtDbtInd>\n        <Dt>\n          <Dt>2026-10-16</Dt>',
    );
    expect(xml).not.toBe(lataa('camt053-kaksi-otetta.xml'));
    expect(virhe(() => poimiCamt(xml)).koodi).toBe('VAARA_MUOTO');
  });

  it('kaksi eri IBANia samassa tiedostossa → virhe', () => {
    const xml = lataa('camt053-kaksi-otetta.xml').replace(
      /(STMT-KAKSI-2[\s\S]*?<IBAN>)FI7455550000012343/,
      '$1FI1522220000045675',
    );
    expect(xml).toContain('FI1522220000045675');
    const v = virhe(() => poimiCamt(xml));
    expect(v.koodi).toBe('VAARA_MUOTO');
    expect(v.message).toMatch(/tili/i);
  });
});

describe('poimiCamt: camt.054', () => {
  const t = poimiCamt(lataa('camt054.xml'));

  it('lukee ilmoitukset tapahtumaluettelona', () => {
    expect(t.lahde).toBe('camt054');
    expect(t.muoto).toBe('tapahtumat');
    expect(t.iban).toBe('FI7455550000012343');
    expect(t.alkusaldo).toBeUndefined();
    expect(t.loppusaldo).toBeUndefined();
    expect(t.tapahtumat.map((x) => [x.pvm, x.nimi, x.maara, x.viite])).toEqual([
      ['2026-10-14', 'Maija Malli', 25000, '10016'],
      ['2026-10-09', 'Matti Meikäläinen', 8000, '10029'],
    ]);
  });

  it('päättelee kauden tapahtumien päivistä', () => {
    expect(t.kausiPaatelty).toBe(true);
    expect(t.kausi).toEqual({ alkaa: '2026-10-09', loppuu: '2026-10-14' });
  });

  it('päättelee kauden tapahtumista myös silloin, kun ilmoituksella on FrToDt ja saldot', () => {
    const xml = lataa('camt054.xml')
      .replace(
        '<Acct>',
        `<FrToDt><FrDtTm>2026-10-01T00:00:00+03:00</FrDtTm><ToDtTm>2026-10-31T23:59:59+03:00</ToDtTm></FrToDt>
      <Acct>`,
      )
      .replace(
        '<Ntry>',
        `<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-01</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">340.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-31</Dt></Dt></Bal>
      <Ntry>`,
      );
    expect(xml).toContain('<FrToDt>');
    const v = poimiCamt(xml);
    expect(v.kausiPaatelty).toBe(true);
    expect(v.kausi).toEqual({ alkaa: '2026-10-09', loppuu: '2026-10-14' });
    expect(v.muoto).toBe('tapahtumat');
  });
});

describe('poimiCamt: useita ilmoituksia ja tyhjiä otteita', () => {
  const ilmoitus = (ntryt: string) =>
    `<Ntfctn><Id>N</Id><Acct><Id><IBAN>FI7455550000012343</IBAN></Id><Ccy>EUR</Ccy></Acct>${ntryt}</Ntfctn>`;
  const ntry = (pvm: string, amt: string) =>
    `<Ntry><Amt Ccy="EUR">${amt}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${pvm}</Dt></BookgDt></Ntry>`;
  const camt054 = (...ilmoitukset: string[]) =>
    `<Document><BkToCstmrDbtCdtNtfctn>${ilmoitukset.join('')}</BkToCstmrDbtCdtNtfctn></Document>`;

  it('kaksi camt.054-ilmoitusta samalta päivältä yhdistetään', () => {
    const t = poimiCamt(
      camt054(ilmoitus(ntry('2026-10-05', '10.00')), ilmoitus(ntry('2026-10-05', '20.00'))),
    );
    expect(t.kausi).toEqual({ alkaa: '2026-10-05', loppuu: '2026-10-05' });
    expect(t.kausiPaatelty).toBe(true);
    expect(t.tapahtumat.map((x) => x.maara)).toEqual([1000, 2000]);
  });

  it('camt.054-ilmoitukset, joiden päätellyt kaudet menevät päällekkäin, yhdistetään', () => {
    const t = poimiCamt(
      camt054(
        ilmoitus(ntry('2026-10-05', '10.00') + ntry('2026-10-12', '20.00')),
        ilmoitus(ntry('2026-10-08', '30.00')),
      ),
    );
    expect(t.kausi).toEqual({ alkaa: '2026-10-05', loppuu: '2026-10-12' });
    expect(t.tapahtumat.map((x) => [x.pvm, x.maara])).toEqual([
      ['2026-10-05', 1000],
      ['2026-10-08', 3000],
      ['2026-10-12', 2000],
    ]);
  });

  it('camt.054-ilmoitus ilman kirjattuja tapahtumia ohitetaan', () => {
    const t = poimiCamt(camt054(ilmoitus(''), ilmoitus(ntry('2026-10-05', '10.00'))));
    expect(t.tapahtumat.map((x) => x.maara)).toEqual([1000]);
    expect(t.kausi).toEqual({ alkaa: '2026-10-05', loppuu: '2026-10-05' });
  });

  it('camt.053:n tyhjä lisä-Stmt (ei tapahtumia, kautta eikä päivättyjä saldoja) ohitetaan', () => {
    const tyhjaOte =
      '<Stmt><Id>2</Id><Acct><Id><IBAN>FI7455550000012343</IBAN></Id><Ccy>EUR</Ccy></Acct></Stmt>';
    const xml = lataa('camt053-perus.xml').replace(
      '</BkToCstmrStmt>',
      `${tyhjaOte}</BkToCstmrStmt>`,
    );
    expect(xml).toContain('<Id>2</Id>');
    const t = poimiCamt(xml);
    expect(t).toEqual(poimiCamt(lataa('camt053-perus.xml')));
  });
});

describe('poimiCamt: kausi ja saldot puutteellisessa tiedostossa', () => {
  const ilmanKautta = lataa('camt053-perus.xml').replace(/<FrToDt>[\s\S]*?<\/FrToDt>/, '');

  it('puuttuva FrToDt korvataan saldojen päivillä', () => {
    const t = poimiCamt(ilmanKautta);
    expect(t.kausi).toEqual({ alkaa: '2026-10-01', loppuu: '2026-10-31' });
    expect(t.kausiPaatelty).toBeUndefined();
    expect(t.muoto).toBe('kuukausitiliote');
  });

  it('ilman kautta ja saldopäiviä kausi päätellään tapahtumista', () => {
    const xml = ilmanKautta.replace(/<Dt>\s*<Dt>2026-10-(?:01|31)<\/Dt>\s*<\/Dt>/g, '');
    const t = poimiCamt(xml);
    expect(t.kausi).toEqual({ alkaa: '2026-10-05', loppuu: '2026-10-31' });
    expect(t.kausiPaatelty).toBe(true);
    expect(t.muoto).toBe('tapahtumat');
  });

  it('ToDtTm keskiyöllä on poissulkeva loppu: kauden viimeinen päivä on edellinen päivä', () => {
    for (const [fr, to] of [
      ['2026-10-01T00:00:00', '2026-11-01T00:00:00'],
      ['2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'],
      ['2026-10-01T00:00:00+02:00', '2026-11-01T00:00:00.000+02:00'],
    ]) {
      const t = poimiCamt(
        minimi(merkinta('1.00'), `<FrToDt><FrDtTm>${fr}</FrDtTm><ToDtTm>${to}</ToDtTm></FrToDt>`),
      );
      expect(t.kausi, to).toEqual({ alkaa: '2026-10-01', loppuu: '2026-10-31' });
    }
    const vuodenVaihde = poimiCamt(
      minimi(
        merkinta('1.00'),
        '<FrToDt><FrDtTm>2026-12-01T00:00:00</FrDtTm><ToDtTm>2027-01-01T00:00:00</ToDtTm></FrToDt>',
      ),
    );
    expect(vuodenVaihde.kausi).toEqual({ alkaa: '2026-12-01', loppuu: '2026-12-31' });
  });

  it('PRCD toimii alkusaldona, kun OPBD puuttuu', () => {
    const xml = lataa('camt053-perus.xml').replace('<Cd>OPBD</Cd>', '<Cd>PRCD</Cd>');
    expect(poimiCamt(xml).alkusaldo).toBe(100000);
  });

  it('veloitussaldo on negatiivinen', () => {
    const xml = lataa('camt053-perus.xml').replace(
      '<Amt Ccy="EUR">1000.00</Amt>\n        <CdtDbtInd>CRDT</CdtDbtInd>',
      '<Amt Ccy="EUR">1000.00</Amt>\n        <CdtDbtInd>DBIT</CdtDbtInd>',
    );
    expect(poimiCamt(xml).alkusaldo).toBe(-100000);
  });
});

describe('poimiCamt: rivin tiedot', () => {
  it('käänteiskirjaus säilytetään merkkeineen', () => {
    const xml = minimi(merkinta('7.00', 'DBIT').replace('<Sts>', '<RvslInd>true</RvslInd><Sts>'));
    expect(poimiCamt(xml).tapahtumat).toHaveLength(1);
    expect(poimiCamt(xml).tapahtumat[0]?.maara).toBe(-700);
  });

  it('arvopäivä korvaa puuttuvan kirjauspäivän', () => {
    const xml = minimi(
      '<Ntry><Amt Ccy="EUR">1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><ValDt><Dt>2026-10-06</Dt></ValDt></Ntry>',
    );
    expect(poimiCamt(xml).tapahtumat[0]?.pvm).toBe('2026-10-06');
  });

  it('päiväys ilman kirjaus- ja arvopäivää → virhe', () => {
    const xml = minimi(
      '<Ntry><Amt Ccy="EUR">1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts></Ntry>',
    );
    expect(virhe(() => poimiCamt(xml)).koodi).toBe('VAARA_MUOTO');
  });

  it('nimi: veloituksessa saaja, hyvityksessä maksaja, muuten selite ja pankin koodi', () => {
    const osapuolet =
      '<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Oma Oy</Nm></Dbtr><Cdtr><Nm>Saaja Oy</Nm></Cdtr></RltdPties></TxDtls></NtryDtls>';
    expect(poimiCamt(minimi(merkinta('1.00', 'DBIT', osapuolet))).tapahtumat[0]?.nimi).toBe(
      'Saaja Oy',
    );
    expect(poimiCamt(minimi(merkinta('1.00', 'CRDT', osapuolet))).tapahtumat[0]?.nimi).toBe(
      'Oma Oy',
    );
    expect(
      poimiCamt(minimi(merkinta('1.00', 'DBIT', '<AddtlNtryInf>  Korko\n  maksu </AddtlNtryInf>')))
        .tapahtumat[0]?.nimi,
    ).toBe('Korko maksu');
    expect(
      poimiCamt(
        minimi(merkinta('1.00', 'DBIT', '<BkTxCd><Prtry><Cd>NTRF+752</Cd></Prtry></BkTxCd>')),
      ).tapahtumat[0]?.nimi,
    ).toBe('NTRF+752');
  });

  it('tiliotteella ei ole kirjattuja rivejä → tyhjä tapahtumalista', () => {
    const t = poimiCamt(minimi(''));
    expect(t.tapahtumat).toEqual([]);
    expect(t.iban).toBe('FI7455550000012343');
  });
});

describe('poimiCamt: virheellinen tiedosto', () => {
  it('ei-camt-XML → VAARA_MUOTO', () => {
    expect(virhe(() => poimiCamt('<html><body>moi</body></html>')).koodi).toBe('VAARA_MUOTO');
  });

  it('rikkinäinen XML → VAARA_MUOTO', () => {
    expect(virhe(() => poimiCamt('<Document><BkToCstmrStmt>')).koodi).toBe('VAARA_MUOTO');
  });

  it('camt ilman tiliotteita → VAARA_MUOTO', () => {
    const xml = '<Document><BkToCstmrStmt><GrpHdr/></BkToCstmrStmt></Document>';
    expect(virhe(() => poimiCamt(xml)).koodi).toBe('VAARA_MUOTO');
  });
});
