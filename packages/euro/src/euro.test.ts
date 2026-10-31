import { describe, expect, it } from 'vitest';
import { Euro, EuroParseError, roundHalfAway } from './euro.js';
import type { Cents } from './euro.js';

describe('@penni/euro', () => {
  it('compiles and imports', () => {
    const c: Cents = 0 as Cents;
    expect(c).toBe(0);
  });
});

describe('roundHalfAway', () => {
  it('rounds halves away from zero', () => {
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(2.4)).toBe(2);
    expect(roundHalfAway(-2.4)).toBe(-2);
    expect(roundHalfAway(0)).toBe(0);
    expect(roundHalfAway(-0)).toBe(0);
    expect(roundHalfAway(1755.5)).toBe(1756);
  });
});

describe('Euro.toString', () => {
  it('formats as "N.NN" with two cent digits and explicit sign', () => {
    expect(Euro.toString(Euro.fromCents(0))).toBe('0.00');
    expect(Euro.toString(Euro.fromCents(5))).toBe('0.05');
    expect(Euro.toString(Euro.fromCents(50))).toBe('0.50');
    expect(Euro.toString(Euro.fromCents(2413050))).toBe('24130.50');
    expect(Euro.toString(Euro.fromCents(-8640))).toBe('-86.40');
    expect(Euro.toString(Euro.fromCents(-5))).toBe('-0.05');
  });
});

describe('Euro.fromCents', () => {
  it('truncates toward zero', () => {
    expect(Euro.fromCents(10.9)).toBe(10);
    expect(Euro.fromCents(-10.9)).toBe(-10);
  });
});

describe('Euro.fromString', () => {
  it('parses dot and comma decimals', () => {
    expect(Euro.fromString('86.40')).toBe(8640);
    expect(Euro.fromString('86,40')).toBe(8640);
    expect(Euro.fromString('0,05')).toBe(5);
    expect(Euro.fromString('24130,50')).toBe(2413050);
  });

  it('handles signs, blanks and partials', () => {
    expect(Euro.fromString('-86,40')).toBe(-8640);
    expect(Euro.fromString('+86,40')).toBe(8640);
    expect(Euro.fromString('')).toBe(0);
    expect(Euro.fromString('   ')).toBe(0);
    expect(Euro.fromString('5')).toBe(500);
    expect(Euro.fromString('5,')).toBe(500);
    expect(Euro.fromString(',5')).toBe(50);
    expect(Euro.fromString('-0,00')).toBe(0);
    expect(Euro.fromString('-0')).toBe(0);
  });

  it('ignores thousands spacing', () => {
    expect(Euro.fromString('1 234,56')).toBe(123456);
  });

  it('rounds more than two decimals half away from zero', () => {
    expect(Euro.fromString('1,005')).toBe(101);
    expect(Euro.fromString('1,004')).toBe(100);
    expect(Euro.fromString('2,345')).toBe(235);
    expect(Euro.fromString('-1,005')).toBe(-101);
    expect(Euro.fromString('0,999')).toBe(100);
  });

  it('throws on garbage', () => {
    expect(() => Euro.fromString('abc')).toThrow(EuroParseError);
    expect(() => Euro.fromString('-')).toThrow(EuroParseError);
    expect(() => Euro.fromString('1.2.3')).toThrow(EuroParseError);
  });
});

describe('Euro arithmetic', () => {
  const a = Euro.fromCents(8640);
  const b = Euro.fromCents(2360);
  it('adds and subtracts in cents', () => {
    expect(Euro.add(a, b)).toBe(11000);
    expect(Euro.sub(a, b)).toBe(6280);
  });
  it('negates and absolutes', () => {
    expect(Euro.neg(a)).toBe(-8640);
    expect(Euro.abs(Euro.fromCents(-8640))).toBe(8640);
  });
  it('compares and tests equality', () => {
    expect(Euro.compare(a, b)).toBe(1);
    expect(Euro.compare(b, a)).toBe(-1);
    expect(Euro.compare(a, a)).toBe(0);
    expect(Euro.equals(a, Euro.fromCents(8640))).toBe(true);
    expect(Euro.equals(a, b)).toBe(false);
  });
});

describe('Euro.mulRate', () => {
  it('multiplies cents by a rate and rounds half away', () => {
    // 86.40 net at quantity 1 stays itself
    expect(Euro.mulRate(Euro.fromCents(8640), 1)).toBe(8640);
    // 1755 cents * 1.001 = 1756.755 -> 1757
    expect(Euro.mulRate(Euro.fromCents(1755), 1.001)).toBe(1757);
    // halving an odd cent count rounds away from zero
    expect(Euro.mulRate(Euro.fromCents(101), 0.5)).toBe(51);
    expect(Euro.mulRate(Euro.fromCents(-101), 0.5)).toBe(-51);
  });
});

