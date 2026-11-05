import type { PalkkaAjo } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { type SyoteRivi, laskePalkka, taulukkoHaku } from '../laske.js';
import { PalkatVirhe } from '../taulukot.js';
import type { PalkatAsetukset, Tyontekija, Verokortti } from '../tyontekija.js';
import {
  type PalkkatietoilmoitusSyote,
  deliveryId,
  palkkatietoilmoitusXml,
  reportId,
} from './palkkatietoilmoitus.js';
import type { Maksaja } from './xml.js';
import { xsdVirheet } from './xsd.testapu.js';

/*
 * Kaikki henkilöt ja yritykset ovat keksittyjä; henkilötunnusten yksilönumerot 900-999.
 * Tapausten summat lasketaan `laskePalkka`lla vuoden 2026 taulukoista (samat syötteet kuin
 * laske.test.ts:n tapauksessa A, joten 604,00 / 220,46 / 26,88 on jo todistettu siellä).
 */

const c = (n: number) => n as Cents;
const TARKISTEMERKIT = '0123456789ABCDEFHJKLMNPRSTUVWXY';
function testiHetu(ppkkvv: string, merkki: string, yksilo: string): string {
  return `${ppkkvv}${merkki}${yksilo}${TARKISTEMERKIT[Number(`${ppkkvv}${yksilo}`) % 31]}`;
}

const HETU_A = testiHetu('010190', '-', '900'); // tarkiste on kirjain (P)
const HETU_B = testiHetu('150599', '-', '904');
const HETU_C = testiHetu('120380', '-', '905');
const HETU_D = testiHetu('230785', '-', '906');
const HETU_VANHA = testiHetu('150655', '-', '902'); // 71 v vuonna 2026: ei TyEL, TVR eikä sava

const MAKSUPAIVA = '2026-10-31';
const LASKETTU = '2026-10-28T09:15:30.123Z';

function kortti(perusBp: number): Verokortti {
  return {
    alkaa: '2026-01-01',
    paattyy: '2026-12-31',
    perusBp,
    lisaBp: 4000,
    tuloraja: c(3_000_000),
    aiemminMaksettu: c(0),
  };
}

function tyontekija(osat: Partial<Tyontekija> & Pick<Tyontekija, 'id' | 'hetu'>): Tyontekija {
  return {
    nimi: 'Testi Henkilö',
    vakuutusperuste: 'tyontekija',
    palkkamuoto: 'kuukausi',
    puhelinetu: false,
    verokortit: [kortti(2000)],
    aktiivinen: true,
    ...osat,
  };
}

const ASETUKSET: PalkatAsetukset = {
  tilapainenTyonantaja: false,
  tvrVapautus: false,
  tyelYhtio: '46',
  tyelSopimus: '4612345678',
};

const MAKSAJA: Maksaja = {
  ytunnus: '1234567-1',
  nimi: 'Keksitty Oy',
  yhteyshenkilo: { nimi: 'Keksi Yhteyshenkilö', puhelin: '040 000 0000' },
};

// Rekisterissä hetu voi olla välilyöntien ja pienten kirjainten kanssa: XML:ään normalisoitu muoto.
const A = tyontekija({ id: 'a1', hetu: ` ${HETU_A.toLowerCase()} `, ammattikoodi: '25121' });
const B = tyontekija({
  id: 'b2',
  hetu: HETU_B,
  palkkamuoto: 'tunti',
  ammattikoodi: '91120',
  verokortit: [kortti(1000)],
});
const C = tyontekija({
  id: 'c3',
  hetu: HETU_C,
  vakuutusperuste: 'yel',
  verokortit: [kortti(2500)],
});
const D = tyontekija({
  id: 'd4',
  hetu: HETU_D,
  vakuutusperuste: 'osaomistaja',
  ammattikoodi: '11201',
  verokortit: [kortti(1500)],
});

function henkilo(t: Tyontekija, rivit: SyoteRivi[], asetukset = ASETUKSET) {
  return laskePalkka(
    {
      tyontekija: t,
      maksupaiva: MAKSUPAIVA,
      kausiAlkaa: '2026-10-01',
      kausiLoppuu: MAKSUPAIVA,
      rivit,
    },
    { taulukko: taulukkoHaku(), asetukset, aiempiKertyma: c(0) },
  );
}

