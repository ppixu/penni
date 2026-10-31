import {
  AlvKoodi,
  type Asetukset,
  type Kumppani,
  Maksutapa,
  type StoredTosite,
  type TositeRivi,
  TositeTyyppi,
  generoiLaskunViennit,
  laskuSummat,
} from '@penni/engine';
import { type Cents, muotoileEuro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { laskuMalli } from './laskuMalli.js';

const RIVIT: TositeRivi[] = [
  {
    myyntiKpl: 1,
    aNetto: 100,
    alvKoodi: AlvKoodi.MYYNNIT_NETTO,
    alvProsentti: 25.5,
    selite: 'Konsultointi',
  },
  {
    myyntiKpl: 2,
    aNetto: 50,
    alvKoodi: AlvKoodi.MYYNNIT_NETTO,
    alvProsentti: 14,
    selite: 'Tarvikkeet',
  },
  { myyntiKpl: 1, aNetto: 10, alvKoodi: 0, alvProsentti: 0, selite: 'Veroton erä' },
];

const ASETUKSET: Asetukset = {
  Nimi: 'Demo Oy',
  Ytunnus: '1234567-8',
  Osoite: 'Demokatu 1',
  Postinumero: '00100',
  Kaupunki: 'Helsinki',
  AlvVelvollinen: 'true',
  LaskuIban: 'FI2112345600000785',
  Kotipaikka: 'Helsinki',
  Puhelin: '040 123 4567',
  Email: 'laskut@demo.fi',
};

const KUMPPANIT: Kumppani[] = [
  {
    id: 7,
    nimi: 'Asiakas Oy',
    osoite: 'Asiakkaankatu 2',
    postinumero: '00200',
    kaupunki: 'Espoo',
    alvtunnus: 'FI87654321',
  },
];

function lasku(osa: Partial<StoredTosite> = {}): StoredTosite {
  return {
    id: 1,
    pvm: '2026-06-01',
    tyyppi: TositeTyyppi.MYYNTILASKU,
    tila: 100,
    tunniste: 1,
    sarja: 'M',
    otsikko: 'Kesäkuun työt',
    kumppani: 7,
    viite: '1000193',
    laskupvm: '2026-06-01',
    erapvm: '2026-06-15',
    numero: '1',
    viennit: [],
    rivit: RIVIT,
    ...osa,
  };
}

const malli = (osa: Partial<StoredTosite> = {}, asetukset: Asetukset = ASETUKSET) =>
  laskuMalli({ tosite: lasku(osa), kumppanit: KUMPPANIT, asetukset });

describe('laskuMalli', () => {
  it('summat vastaavat laskuSummat-arvoja ja kirjattua saamista', () => {
    const m = malli();
    const s = laskuSummat(RIVIT);
    expect(m.summat).toEqual([
      { nimike: 'Yhteensä veroton', arvo: muotoileEuro(s.netto) },
      { nimike: 'Alv 25,5 %', arvo: muotoileEuro(s.erittely[0]?.vero ?? (0 as Cents)) },
      { nimike: 'Alv 14 %', arvo: muotoileEuro(s.erittely[1]?.vero ?? (0 as Cents)) },
      { nimike: 'Verollinen yhteensä', arvo: muotoileEuro(s.brutto), vahva: true },
    ]);
    expect(m.summat[0]?.arvo).toBe(muotoileEuro(21000 as Cents));
    expect(m.summat[3]?.arvo).toBe(muotoileEuro(24950 as Cents));
    const viennit = generoiLaskunViennit({
      rivit: RIVIT,
      maksutapa: Maksutapa.LASKU,
      pvm: '2026-06-01',
      tilit: {
        saatava: 1701,
        kateinen: 1910,
        kortti: 1920,
        oletusMyynti: 3000,
        alvVelka: 2939,
        kohdentamatonAlvVelka: 2941,
      },
    });
    expect(viennit[0]?.debet).toBe(s.brutto);
  });

  it('rivit muotoillaan kuten HTML-näkymässä', () => {
    const m = malli();
    expect(m.rivit).toEqual([
      {
        selite: 'Konsultointi',
        maara: '1',
        aHinta: muotoileEuro(10000 as Cents),
        alv: '25,5 %',
        yhteensa: muotoileEuro(12550 as Cents),
      },
      {
        selite: 'Tarvikkeet',
        maara: '2',
        aHinta: muotoileEuro(5000 as Cents),
        alv: '14 %',
        yhteensa: muotoileEuro(11400 as Cents),
      },
      {
        selite: 'Veroton erä',
        maara: '1',
        aHinta: muotoileEuro(1000 as Cents),
        alv: '—',
        yhteensa: muotoileEuro(1000 as Cents),
      },
    ]);
  });

  it('perustiedot: laji, otsikko, numero, osapuolet, aihe, tiedostonimi', () => {
    const m = malli();
    expect(m.laji).toBe('lasku');
    expect(m.otsikko).toBe('Lasku');
    expect(m.numero).toBe('1');
    expect(m.laskupvmIso).toBe('2026-06-01');
    expect(m.myyja).toEqual(['Demo Oy', 'Demokatu 1', '00100 Helsinki']);
    expect(m.ostaja).toEqual(['Asiakas Oy', 'Asiakkaankatu 2', '00200 Espoo']);
    expect(m.aihe).toBe('Kesäkuun työt');
    expect(m.tiedostonimi).toBe('Lasku-1.pdf');
  });

  it('info-rivit järjestyksessä, tyhjiä arvoja ei ole, maksuehto laskettu päivistä', () => {
    const m = malli();
    expect(m.info.some((r) => r.arvo === '')).toBe(false);
    expect(m.info).toEqual([
      { nimike: 'Laskun numero', arvo: '1' },
      { nimike: 'Laskupäivä', arvo: '1.6.2026' },
      { nimike: 'Eräpäivä', arvo: '15.6.2026' },
      { nimike: 'Maksuehto', arvo: '14 pv netto' },
      { nimike: 'Viitenumero', arvo: '10 00193' },
      { nimike: 'Asiakkaan Y-tunnus', arvo: '8765432-1' },
      { nimike: 'Viivästyskorko', arvo: 'korkolain mukaan' },
      { nimike: 'Huomautusaika', arvo: '8 pv' },
    ]);
  });

  it('Maksuehto on Heti kun eräpäivä on laskupäivä; Huomautusaika asetuksesta', () => {
    const m = malli({ erapvm: '2026-06-01' }, { ...ASETUKSET, LaskuHuomautusaika: '14' });
    expect(m.info.find((r) => r.nimike === 'Maksuehto')?.arvo).toBe('Heti');
    expect(m.info.find((r) => r.nimike === 'Huomautusaika')?.arvo).toBe('14 pv');
  });

  it('Y-tunnus jää pois kun alvtunnus ei ole suomalainen', () => {
    const m = laskuMalli({
      tosite: lasku(),
      kumppanit: [{ id: 7, nimi: 'Svensk AB', alvtunnus: 'SE556677889901' }],
      asetukset: ASETUKSET,
    });
    expect(m.info.some((r) => r.nimike === 'Asiakkaan Y-tunnus')).toBe(false);
  });

  it('määrä muotoillaan desimaalipilkulla ja hyvityksen miinus on U+2212', () => {
    const m = malli({
      rivit: [{ myyntiKpl: 1.5, aNetto: 10, alvKoodi: 0, alvProsentti: 0, selite: 'X' }],
    });
    expect(m.rivit[0]?.maara).toBe('1,5');
    const hyvitys = laskuMalli({
      tosite: lasku({
        id: 2,
        tyyppi: TositeTyyppi.HYVITYSLASKU,
        numero: '6',
        alkuperainenTosite: 1,
        rivit: undefined,
      }),
      kumppanit: KUMPPANIT,
      asetukset: ASETUKSET,
      alkuperainen: lasku({
        rivit: [{ myyntiKpl: 1.5, aNetto: 10, alvKoodi: 0, alvProsentti: 0, selite: 'X' }],
      }),
    });
    expect(hyvitys.rivit[0]?.maara).toBe('\u22121,5');
  });

  it('RF-viite → versio 5 -viivakoodi', () => {
    const m = malli({ viite: 'RF18 1000193' });
    expect(m.maksu?.virtuaaliviivakoodi).toMatch(/^5\d{53}$/);
    expect(m.maksu?.virtuaaliviivakoodi.slice(1, 17)).toBe('2112345600000785');
  });

  it('maksuosa: IBAN, BIC, viite, summa, viivakoodi ja QR', () => {
    const m = malli();
    expect(m.maksu).not.toBeNull();
    expect(m.maksu?.saaja).toBe('Demo Oy');
    expect(m.maksu?.iban).toBe('FI21 1234 5600 0007 85');
    expect(m.maksu?.bic).toBe('NDEAFIHH');
    expect(m.maksu?.viite).toBe('10 00193');
    expect(m.maksu?.erapvm).toBe('15.6.2026');
    expect(m.maksu?.summa).toBe(muotoileEuro(24950 as Cents));
    expect(m.maksu?.virtuaaliviivakoodi).toMatch(/^4\d{53}$/);
    expect(m.maksu?.qr.startsWith('BCD\n')).toBe(true);
  });

  it('maksuosaa ei ole ilman eräpäivää, IBANia tai positiivista summaa', () => {
    expect(malli({ erapvm: '' }).maksu).toBeNull();
    expect(malli({ erapvm: undefined }).maksu).toBeNull();
    const { LaskuIban: _pois, ...ilmanIbania } = ASETUKSET;
    expect(malli({}, ilmanIbania).maksu).toBeNull();
    expect(malli({ rivit: [] }).maksu).toBeNull();
  });

  it('hyvityslasku: negatiiviset rivit, ei maksuosaa, Hyvitettävä lasku -rivi', () => {
    const alkuperainen = lasku({ id: 1, numero: '5', laskupvm: '2026-05-20' });
    const m = laskuMalli({
      tosite: lasku({
        id: 2,
        tyyppi: TositeTyyppi.HYVITYSLASKU,
        numero: '6',
        alkuperainenTosite: 1,
        rivit: undefined,
      }),
      kumppanit: KUMPPANIT,
      asetukset: ASETUKSET,
      alkuperainen,
    });
    expect(m.laji).toBe('hyvityslasku');
    expect(m.otsikko).toBe('Hyvityslasku');
    expect(m.maksu).toBeNull();
    expect(m.rivit[0]?.maara).toBe('\u22121');
    expect(m.rivit[0]?.yhteensa.startsWith('−')).toBe(true);
    expect(m.summat.at(-1)?.arvo.startsWith('−')).toBe(true);
    expect(m.info.find((r) => r.nimike === 'Hyvitettävä lasku')?.arvo).toBe('5 (20.5.2026)');
    for (const poissa of ['Eräpäivä', 'Maksuehto', 'Viivästyskorko', 'Huomautusaika']) {
      expect(m.info.some((r) => r.nimike === poissa)).toBe(false);
    }
    expect(m.tiedostonimi).toBe('Hyvityslasku-6.pdf');
    expect(m.pdfEste).toBeNull();
  });

  it('kuitti: vain numero ja päivä, ei maksuosaa, PDF sallittu ilman IBANia', () => {
    const { LaskuIban: _pois, ...ilmanIbania } = ASETUKSET;
    const m = laskuMalli({
      tosite: lasku({ maksutapa: Maksutapa.KATEINEN, erapvm: undefined, viite: undefined }),
      kumppanit: KUMPPANIT,
      asetukset: ilmanIbania,
    });
    expect(m.laji).toBe('kuitti');
    expect(m.otsikko).toBe('Kuitti');
    expect(m.maksu).toBeNull();
    expect(m.info.map((r) => r.nimike)).toEqual(['Laskun numero', 'Laskupäivä']);
    expect(m.pdfEste).toBeNull();
    expect(m.tiedostonimi).toBe('Kuitti-1.pdf');
  });

  describe('pdfEste', () => {
    const { LaskuIban: _pois, ...ilmanIbania } = ASETUKSET;

    it('null kun kaikki on kunnossa', () => {
      expect(malli().pdfEste).toBeNull();
    });

    it('ei rivejä', () => {
      expect(malli({ rivit: [] }).pdfEste).toBe(
        'Laskulla ei ole rivejä — alkuperäinen lasku on liitteenä',
      );
    });

    it('lasku ilman numeroa', () => {
      const m = malli({ numero: undefined });
      expect(m.pdfEste).toBe('Laskulla ei ole numeroa');
      expect(m.numero).toBeNull();
      expect(m.info[0]).toEqual({ nimike: 'Laskun numero', arvo: '—' });
    });

    it('kuitti ilman numeroa', () => {
      expect(malli({ maksutapa: Maksutapa.KATEINEN, numero: undefined }).pdfEste).toBe(
        'Laskulla ei ole numeroa',
      );
    });

    it('hyvityslasku ilman numeroa', () => {
      const m = laskuMalli({
        tosite: lasku({ tyyppi: TositeTyyppi.HYVITYSLASKU, numero: undefined, rivit: undefined }),
        kumppanit: KUMPPANIT,
        asetukset: ASETUKSET,
        alkuperainen: lasku(),
      });
      expect(m.pdfEste).toBe('Hyvityslaskulla ei ole numeroa');
    });

    it('lasku ilman IBANia', () => {
      expect(malli({}, ilmanIbania).pdfEste).toBe('Lisää IBAN asetuksissa');
    });

    it('ensisijaisuus: rivit, sitten numero, sitten IBAN', () => {
      expect(malli({ rivit: [], numero: undefined }, ilmanIbania).pdfEste).toMatch(/ei ole rivejä/);
      expect(malli({ numero: undefined }, ilmanIbania).pdfEste).toBe('Laskulla ei ole numeroa');
    });

    it('kuitti ilman IBANia on sallittu', () => {
      const m = laskuMalli({
        tosite: lasku({ maksutapa: Maksutapa.KORTTIMAKSU }),
        kumppanit: KUMPPANIT,
        asetukset: ilmanIbania,
      });
      expect(m.pdfEste).toBeNull();
    });
  });

  describe('summat ilman alv-velvollisuutta', () => {
    it('vain Yhteensä kun AlvVelvollinen on pois ja rivit verottomia', () => {
      const m = malli(
        { rivit: [{ myyntiKpl: 3, aNetto: 10, alvKoodi: 0, alvProsentti: 0, selite: 'X' }] },
        { ...ASETUKSET, AlvVelvollinen: 'false' },
      );
      expect(m.summat).toEqual([
        { nimike: 'Yhteensä', arvo: muotoileEuro(3000 as Cents), vahva: true },
      ]);
    });

    it('alv-erittely säilyy kun rivillä on veroa, vaikka asetus olisi pois', () => {
      const m = malli({}, { ...ASETUKSET, AlvVelvollinen: 'false' });
      expect(m.summat.at(-1)?.nimike).toBe('Verollinen yhteensä');
    });
  });

  describe('alatunniste', () => {
    it('ALV-tunnus mukana kun AlvVelvollinen on päällä', () => {
      const m = malli();
      expect(m.alatunniste).toEqual([
        ['Demo Oy', 'Demokatu 1', '00100 Helsinki'],
        ['Y-tunnus 1234567-8', 'ALV-tunnus FI12345678'],
        ['Kotipaikka Helsinki'],
        ['Puhelin 040 123 4567', 'Sähköposti laskut@demo.fi'],
      ]);
    });

    it('ALV-tunnus puuttuu kun AlvVelvollinen on false; tyhjät sarakkeet pudotetaan', () => {
      const { Kotipaikka: _k, Puhelin: _p, Email: _e, ...vahva } = ASETUKSET;
      const m = malli({}, { ...vahva, AlvVelvollinen: 'false' });
      expect(m.alatunniste).toEqual([
        ['Demo Oy', 'Demokatu 1', '00100 Helsinki'],
        ['Y-tunnus 1234567-8'],
      ]);
      expect(m.alatunniste.flat().some((r) => r.startsWith('ALV-tunnus'))).toBe(false);
    });

    it('ALV-tunnus hyväksyy Kitsas-tuonnin ON-arvon', () => {
      const m = malli({}, { ...ASETUKSET, AlvVelvollinen: 'ON' });
      expect(m.alatunniste[1]).toContain('ALV-tunnus FI12345678');
    });
  });
});
