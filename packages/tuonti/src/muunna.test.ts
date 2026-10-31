import { describe, expect, it } from 'vitest';
import {
  type KitsasKumppaniRivi,
  type KitsasLiiteRivi,
  type KitsasOtsikkoRivi,
  type KitsasTiliRivi,
  type KitsasTositeRivi,
  type KitsasVientiRivi,
  muunnaKumppani,
  muunnaLiite,
  muunnaOtsikko,
  muunnaTili,
  muunnaTosite,
  muunnaVienti,
  suodataAsetukset,
} from './muunna.js';

const tyhjaVienti: KitsasVientiRivi = {
  tili: 0,
  debetsnt: null,
  kreditsnt: null,
  alvkoodi: null,
  alvprosentti: null,
  kohdennus: null,
  eraid: null,
  selite: null,
  tyyppi: null,
  pvm: null,
  jaksoalkaa: null,
  jaksoloppuu: null,
  json: null,
};

const tyhjaTosite: KitsasTositeRivi = {
  id: 0,
  pvm: '2026-01-01',
  tyyppi: 100,
  tila: 100,
  tunniste: null,
  sarja: null,
  otsikko: null,
  kumppani: null,
  laskupvm: null,
  erapvm: null,
  viite: null,
  json: null,
};

describe('muunnaVienti', () => {
  it('kääntää sentit ja alv-kentät suoraan', () => {
    const v = muunnaVienti(
      { ...tyhjaVienti, tili: 4000, debetsnt: 12345, alvkoodi: 1, alvprosentti: 25.5 },
      '2026-03-01',
    );
    expect(v).toEqual({
      tili: 4000,
      debet: 12345,
      kredit: 0,
      pvm: '2026-03-01',
      alvKoodi: 1,
      alvProsentti: 25.5,
    });
  });

  it('käyttää vientirivin omaa päivää kun se on annettu', () => {
    const v = muunnaVienti({ ...tyhjaVienti, tili: 1910, pvm: '2026-02-02' }, '2026-03-01');
    expect(v.pvm).toBe('2026-02-02');
  });

  it('jättää valinnaiset kentät kokonaan pois kun ne ovat tyhjiä', () => {
    const v = muunnaVienti({ ...tyhjaVienti, tili: 1910 }, '2026-03-01');
    expect('selite' in v).toBe(false);
    expect('era' in v).toBe(false);
    expect('kohdennus' in v).toBe(false);
  });

  it('siirtää valinnaiset kentät kun ne ovat olemassa', () => {
    const v = muunnaVienti(
      {
        ...tyhjaVienti,
        tili: 1910,
        selite: 'Ostolasku',
        tyyppi: 100,
        kohdennus: 3,
        eraid: 77,
        jaksoalkaa: '2026-01-01',
        jaksoloppuu: '2026-12-31',
      },
      '2026-03-01',
    );
    expect(v.selite).toBe('Ostolasku');
    expect(v.tyyppi).toBe(100);
    expect(v.kohdennus).toBe(3);
    expect(v.era).toBe(77);
    expect(v.jaksoalkaa).toBe('2026-01-01');
    expect(v.jaksoloppuu).toBe('2026-12-31');
  });

  it('poimii jaksotustilin json-kentästä', () => {
    const v = muunnaVienti(
      { ...tyhjaVienti, tili: 1910, json: JSON.stringify({ jaksotustili: 1201 }) },
      '2026-01-01',
    );
    expect(v.jaksotustili).toBe(1201);
  });

  it('jättää jaksotustilin pois kun se ei ole json-kentässä', () => {
    const v = muunnaVienti({ ...tyhjaVienti, tili: 1910, json: JSON.stringify({}) }, '2026-01-01');
    expect('jaksotustili' in v).toBe(false);
  });

  it('ei heittää virheettä kun json on väärässä muodossa', () => {
    const v = muunnaVienti({ ...tyhjaVienti, tili: 1910, json: 'invalid json {' }, '2026-01-01');
    expect(v.tili).toBe(1910);
    expect('jaksotustili' in v).toBe(false);
  });
});

