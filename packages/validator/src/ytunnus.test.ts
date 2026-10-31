import { describe, expect, it } from 'vitest';
import { muotoileYtunnus, tarkistaYtunnus } from './ytunnus.js';

describe('ytunnus', () => {
  it('tarkistaYtunnus — mod-11 painot 7,9,10,5,8,4,2', () => {
    // Verohallinnon oikea Y-tunnus (legacy-siemenessä alvtunnus=FI02454583).
    // Kanta 0245458: painotettu summa 151; 151 % 11 = 8; tarkiste 11 - 8 = 3.
    expect(tarkistaYtunnus('0245458-3')).toBe(true);
    expect(tarkistaYtunnus('0245458-4')).toBe(false); // väärä tarkiste
    expect(tarkistaYtunnus('1234567')).toBe(false); // ei tarkistetta / väärä pituus
  });

  it('muotoileYtunnus — NNNNNNN-T', () => {
    expect(muotoileYtunnus('02454583')).toBe('0245458-3');
  });
});
