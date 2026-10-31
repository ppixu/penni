import { describe, expect, it } from 'vitest';
import {
  ViiteTyyppi,
  laskeViite,
  muotoileViite,
  rfViite,
  tarkistaRfViite,
  tarkistaViite,
  viiteEralle,
} from './viite.js';

describe('viite', () => {
  it('laskeViite — 7-3-1 mod-10 tarkiste', () => {
    expect(laskeViite('100')).toBe('1009'); // check digit 9
    expect(laskeViite('1069000')).toBe('10690002'); // check digit 2
  });

  it('tarkistaViite — traditional', () => {
    expect(tarkistaViite('1009')).toBe(true);
    expect(tarkistaViite('10690002')).toBe(true);
    expect(tarkistaViite('1008')).toBe(false);
  });

  it('rfViite / tarkistaRfViite — ISO-11649 mod-97', () => {
    expect(rfViite('3012396')).toBe('RF06 3012 396'); // spaced, check 06
    expect(tarkistaRfViite('RF063012396')).toBe(true);
    expect(tarkistaRfViite('RF06 3012 396')).toBe(true);
    expect(tarkistaRfViite('RF073012396')).toBe(false);
  });

  it('muotoileViite — traditional groups of 5 from the right', () => {
    expect(muotoileViite('10690002')).toBe('106 90002');
    expect(muotoileViite('3012396')).toBe('30 12396');
  });

  it('viiteEralle — ASIAKAS(3) kanta 123 -> 3012396', () => {
    expect(viiteEralle(ViiteTyyppi.ASIAKAS, 123)).toBe('3012396');
  });
});