describe('muunnaTosite', () => {
  it('säilyttää alkuperäisen tilan ja tunnisteen', () => {
    const t = muunnaTosite({ ...tyhjaTosite, id: 42, tila: 100, tunniste: 17 }, []);
    expect(t.id).toBe(42);
    expect(t.tila).toBe(100);
    expect(t.tunniste).toBe(17);
  });

  it('säilyttää poistetun tositeen tilan 0 ja sen tunnisteen', () => {
    const t = muunnaTosite({ ...tyhjaTosite, id: 2, tila: 0, tunniste: 129 }, []);
    expect(t.tila).toBe(0);
    expect(t.tunniste).toBe(129);
  });

  it('oletustunniste on 0 ja sarja tyhjä merkkijono', () => {
    const t = muunnaTosite({ ...tyhjaTosite, id: 1 }, []);
    expect(t.tunniste).toBe(0);
    expect(t.sarja).toBe('');
  });

  it('poimii numeron ja maksutavan json-kentän lasku-olion alta (merkkijononumero)', () => {
    const t = muunnaTosite(
      { ...tyhjaTosite, id: 5, json: JSON.stringify({ lasku: { numero: '6121063' } }) },
      [],
    );
    expect(t.numero).toBe('6121063');
  });

  it('poimii lasku-olion numeerisen numeron merkkijonoksi muunnettuna', () => {
    const t = muunnaTosite(
      {
        ...tyhjaTosite,
        id: 6,
        json: JSON.stringify({ lasku: { numero: 1000, maksutapa: 1 } }),
      },
      [],
    );
    expect(t.numero).toBe('1000');
    expect(t.maksutapa).toBe(1);
  });

  it('poimii numeron ja maksutavan json-kentästä kun lasku-oliota ei ole (vanha/synteettinen data)', () => {
    const t = muunnaTosite(
      { ...tyhjaTosite, id: 7, json: JSON.stringify({ numero: 'M-1', maksutapa: 5 }) },
      [],
    );
    expect(t.numero).toBe('M-1');
    expect(t.maksutapa).toBe(5);
  });

  it('ei aseta numeroa tai maksutapaa kun kumpaakaan ei löydy', () => {
    const t = muunnaTosite({ ...tyhjaTosite, id: 8, json: JSON.stringify({}) }, []);
    expect('numero' in t).toBe(false);
    expect('maksutapa' in t).toBe(false);
  });

  it('jättää valinnaiset kentät pois kun niitä ei ole', () => {
    const t = muunnaTosite({ ...tyhjaTosite, id: 1 }, []);
    expect('otsikko' in t).toBe(false);
    expect('kumppani' in t).toBe(false);
    expect('viite' in t).toBe(false);
  });

  it('liittää viennit sellaisenaan', () => {
    const viennit = [muunnaVienti({ ...tyhjaVienti, tili: 1910, debetsnt: 100 }, '2026-01-01')];
    const t = muunnaTosite({ ...tyhjaTosite, id: 1 }, viennit);
    expect(t.viennit).toEqual(viennit);
  });
});

describe('muunnaTili', () => {
  it('yhdistää json-kentät ja pakolliset sarakkeet', () => {
    const t = muunnaTili({
      numero: 4000,
      tyyppi: 'DM',
      iban: null,
      json: JSON.stringify({ nimi: { fi: 'Ostot' }, erittely: 1 }),
    });
    expect(t).toEqual({ nimi: { fi: 'Ostot' }, erittely: 1, numero: 4000, tyyppi: 'DM' });
  });

  it('ottaa ibanin omasta sarakkeestaan', () => {
    const t = muunnaTili({ numero: 1910, tyyppi: 'ARP', iban: 'FI2112345600000785', json: null });
    expect(t.iban).toBe('FI2112345600000785');
  });

  it('sietää rikkinäisen jsonin', () => {
    const t = muunnaTili({ numero: 1910, tyyppi: 'ARP', iban: null, json: '{ ei-jsonia' });
    expect(t).toEqual({ numero: 1910, tyyppi: 'ARP' });
  });

  it('sarakkeet voittavat json-ristiriitojen yhteydessä', () => {
    const t = muunnaTili({
      numero: 1910,
      tyyppi: 'ARP',
      iban: null,
      json: JSON.stringify({ numero: 9999, tyyppi: 'XX' }),
    });
    expect(t.numero).toBe(1910);
    expect(t.tyyppi).toBe('ARP');
  });
});

describe('muunnaOtsikko', () => {
  it('koodaa otsikkotason tyyppiin H<taso>', () => {
    const o = muunnaOtsikko({
      numero: 4,
      taso: 2,
      json: JSON.stringify({ nimi: { fi: 'Kulut' } }),
    });
    expect(o).toEqual({ nimi: { fi: 'Kulut' }, numero: 4, tyyppi: 'H2' });
  });

  it('sarakkeet voittavat json-ristiriitojen yhteydessä', () => {
    const o = muunnaOtsikko({
      numero: 4,
      taso: 2,
      json: JSON.stringify({ numero: 9999, tyyppi: 'XX', taso: 9 }),
    });
    expect(o.numero).toBe(4);
    expect(o.tyyppi).toBe('H2');
  });
});