describe('golden: parity with Kitsas euro.cpp', () => {
  // Canonical pairs: cents <-> wire string
  const pairs: Array<[number, string]> = [
    [0, '0.00'],
    [5, '0.05'],
    [99, '0.99'],
    [100, '1.00'],
    [-100, '-1.00'],
    [2413050, '24130.50'],
    [-8640, '-86.40'],
  ];

  it('toString matches the canonical wire form', () => {
    for (const [cents, str] of pairs) {
      expect(Euro.toString(Euro.fromCents(cents))).toBe(str);
    }
  });

  it('fromString(toString(c)) round-trips for every canonical value', () => {
    for (const [cents] of pairs) {
      const c = Euro.fromCents(cents);
      expect(Euro.fromString(Euro.toString(c))).toBe(c);
    }
  });

  it('rounding boundaries match half-away-from-zero', () => {
    const cases: Array<[string, number]> = [
      ['0,005', 1],
      ['0,004', 0],
      ['0,015', 2],
      ['-0,005', -1],
      ['2,344', 234],
      ['2,345', 235],
    ];
    for (const [input, cents] of cases) {
      expect(Euro.fromString(input)).toBe(cents);
    }
  });

  // Cases ported from kitsas-source/unittest/eurotest/tst_eurotest.cpp
  // string_to_euro: dot-decimal parsing
  it('parses dot-decimal strings (ported from kitsas string_to_euro)', () => {
    expect(Euro.fromString('123.45')).toBe(12345);
    expect(Euro.fromString('123.4')).toBe(12340);
    expect(Euro.fromString('-123.45')).toBe(-12345);
    expect(Euro.fromString('-123.5')).toBe(-12350);
    expect(Euro.fromString('123')).toBe(12300);
    expect(Euro.fromString('-123')).toBe(-12300);
  });

  // less1string_to_euro: sub-1-euro amounts
  it('parses sub-1-euro amounts (ported from kitsas less1string_to_euro)', () => {
    expect(Euro.fromString('0.01')).toBe(1);
    expect(Euro.fromString('-0.01')).toBe(-1);
    expect(Euro.fromString('0.00')).toBe(0);
    expect(Euro.fromString('0.99')).toBe(99);
    expect(Euro.fromString('-0.99')).toBe(-99);
    expect(Euro.fromString('0.5')).toBe(50);
    expect(Euro.fromString('-0.5')).toBe(-50);
  });

  // qlonglong_to_string: fromCents + toString
  it('formats cents to string (ported from kitsas qlonglong_to_string)', () => {
    expect(Euro.toString(Euro.fromCents(12345))).toBe('123.45');
    expect(Euro.toString(Euro.fromCents(-12304))).toBe('-123.04');
    expect(Euro.toString(Euro.fromCents(10000))).toBe('100.00');
  });

  // neg_to_str: negative sub-1-euro
  it('formats negative sub-1-euro (ported from kitsas neg_to_str)', () => {
    expect(Euro.toString(Euro.fromCents(-65))).toBe('-0.65');
  });

  // euroSumma: addition
  it('adds two amounts (ported from kitsas euroSumma)', () => {
    expect(Euro.add(Euro.fromCents(1200), Euro.fromCents(2450))).toBe(3650);
  });

  // euro_eq_euro: equality
  it('equality checks (ported from kitsas euro_eq_euro)', () => {
    expect(Euro.equals(Euro.fromString('5.12'), Euro.fromString('5.12'))).toBe(true);
    expect(Euro.equals(Euro.fromString('5.12'), Euro.fromString('-1.12'))).toBe(false);
    expect(Euro.equals(Euro.fromString('-1.12'), Euro.fromString('0.12'))).toBe(false);
  });

  // str1/str2: fromString with thousands spacing and comma decimal.
  // NOTE: kitsas-source Euro::fromString also supports TRAILING sign ("1 234,56 -"),
  // which our spec does not (leading sign only). We only port the leading-sign cases here.
  it('parses thousands-spaced comma-decimal with leading sign (ported from kitsas str2)', () => {
    expect(Euro.fromString('- 7 654,32')).toBe(-765432);
    expect(Euro.fromString('+ 7 654,32')).toBe(765432);
  });
});