const kk = (summa: number): SyoteRivi => ({
  laji: 'kuukausipalkka',
  selite: 'Palkka',
  summa: c(summa),
});

function ajo(henkilot: PalkkaAjo['henkilot']): PalkkaAjo {
  return {
    versio: 1,
    kausiAlkaa: '2026-10-01',
    kausiLoppuu: MAKSUPAIVA,
    laskettu: LASKETTU,
    henkilot,
  };
}

const AJO_AD = ajo([
  henkilo(A, [
    kk(300_000),
    { laji: 'puhelinetu', selite: 'Puhelinetu' },
    { laji: 'km', selite: 'Asiakaskäynti', maara: 10_000 },
  ]),
  henkilo(B, [
    { laji: 'tuntipalkka', selite: 'Tunnit', maara: 8000, ahinta: c(1500) },
    { laji: 'lisa', selite: 'Iltalisä', summa: c(5000) },
    { laji: 'ravintoetu', selite: 'Lounasedut', maara: 1000, ahinta: c(900) },
    { laji: 'kokopaivaraha', selite: 'Tampere', maara: 100 },
    { laji: 'osapaivaraha', selite: 'Lahti', maara: 100 },
    { laji: 'ateriakorvaus', selite: 'Kurssipäivä', maara: 100 },
    { laji: 'kulukorvaus', selite: 'Postimerkit', summa: c(1290), tili: 7680 },
  ]),
  henkilo(C, [kk(400_000)]),
  henkilo(D, [kk(250_000)]),
]);

function syote(osat: Partial<PalkkatietoilmoitusSyote> = {}): PalkkatietoilmoitusSyote {
  return {
    tositeId: 4321,
    maksupaiva: MAKSUPAIVA,
    ajo: AJO_AD,
    maksaja: MAKSAJA,
    tyontekijat: new Map([A, B, C, D].map((t) => [t.id, t])),
    asetukset: ASETUKSET,
    tuotanto: false,
    ...osat,
  };
}

// --- Pieni XML-lukija testeihin (tuotettu XML on ennustettavaa: ei attribuutteja lapsilla) ---

const lohkot = (xml: string, nimi: string) =>
  [...xml.matchAll(new RegExp(`<${nimi}>([\\s\\S]*?)</${nimi}>`, 'g'))].map((m) => m[1] as string);
const arvo = (xml: string, nimi: string) => new RegExp(`<${nimi}>([^<]*)</${nimi}>`).exec(xml)?.[1];
const arvot = (xml: string, nimi: string) =>
  [...xml.matchAll(new RegExp(`<${nimi}>([^<]*)</${nimi}>`, 'g'))].map((m) => m[1]);

/** Raportin tulolajit: koodi -> { maara, lohko }. */
function transaktiot(raportti: string) {
  const t = new Map<string, { maara: string | undefined; lohko: string }>();
  for (const l of lohkot(raportti, 'Transaction')) {
    t.set(arvo(l, 'TransactionCode') as string, { maara: arvo(l, 'Amount'), lohko: l });
  }
  return t;
}

const raportit = (xml: string) => lohkot(xml, 'Report');

