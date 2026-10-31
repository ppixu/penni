import { lataaKartta } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import {
  onVaroTyyppi,
  tarkistaNumero,
  tarvitseekoVahvistuksen,
  tyyppiSuodatin,
} from './tilikartta.js';

const KARTTA = lataaKartta([
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 1, tyyppi: 'H1', nimi: { fi: 'VASTAAVAA' } },
]);

describe('tyyppiSuodatin — picker by leading digit of number', () => {
  it('1… → asset types (koodi starts A)', () => {
    expect(tyyppiSuodatin('1900').every((t) => t.koodi.startsWith('A'))).toBe(true);
    expect(tyyppiSuodatin('1900').some((t) => t.koodi === 'ARP')).toBe(true);
  });
  it('2… → equity/liability types (koodi starts B or T)', () => {
    expect(tyyppiSuodatin('2371').every((t) => /^[BT]/.test(t.koodi))).toBe(true);
    expect(tyyppiSuodatin('2371').some((t) => t.koodi === 'T')).toBe(true);
  });
  it('3…–9… → income/expense types (koodi starts C or D)', () => {
    expect(tyyppiSuodatin('3000').every((t) => /^[CD]/.test(t.koodi))).toBe(true);
    expect(tyyppiSuodatin('4000').every((t) => /^[CD]/.test(t.koodi))).toBe(true);
  });
  it('empty/short number → empty list', () => {
    expect(tyyppiSuodatin('')).toEqual([]);
  });
});

describe('onVaroTyyppi — special types', () => {
  it('flags the documented varoTyypit set', () => {
    for (const k of ['AJ', 'AL', 'ALM', 'AV', 'BE', 'T', 'BL', 'BJ', 'BLM', 'BV']) {
      expect(onVaroTyyppi(k)).toBe(true);
    }
    expect(onVaroTyyppi('ARP')).toBe(false);
    expect(onVaroTyyppi('CL')).toBe(false);
  });
});

describe('tarkistaNumero — uniqueness + sane range (add mode)', () => {
  it('accepts a free in-range number', () => {
    expect(tarkistaNumero(1950, KARTTA)).toBeNull();
  });
  it('rejects a duplicate leaf number', () => {
    expect(tarkistaNumero(1900, KARTTA)).toBe('Tilinumero on jo käytössä.');
  });
  it('rejects out-of-range numbers', () => {
    expect(tarkistaNumero(999, KARTTA)).toBe('Tilinumeron on oltava välillä 1000–9999.');
    expect(tarkistaNumero(10_000, KARTTA)).toBe('Tilinumeron on oltava välillä 1000–9999.');
  });
});

describe('tarvitseekoVahvistuksen — special-type change confirm', () => {
  it('confirms when changing TO a special type', () => {
    expect(tarvitseekoVahvistuksen('ARP', 'BE')).toBe(true);
  });
  it('confirms when changing FROM a special type', () => {
    expect(tarvitseekoVahvistuksen('T', 'D')).toBe(true);
  });
  it('no confirm between two ordinary types', () => {
    expect(tarvitseekoVahvistuksen('ARP', 'AO')).toBe(false);
  });
  it('no confirm when the type is unchanged', () => {
    expect(tarvitseekoVahvistuksen('T', 'T')).toBe(false);
  });
});
