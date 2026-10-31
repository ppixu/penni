import { describe, expect, it } from 'vitest';
import { jasennaKaava, tilitAlueille } from './raporttiKaava.js';

describe('jasennaKaava — flags', () => {
  it('decodes header / show-empty / subtotal / no-accumulate / detail / income / expense', () => {
    expect(jasennaKaava('3..8 S')).toMatchObject({
      otsikko: false,
      naytaTyhja: true,
      lisaaValisumma: false,
      laskeSummaan: true,
    });
    expect(jasennaKaava('7 h')).toMatchObject({ otsikko: true });
    expect(jasennaKaava('=')).toMatchObject({ lisaaValisumma: true, laskeSummaan: true });
    expect(jasennaKaava('90,91 == S')).toMatchObject({
      lisaaValisumma: false,
      laskeSummaan: false,
      naytaTyhja: true,
    });
    expect(jasennaKaava('40..43 *')).toMatchObject({ naytaErittelyt: true });
    expect(jasennaKaava('7+')).toMatchObject({ vainTulot: true, vainMenot: false });
    expect(jasennaKaava('7-')).toMatchObject({ vainMenot: true, vainTulot: false });
  });
  it('H sets both header and show-empty', () => {
    expect(jasennaKaava('H')).toMatchObject({ otsikko: true, naytaTyhja: true });
  });
  it('an empty formula has no ranges and no flags', () => {
    expect(jasennaKaava('')).toMatchObject({ alueet: [], otsikko: false });
  });
});

describe('jasennaKaava — ranges', () => {
  it('parses single, range, comma-list, glued-flag, and leading-space forms', () => {
    expect(jasennaKaava('4').alueet).toEqual([{ alku: '4', loppu: '4' }]);
    expect(jasennaKaava('40..43 *').alueet).toEqual([{ alku: '40', loppu: '43' }]);
    expect(jasennaKaava('204..209,214 *').alueet).toEqual([
      { alku: '204', loppu: '209' },
      { alku: '214', loppu: '214' },
    ]);
    expect(jasennaKaava(' 215*').alueet).toEqual([{ alku: '215', loppu: '215' }]);
    expect(jasennaKaava('S 0 2').alueet).toEqual([
      { alku: '0', loppu: '0' },
      { alku: '2', loppu: '2' },
    ]);
    expect(jasennaKaava('30..35 S *').alueet).toEqual([{ alku: '30', loppu: '35' }]);
  });
});

describe('tilitAlueille — lexicographic prefix matching', () => {
  const tilit = ['1', '10', '100', '2', '30', '3000', '3500', '3600', '40', '444'];
  it('matches by per-bound prefix length, not numeric containment', () => {
    expect(tilitAlueille([{ alku: '30', loppu: '35' }], tilit)).toEqual([30, 3000, 3500]); // first-2-chars in [30,35]
    expect(tilitAlueille([{ alku: '3', loppu: '3' }], tilit)).toEqual([30, 3000, 3500, 3600]); // all '3*'
    expect(tilitAlueille([{ alku: '1', loppu: '1' }], tilit)).toEqual([1, 10, 100]); // '1*' (string), excludes 2
  });
  it('unions comma-list ranges', () => {
    expect(
      tilitAlueille(
        [
          { alku: '0', loppu: '0' },
          { alku: '2', loppu: '2' },
        ],
        tilit,
      ),
    ).toEqual([2]);
  });
});