describe('palkkatietoilmoitusXml', () => {
  it('palkkatietoilmoitus validoituu 2025 ja 2027 XSD:tä vasten', async () => {
    const xml = palkkatietoilmoitusXml(syote());
    expect(raportit(xml)).toHaveLength(4);
    expect(await xsdVirheet(xml, '2025', 'WageReportsToIR.xsd')).toEqual([]);
    expect(await xsdVirheet(xml, '2027', 'WageReportsToIR.xsd')).toEqual([]);
    // Validointi ei ole tyhjä: pakollisen elementin puuttuminen havaitaan.
    const rikki = xml.replace('<FaultyControl>2</FaultyControl>', '');
    expect(await xsdVirheet(rikki, '2027', 'WageReportsToIR.xsd')).not.toEqual([]);
  }, 60_000);

  it('tietuetiedot: aikaleima, tunnisteet, maksukausi, yhteyshenkilö; ei allekirjoitusta', () => {
    const xml = palkkatietoilmoitusXml(syote());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml.charCodeAt(0)).not.toBe(0xfeff);
    const dd = lohkot(xml, 'DeliveryData')[0] as string;
    expect(arvo(dd, 'Timestamp')).toBe(LASKETTU);
    expect(arvo(dd, 'Source')).toBe('Penni');
    expect(arvo(dd, 'DeliveryDataType')).toBe('100');
    expect(arvo(dd, 'DeliveryId')).toBe('P4321-20261028091530123');
    expect(arvo(dd, 'FaultyControl')).toBe('2');
    expect(arvo(dd, 'ProductionEnvironment')).toBe('false');
    for (const osa of ['DeliveryDataOwner', 'DeliveryDataCreator', 'DeliveryDataSender']) {
      const id = lohkot(dd, osa)[0] as string;
      expect([arvo(id, 'Type'), arvo(id, 'Code')]).toEqual(['1', '1234567-1']);
    }
    const kausi = lohkot(dd, 'PaymentPeriod')[0] as string;
    expect([arvo(kausi, 'PaymentDate'), arvo(kausi, 'StartDate'), arvo(kausi, 'EndDate')]).toEqual([
      '2026-10-31',
      '2026-10-01',
      '2026-10-31',
    ]);
    expect(arvo(dd, 'Name')).toBe('Keksi Yhteyshenkilö');
    expect(arvo(dd, 'Telephone')).toBe('040 000 0000');
    expect(xml).not.toContain('Signature');
    expect(arvo(palkkatietoilmoitusXml(syote({ tuotanto: true })), 'ProductionEnvironment')).toBe(
      'true',
    );
  });

  it('transaktiot: tapaus A', () => {
    const [a] = raportit(palkkatietoilmoitusXml(syote()));
    const t = transaktiot(a as string);
    expect([...t.keys()]).toEqual(['201', '311', '330', '402', '413', '414']);
    expect(t.get('201')?.maara).toBe('3000.00');
    expect(t.get('311')?.maara).toBe('55.00');
    expect(arvo(t.get('311')?.lohko as string, 'Kilometers')).toBe('100');
    expect(t.get('330')?.maara).toBe('20.00');
    expect(t.get('402')?.maara).toBe('604.00');
    expect(t.get('413')?.maara).toBe('220.46');
    expect(t.get('414')?.maara).toBe('26.88');
    // TyEL-vakuutus, ammattiluokka (tapaturmavakuutettu), ei vakuuttamispoikkeuksia.
    const eläke = lohkot(a as string, 'PensionInsurance')[0] as string;
    expect([
      arvo(eläke, 'PensionActCode'),
      arvo(eläke, 'PensionProvIdCode'),
      arvo(eläke, 'PensionPolicyNo'),
    ]).toEqual(['1', '46', '4612345678']);
    const ammatti = lohkot(a as string, 'Profession')[0] as string;
    expect([arvo(ammatti, 'Type'), arvo(ammatti, 'Code')]).toEqual(['1', '25121']);
    expect(a).not.toContain('InsuranceExceptions');
    expect(a).not.toContain('IncomeEarnerOther');
    expect(arvo(lohkot(a as string, 'ReportData')[0] as string, 'ActionCode')).toBe('1');
    expect(arvo(a as string, 'ReportId')).toBe('4321-a1');
  });

  it('henkilötunnus normalisoidaan (trim + isot kirjaimet)', () => {
    const [a] = raportit(palkkatietoilmoitusXml(syote()));
    const id = lohkot(a as string, 'IncomeEarnerIds')[0] as string;
    expect([arvo(id, 'Type'), arvo(id, 'Code')]).toEqual(['2', HETU_A]);
    expect(HETU_A).toMatch(/[A-Z]$/);
  });

  it('transaktiot: tapaus B (tuntipalkka, lisä, ravintoetu, päivärahat; kulukorvausta ei ilmoiteta)', () => {
    const b = raportit(palkkatietoilmoitusXml(syote()))[1] as string;
    const t = transaktiot(b);
    expect([...t.keys()]).toEqual(['201', '216', '303', '331', '334', '402', '413', '414']);
    expect(t.get('201')?.maara).toBe('1200.00'); // 80 h × 15,00
    expect(t.get('216')?.maara).toBe('50.00');
    expect(t.get('334')?.maara).toBe('88.00'); // 10 × 8,80
    expect(t.get('334')?.lohko).not.toContain('MealBenefit');
    // Päivärahat yhtenä 331:nä, lajit 2 (osa) ja 3 (koko); ateriakorvaus omana 303:na.
    expect(arvot(t.get('331')?.lohko as string, 'AllowanceCode')).toEqual(['2', '3']);
    expect(Number(t.get('331')?.maara)).toBeGreaterThan(0);
    expect(Number(t.get('303')?.maara)).toBeGreaterThan(0);
    expect(b).not.toContain('12.90');
  });

  it('transaktiot: tapaus C (YEL-yrittäjä)', () => {
    const cr = raportit(palkkatietoilmoitusXml(syote()))[2] as string;
    const t = transaktiot(cr);
    expect([...t.keys()]).toEqual(['201', '402']);
    const eläke = lohkot(cr, 'PensionInsurance')[0] as string;
    expect(arvo(eläke, 'PensionActCode')).toBe('3');
    expect(eläke).not.toContain('PensionProvIdCode');
    expect(eläke).not.toContain('PensionPolicyNo');
    expect(arvot(cr, 'ExceptionCode')).toEqual(['3', '4', '5']);
    expect(cr).not.toContain('Professions');
  });

  it('transaktiot: tapaus D (osaomistaja)', () => {
    const d = raportit(palkkatietoilmoitusXml(syote()))[3] as string;
    expect(arvot(d, 'IncomeEarnerType')).toEqual(['3']);
    const t = transaktiot(d);
    expect([...t.keys()]).toEqual(['201', '402', '413', '414']);
    expect(arvo(lohkot(d, 'PensionInsurance')[0] as string, 'PensionActCode')).toBe('1');
    expect(d).not.toContain('InsuranceExceptions');
  });

  it('deterministinen: sama syöte kahdesti -> sama merkkijono', () => {
    expect(palkkatietoilmoitusXml(syote())).toBe(palkkatietoilmoitusXml(syote()));
  });

  it('hetu ei vuoda: deliveryId ja reportId eivät sisällä henkilötunnusta', () => {
    expect(deliveryId(4321, LASKETTU)).toBe('P4321-20261028091530123');
    expect(reportId(4321, 'a1')).toBe('4321-a1');
    const xml = palkkatietoilmoitusXml(syote());
    for (const ref of [arvo(xml, 'DeliveryId'), ...arvot(xml, 'ReportId')]) {
      for (const h of [HETU_A, HETU_B, HETU_C, HETU_D]) {
        expect(ref).not.toContain(h);
        expect(ref).not.toContain(h.slice(0, 6));
      }
    }
  });

  it('ikäperusteinen vakuuttamattomuus: poikkeuskoodit 2, 3 ja 5, ei eläkevakuutusta', async () => {
    const vanha = tyontekija({ id: 'v5', hetu: HETU_VANHA, ammattikoodi: '25121' });
    const h = henkilo(vanha, [kk(100_000)]);
    expect(h.prosentit).toMatchObject({ tyelKokonaisBp: 0, tvrTyontekijaBp: 0, savaBp: 0 });
    const xml = palkkatietoilmoitusXml(
      syote({ ajo: ajo([h]), tyontekijat: new Map([[vanha.id, vanha]]) }),
    );
    const [r] = raportit(xml);
    expect(r).not.toContain('PensionInsurance');
    expect(arvot(r as string, 'ExceptionCode')).toEqual(['2', '3', '5']);
    expect(r).toContain('<Professions>'); // tapaturmavakuutus koskee iästä riippumatta
    expect([...transaktiot(r as string).keys()]).toEqual(['201', '402']);
    expect(await xsdVirheet(xml, '2027', 'WageReportsToIR.xsd')).toEqual([]);
  }, 60_000);

  it('pelkät verovapaat korvaukset: ei eläkevakuutusta eikä ammattiluokkaa vaadita', () => {
    const ilman = tyontekija({ id: 'k6', hetu: HETU_B });
    const h = henkilo(ilman, [{ laji: 'km', selite: 'Matka', maara: 2550 }]);
    const r = raportit(
      palkkatietoilmoitusXml(syote({ ajo: ajo([h]), tyontekijat: new Map([[ilman.id, ilman]]) })),
    )[0] as string;
    expect([...transaktiot(r).keys()]).toEqual(['311']);
    expect(arvo(r, 'Kilometers')).toBe('26'); // 25,5 km pyöristetään puolikkaat ylös
    expect(r).not.toContain('PensionInsurance');
    expect(r).not.toContain('Professions');
  });

  it('tapaturmavakuutuksen tiedot, kun asetuksissa on yhtiö ja vakuutusnumero', async () => {
    const asetukset = { ...ASETUKSET, tapaturmaYhtio: '7654321-2', tapaturmaSopimus: 'TA-123456' };
    const xml = palkkatietoilmoitusXml(syote({ asetukset }));
    const a = raportit(xml)[0] as string;
    const tapaturma = lohkot(a, 'AccidentInsurance')[0] as string;
    expect([
      arvo(tapaturma, 'Type'),
      arvo(tapaturma, 'Code'),
      arvo(tapaturma, 'AccInsPolicyNo'),
    ]).toEqual(['1', '7654321-2', 'TA-123456']);
    expect(raportit(xml)[2]).not.toContain('AccidentInsurance'); // YEL: ei tapaturmavakuutusta
    expect(await xsdVirheet(xml, '2025', 'WageReportsToIR.xsd')).toEqual([]);
  }, 60_000);

  it('tilapäinen työnantaja: nimi, osoite ja maksajatyyppi 3; validoituu 2025 ja 2027', async () => {
    const asetukset = { ...ASETUKSET, tilapainenTyonantaja: true };
    const maksaja: Maksaja = {
      ...MAKSAJA,
      osoite: { katu: 'Keksitie 1 A 2', postinumero: '02100', kaupunki: 'Espoo' },
    };
    const xml = palkkatietoilmoitusXml(syote({ asetukset, maksaja }));
    const payer = lohkot(xml, 'Payer')[0] as string;
    expect(arvo(payer, 'CompanyName')).toBe('Keksitty Oy');
    const osoite = lohkot(payer, 'Address')[0] as string;
    expect([
      arvo(osoite, 'Street'),
      arvo(osoite, 'PostalCode'),
      arvo(osoite, 'PostOffice'),
      arvo(osoite, 'CountryCode'),
    ]).toEqual(['Keksitie 1 A 2', '02100', 'Espoo', 'FI']);
    expect(arvo(lohkot(payer, 'PayerTypes')[0] as string, 'Code')).toBe('3');
    expect(await xsdVirheet(xml, '2025', 'WageReportsToIR.xsd')).toEqual([]);
    expect(await xsdVirheet(xml, '2027', 'WageReportsToIR.xsd')).toEqual([]);
    // Tavallinen työnantaja: vain Y-tunnus, osoite jätetään pois vaikka se on annettu.
    const tavallinen = lohkot(palkkatietoilmoitusXml(syote({ maksaja })), 'Payer')[0] as string;
    expect(tavallinen).not.toContain('Address');
    expect(tavallinen).not.toContain('PayerOther');
  }, 60_000);

  it('erikoismerkit escapataan', () => {
    const xml = palkkatietoilmoitusXml(
      syote({ maksaja: { ...MAKSAJA, yhteyshenkilo: { nimi: 'Matti & <Maija>', puhelin: '1' } } }),
    );
    expect(xml).toContain('<Name>Matti &amp; &lt;Maija&gt;</Name>');
  });

  describe('virheet (PalkatVirhe SYOTE, ei henkilötietoja viestissä)', () => {
    function virhe(f: () => unknown): PalkatVirhe {
      try {
        f();
      } catch (e) {
        expect(e).toBeInstanceOf(PalkatVirhe);
        expect((e as PalkatVirhe).koodi).toBe('SYOTE');
        for (const h of [HETU_A, HETU_B, HETU_C, HETU_D, 'Testi Henkilö']) {
          expect((e as Error).message).not.toContain(h);
        }
        return e as PalkatVirhe;
      }
      throw new Error('odotettiin virhettä');
    }

    it('henkilö puuttuu rekisteristä -> indeksi viestissä', () => {
      const tyontekijat = new Map([A, C, D].map((t) => [t.id, t]));
      expect(virhe(() => palkkatietoilmoitusXml(syote({ tyontekijat }))).message).toContain(
        'henkilö 2',
      );
    });

    it('ammattiluokka puuttuu tapaturmavakuutetulta', () => {
      const tyontekijat = new Map(
        [{ ...A, ammattikoodi: undefined } as Tyontekija, B, C, D].map((t) => [t.id, t]),
      );
      const e = virhe(() => palkkatietoilmoitusXml(syote({ tyontekijat })));
      expect(e.message).toContain('henkilö 1');
      expect(e.message).toContain('ammattiluokka');
    });

    it('virheellinen ammattiluokka', () => {
      const tyontekijat = new Map([{ ...A, ammattikoodi: '2512' }, B, C, D].map((t) => [t.id, t]));
      expect(virhe(() => palkkatietoilmoitusXml(syote({ tyontekijat }))).message).toContain(
        'henkilö 1',
      );
    });

    it('TyEL-tiedot puuttuvat asetuksista', () => {
      const asetukset: PalkatAsetukset = { tilapainenTyonantaja: false, tvrVapautus: false };
      expect(virhe(() => palkkatietoilmoitusXml(syote({ asetukset }))).message).toContain('TyEL');
    });

    it('TyEL-vakuutusnumero ei ala eläkelaitoksen tunnuksella', () => {
      const asetukset = { ...ASETUKSET, tyelSopimus: '5412345678' };
      expect(virhe(() => palkkatietoilmoitusXml(syote({ asetukset }))).message).toContain('TyEL');
    });

    it('tilapäinen työnantaja ilman osoitetta', () => {
      const asetukset = { ...ASETUKSET, tilapainenTyonantaja: true };
      const e = virhe(() => palkkatietoilmoitusXml(syote({ asetukset })));
      expect(e.message).toContain('Tilapäisen työnantajan');
      expect(e.message).toContain('osoite');
      const vajaa = {
        ...MAKSAJA,
        osoite: { katu: 'Keksitie 1', postinumero: ' ', kaupunki: 'Espoo' },
      };
      virhe(() => palkkatietoilmoitusXml(syote({ asetukset, maksaja: vajaa })));
    });

    it('virheellinen Y-tunnus, aikaleima tai kielletty merkkijono', () => {
      virhe(() => palkkatietoilmoitusXml(syote({ maksaja: { ...MAKSAJA, ytunnus: '1234567-2' } })));
      virhe(() => palkkatietoilmoitusXml(syote({ ajo: { ...AJO_AD, laskettu: '2026-10-28' } })));
      virhe(() =>
        palkkatietoilmoitusXml(
          syote({ maksaja: { ...MAKSAJA, yhteyshenkilo: { nimi: 'A -- B', puhelin: '1' } } }),
        ),
      );
      virhe(() =>
        palkkatietoilmoitusXml(
          syote({ maksaja: { ...MAKSAJA, yhteyshenkilo: { nimi: ' ', puhelin: '1' } } }),
        ),
      );
    });

    it('sama henkilö kahdesti tai kelvoton ReportId', () => {
      virhe(() =>
        palkkatietoilmoitusXml(
          syote({
            ajo: { ...AJO_AD, henkilot: [...AJO_AD.henkilot, AJO_AD.henkilot[0] as never] },
          }),
        ),
      );
      const pitka = { ...A, id: 'x'.repeat(40) };
      const h = {
        ...(AJO_AD.henkilot[0] as PalkkaAjo['henkilot'][number]),
        tyontekijaId: pitka.id,
      };
      virhe(() =>
        palkkatietoilmoitusXml(syote({ ajo: ajo([h]), tyontekijat: new Map([[pitka.id, pitka]]) })),
      );
    });
  });
});
