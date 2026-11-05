import { describe, expect, it } from 'vitest';
import {
  erillisilmoituksenMaarapaiva,
  omaVeroEraPaiva,
  palkkatietoilmoituksenMaarapaiva,
  pyhapaivat,
  seuraavaArkipaiva,
} from './maarapaivat.js';

describe('pyhapaivat', () => {
  it('2026: sisältää pitkäperjantain, 2. pääsiäispäivän, helatorstain, juhannusaaton ja joulut', () => {
    const p = pyhapaivat(2026);
    for (const d of [
      '2026-01-01',
      '2026-01-06',
      '2026-04-03', // pitkäperjantai (pääsiäinen 5.4.)
      '2026-04-06', // 2. pääsiäispäivä
      '2026-05-01',
      '2026-05-14', // helatorstai
      '2026-06-19', // juhannusaatto
      '2026-12-06', // itsenäisyyspäivä (sunnuntai)
      '2026-12-24',
      '2026-12-25',
      '2026-12-26',
    ]) {
      expect(p, d).toContain(d);
    }
  });

  it('pääsiäinen 2025 ja 2027', () => {
    expect(pyhapaivat(2025)).toContain('2025-04-18'); // pitkäperjantai
    expect(pyhapaivat(2025)).toContain('2025-04-21'); // 2. pääsiäispäivä
    expect(pyhapaivat(2025)).toContain('2025-05-29'); // helatorstai
    expect(pyhapaivat(2025)).toContain('2025-06-20'); // juhannusaatto
    expect(pyhapaivat(2027)).toContain('2027-03-26'); // pitkäperjantai (pääsiäinen 28.3.)
    expect(pyhapaivat(2027)).toContain('2027-03-29');
    expect(pyhapaivat(2027)).toContain('2027-05-06'); // helatorstai
    expect(pyhapaivat(2027)).toContain('2027-06-25'); // juhannusaatto
  });

  it('on järjestetty ja ilman kaksoiskappaleita', () => {
    const p = pyhapaivat(2026);
    expect([...p].sort()).toEqual(p);
    expect(new Set(p).size).toBe(p.length);
  });
});

describe('seuraavaArkipaiva', () => {
  it('arkipäivä palautuu sellaisenaan', () => {
    expect(seuraavaArkipaiva('2026-10-20')).toBe('2026-10-20');
  });
  it('lauantai ja sunnuntai siirtyvät maanantaille', () => {
    expect(seuraavaArkipaiva('2026-09-12')).toBe('2026-09-14');
    expect(seuraavaArkipaiva('2026-09-13')).toBe('2026-09-14');
  });
  it('pyhäpäiväjono: pitkäperjantai + viikonloppu + 2. pääsiäispäivä -> tiistai', () => {
    expect(seuraavaArkipaiva('2026-04-03')).toBe('2026-04-07');
  });
  it('joulu: 24.12.2026 (torstai) -> maanantai 28.12.', () => {
    expect(seuraavaArkipaiva('2026-12-24')).toBe('2026-12-28');
  });
});

describe('palkkatietoilmoituksenMaarapaiva (maksupäivä + 5 pv, sitten seuraava arkipäivä)', () => {
  it('2026-04-01 -> 2026-04-07 (6.4. on 2. pääsiäispäivä)', () => {
    expect(palkkatietoilmoituksenMaarapaiva('2026-04-01')).toBe('2026-04-07');
  });
  it('2026-10-15 -> 2026-10-20 (20.10. on tiistai)', () => {
    expect(palkkatietoilmoituksenMaarapaiva('2026-10-15')).toBe('2026-10-20');
  });
  it('kuun- ja vuodenvaihde', () => {
    expect(palkkatietoilmoituksenMaarapaiva('2026-12-31')).toBe('2027-01-05');
  });
});

describe('erillisilmoituksenMaarapaiva', () => {
  it('2026-12 -> 2027-01-05', () => {
    expect(erillisilmoituksenMaarapaiva('2026-12')).toBe('2027-01-05');
  });
  it('viides päivä lauantaina siirtyy maanantaille', () => {
    expect(erillisilmoituksenMaarapaiva('2026-11')).toBe('2026-12-07'); // 5.12.2026 on lauantai
  });
  it('arkipäiville osuvat viidennet säilyvät', () => {
    expect(erillisilmoituksenMaarapaiva('2026-01')).toBe('2026-02-05'); // to
    expect(erillisilmoituksenMaarapaiva('2026-02')).toBe('2026-03-05'); // to
    expect(erillisilmoituksenMaarapaiva('2026-05')).toBe('2026-06-05'); // pe
    expect(erillisilmoituksenMaarapaiva('2026-09')).toBe('2026-10-05'); // ma
    expect(erillisilmoituksenMaarapaiva('2026-07')).toBe('2026-08-05'); // ke
    expect(erillisilmoituksenMaarapaiva('2026-10')).toBe('2026-11-05'); // to
    expect(erillisilmoituksenMaarapaiva('2026-03')).toBe('2026-04-07'); // 5.4. on pääsiäissunnuntai
  });
});

describe('omaVeroEraPaiva', () => {
  it('2026-09 -> 2026-10-12', () => {
    expect(omaVeroEraPaiva('2026-09')).toBe('2026-10-12');
  });
  it('lauantaille osuva 12. siirtyy maanantaille', () => {
    expect(omaVeroEraPaiva('2026-08')).toBe('2026-09-14'); // 12.9.2026 on lauantai
  });
  it('vuodenvaihde', () => {
    expect(omaVeroEraPaiva('2026-12')).toBe('2027-01-12');
  });
  it('virheellinen kuukausi', () => {
    expect(() => omaVeroEraPaiva('2026-13')).toThrowError();
    expect(() => omaVeroEraPaiva('2026-9')).toThrowError();
  });
});
