import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { centsToWire, prosenttiToWire, wireToCents } from './euro.js';

describe('centsToWire', () => {
  it('formats integer cents as canonical "N.NN"', () => {
    expect(centsToWire(Euro.fromCents(0))).toBe('0.00');
    expect(centsToWire(Euro.fromCents(5))).toBe('0.05');
    expect(centsToWire(Euro.fromCents(50))).toBe('0.50');
    expect(centsToWire(Euro.fromCents(100))).toBe('1.00');
    expect(centsToWire(Euro.fromCents(12345))).toBe('123.45');
    expect(centsToWire(Euro.fromCents(-1205))).toBe('-12.05');
  });
});

describe('wireToCents (liberal decode)', () => {
  it('accepts canonical strings', () => {
    expect(wireToCents('123.45')).toBe(12345);
    expect(wireToCents('-12.05')).toBe(-1205);
    expect(wireToCents('1.5')).toBe(150); // one decimal scales x10
  });
  it('accepts comma-decimal strings', () => {
    expect(wireToCents('12,34')).toBe(1234);
  });
  it('accepts raw numbers (legacy double euros), rounding half away', () => {
    expect(wireToCents(12.34)).toBe(1234);
    expect(wireToCents(124)).toBe(12400);
    expect(wireToCents(0.005)).toBe(1); // 0.5 cents rounds to 1
  });
  it('treats empty/absent as zero', () => {
    expect(wireToCents('')).toBe(0);
    expect(wireToCents(null)).toBe(0);
    expect(wireToCents(undefined)).toBe(0);
    expect(wireToCents(0)).toBe(0);
  });
});

describe('prosenttiToWire', () => {
  it('formats a percent as a 2-decimal string', () => {
    expect(prosenttiToWire(25.5)).toBe('25.50');
    expect(prosenttiToWire(24)).toBe('24.00');
    expect(prosenttiToWire(0)).toBe('0.00');
  });
});
