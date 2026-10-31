import { describe, expect, it } from 'vitest';
import { Luonne } from './luonne.js';
import {
  eritellaankoTase,
  lataaKartta,
  lataaTili,
  nimi,
  tasoTyypista,
  tiliTyypilla,
} from './tili.js';

describe('lataaTili — parse one chart account', () => {
  it('parses a leaf account and resolves luonne from tyyppi', () => {
    const t = lataaTili({
      numero: 1021,
      tyyppi: 'APT',
      nimi: { fi: 'Kehittämismenot', sv: 'Utvecklingsutgifter' },
      poistotili: 6820,
      erittely: 3,
      laajuus: 4,
    });
    expect(t.numero).toBe(1021);
    expect(t.tyyppiKoodi).toBe('APT');
    expect(t.luonne).toBe(Luonne.TASAERAPOISTO);
    expect(t.otsikkotaso).toBe(0);
    expect(t.erittely).toBe(3);
    expect(nimi(t)).toBe('Kehittämismenot');
    expect(nimi(t, 'sv')).toBe('Utvecklingsutgifter');
  });

  it('parses a heading and marks otsikkotaso', () => {
    const h = lataaTili({ numero: 1, tyyppi: 'H1', nimi: { fi: 'Vastaavaa', sv: 'Aktiva' } });
    expect(h.luonne).toBe(Luonne.OTSIKKO);
    expect(h.otsikkotaso).toBe(1);
    expect(nimi(h)).toBe('Vastaavaa');
  });

  it('eritellaankoTase reflects the erittely level', () => {
    expect(
      eritellaankoTase(
        lataaTili({ numero: 1700, tyyppi: 'AO', nimi: { fi: 'Myyntisaamiset' }, erittely: 1 }),
      ),
    ).toBe(true);
    expect(
      eritellaankoTase(lataaTili({ numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } })),
    ).toBe(false);
  });
});

describe('lataaKartta — parse an account array', () => {
  it('loads every account in order', () => {
    const chart = lataaKartta([
      { numero: 1, tyyppi: 'H1', nimi: { fi: 'Vastaavaa' } },
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    ]);
    expect(chart).toHaveLength(2);
    expect(chart[1]?.luonne).toBe(Luonne.PANKKITILI);
  });
});

describe('tiliTyypilla — exact-mask singleton resolution', () => {
  const chart = lataaKartta([
    { numero: 2939, tyyppi: 'BJ', nimi: { fi: 'Siirtovelat' } }, // SIIRTOVELKA = 722
    { numero: 2620, tyyppi: 'BSP', nimi: { fi: 'Luottotili' } }, // VELKATILI = 722 (collision)
    { numero: 2939, tyyppi: 'T', nimi: { fi: 'Tilikauden tulos' } }, // KAUDENTULOS = 1074
    { numero: 9000, tyyppi: 'CL', nimi: { fi: 'Myynti' } }, // LVTULO 84 — never matches an exact singleton mask below
  ]);

  it('finds a unique singleton by exact mask', () => {
    expect(tiliTyypilla(chart, Luonne.KAUDENTULOS)?.tyyppiKoodi).toBe('T');
  });
  it('uses exact equality, not subset (a LVTULO account is not returned for TULO)', () => {
    expect(tiliTyypilla(chart, Luonne.TULO)).toBeUndefined();
  });
  it('returns the first match for a colliding mask', () => {
    expect(tiliTyypilla(chart, Luonne.VELKATILI)?.numero).toBe(2939); // first 722 in order (BJ)
  });
  it('a preferred account number disambiguates a colliding mask', () => {
    expect(tiliTyypilla(chart, Luonne.VELKATILI, 2620)?.tyyppiKoodi).toBe('BSP');
  });
  it('returns undefined when no account has the exact mask', () => {
    expect(tiliTyypilla(chart, Luonne.RAHAVARAT)).toBeUndefined();
  });
});

describe('tasoTyypista', () => {
  it('antaa lehtitilille tason 0', () => {
    expect(tasoTyypista('ARP')).toBe(0);
    expect(tasoTyypista('CL')).toBe(0);
    expect(tasoTyypista('D')).toBe(0);
  });

  it('lukee otsikkotason H-koodista', () => {
    expect(tasoTyypista('H1')).toBe(1);
    expect(tasoTyypista('H2')).toBe(2);
    expect(tasoTyypista('H5')).toBe(5);
  });

  it('tuntematon tai tyhjä koodi on taso 0', () => {
    expect(tasoTyypista('')).toBe(0);
    expect(tasoTyypista('EIOLE')).toBe(0);
    expect(tasoTyypista('H')).toBe(0);
  });

  it('on aina samaa mieltä Tili.otsikkotason kanssa', () => {
    const koodit = ['ARP', 'CL', 'D', 'BL', '', 'EIOLE', 'H', 'H0', 'H1', 'H2', 'H5', 'H10', 'H-1'];
    for (const koodi of koodit) {
      expect(tasoTyypista(koodi)).toBe(lataaTili({ numero: 1, tyyppi: koodi }).otsikkotaso);
    }
  });
});
