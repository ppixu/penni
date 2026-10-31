import { describe, expect, it } from 'vitest';
import { poimiKaikki } from './tiliote.js';

describe('poimiKaikki', () => {
  it('yhdistää monen tiliotetekstin tapahtumat järjestyksessä', () => {
    const q1 = '1.4.2026   GITHUB, INC.   260401100001   -6,00';
    const q2 = '2.5.2026   ESIMERKKI.AI SUBSCRIPTION   260501100002   -18,00';
    const tap = poimiKaikki([q1, q2]);
    expect(tap.map((t) => t.nimi)).toEqual(['GITHUB, INC.', 'ESIMERKKI.AI SUBSCRIPTION']);
    expect(tap.map((t) => t.maara)).toEqual([-600, -1800]);
    expect(tap[0]?.viite).toBe('260401100001');
  });

  it('palauttaa tyhjän listan tyhjälle syötteelle', () => {
    expect(poimiKaikki([])).toEqual([]);
    expect(poimiKaikki(['otsikkorivi ilman päiväystä'])).toEqual([]);
  });
});