describe('muunnaKumppani', () => {
  it('säilyttää id:n ja poimii osoitetiedot jsonista', () => {
    const k = muunnaKumppani(
      {
        id: 7,
        nimi: 'Testitoimittaja Oy',
        alvtunnus: 'FI12345671',
        json: JSON.stringify({ osoite: 'Katu 1', kaupunki: 'Helsinki', postinumero: '00100' }),
      },
      ['FI2112345600000785'],
    );
    expect(k.id).toBe(7);
    expect(k.nimi).toBe('Testitoimittaja Oy');
    expect(k.alvtunnus).toBe('FI12345671');
    expect(k.osoite).toBe('Katu 1');
    expect(k.kaupunki).toBe('Helsinki');
    expect(k.iban).toEqual(['FI2112345600000785']);
  });

  it('jättää ibanin pois kun niitä ei ole', () => {
    const k = muunnaKumppani({ id: 1, nimi: 'A', alvtunnus: null, json: null }, []);
    expect('iban' in k).toBe(false);
    expect('alvtunnus' in k).toBe(false);
  });

  it('siirtää tuntemattomia Kitsas-kenttiä verbatim', () => {
    const k = muunnaKumppani(
      {
        id: 3,
        nimi: 'Partner',
        alvtunnus: null,
        json: JSON.stringify({
          lisatiedot: 'Muistiinpano',
          laskutapa: 2,
          ovt: '003712345671',
        }),
      },
      [],
    );
    expect(k.lisatiedot).toBe('Muistiinpano');
    expect((k as unknown as Record<string, unknown>).laskutapa).toBe(2);
    expect(k.ovt).toBe('003712345671');
  });

  it('sarakkeet voittavat json-ristiriitojen yhteydessä', () => {
    const k = muunnaKumppani(
      {
        id: 5,
        nimi: 'Real Name',
        alvtunnus: null,
        json: JSON.stringify({ id: 9999, nimi: 'Väärä' }),
      },
      [],
    );
    expect(k.id).toBe(5);
    expect(k.nimi).toBe('Real Name');
  });
});

describe('muunnaLiite', () => {
  it('kääntää blobin ja metatiedot', () => {
    const data = Buffer.from([1, 2, 3]);
    const l = muunnaLiite(
      {
        nimi: 'kuitti.pdf',
        roolinimi: 'kuitti',
        tyyppi: 'application/pdf',
        sha: 'abc',
        luotu: '2026-01-01T10:00:00',
        data,
      },
      42,
    );
    expect(l.tosite).toBe(42);
    expect(l.nimi).toBe('kuitti.pdf');
    expect(l.roolinimi).toBe('kuitti');
    expect(l.tyyppi).toBe('application/pdf');
    expect(l.sha).toBe('abc');
    expect(l.luotu).toBe('2026-01-01T10:00:00');
    expect(Array.from(l.data)).toEqual([1, 2, 3]);
  });

  it('lukee BLOB-muotoisen shan hex-merkkijonoksi', () => {
    // Kitsas tallentaa Liite.sha:n BLOBina, jossa on 64 ASCII-heksamerkkiä, joten
    // ajuri palauttaa Bufferin. Ilman normalisointia se päätyisi liitteen json-
    // metatietoon muodossa {"type":"Buffer","data":[...]} eikä sopimuksen merkkijonoksi.
    const hex = 'a'.repeat(64);
    const l = muunnaLiite(
      {
        nimi: 'kuitti.pdf',
        roolinimi: null,
        tyyppi: 'application/pdf',
        sha: Buffer.from(hex, 'utf8'),
        luotu: null,
        data: null,
      },
      7,
    );
    expect(l.sha).toBe(hex);
  });

  it('heksaa binäärisen shan', () => {
    const l = muunnaLiite(
      {
        nimi: 'kuitti.pdf',
        roolinimi: null,
        tyyppi: 'application/pdf',
        sha: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
        luotu: null,
        data: null,
      },
      7,
    );
    expect(l.sha).toBe('deadbeef');
  });

  it('käyttää oletus-mimeä ja tyhjää dataa kun sarakkeet ovat tyhjiä', () => {
    const l = muunnaLiite(
      { nimi: null, roolinimi: null, tyyppi: null, sha: null, luotu: null, data: null },
      1,
    );
    expect(l.tyyppi).toBe('application/octet-stream');
    expect(l.data).toHaveLength(0);
    expect(l.luotu).toBe('1970-01-01T00:00:00.000Z');
    expect('roolinimi' in l).toBe(false);
    expect('sha' in l).toBe(false);
  });
});

describe('suodataAsetukset', () => {
  it('pudottaa Kitsaksen käyttöliittymäavaimet', () => {
    const a = suodataAsetukset({
      Nimi: 'Testi Oy',
      AlvVelvollinen: 'true',
      LaskuIkkunaX: '100',
      LaskuIkkunaKorkeus: '600',
      KitsasVersio: '2.0',
    });
    expect(a).toEqual({ Nimi: 'Testi Oy', AlvVelvollinen: 'true' });
  });
});
