import { describe, expect, it } from 'vitest';
import { muotoileBp, muotoileSadasosat, parsiBp, parsiSadasosat } from './prosentti';

describe('parsiBp', () => {
  it('parsii pilkku- ja pistedesimaalit kokonaisiksi peruspisteiksi', () => {
    expect(parsiBp('23,5')).toBe(2350);
    expect(parsiBp('23.5')).toBe(2350);
    expect(parsiBp('24,85')).toBe(2485);
    expect(parsiBp('0,89')).toBe(89);
    expect(parsiBp('7')).toBe(700);
    expect(parsiBp(' 100 ')).toBe(10000);
    expect(parsiBp('0')).toBe(0);
  });
  it('liukulukuvirheet eivät pääse mukaan (19,35 ja 1,15)', () => {
    expect(parsiBp('19,35')).toBe(1935);
    expect(parsiBp('1,15')).toBe(115);
  });
  it('hylkää virheelliset ja yli sadan prosentin arvot', () => {
    expect(parsiBp('')).toBeNull();
    expect(parsiBp('abc')).toBeNull();
    expect(parsiBp('1,234')).toBeNull();
    expect(parsiBp('-1')).toBeNull();
    expect(parsiBp('100,01')).toBeNull();
    expect(parsiBp('1,2,3')).toBeNull();
    expect(parsiBp('1e2')).toBeNull();
  });
});

describe('muotoileBp', () => {
  it('muotoilee suomalaisen prosentin ilman turhia nollia', () => {
    expect(muotoileBp(2350)).toBe('23,5');
    expect(muotoileBp(2485)).toBe('24,85');
    expect(muotoileBp(89)).toBe('0,89');
    expect(muotoileBp(700)).toBe('7');
    expect(muotoileBp(0)).toBe('0');
  });
});

describe('parsiSadasosat / muotoileSadasosat', () => {
  it('tunnit ja km kahdella desimaalilla sadasosiksi ilman liukulukuja', () => {
    expect(parsiSadasosat('37,5')).toEqual({ arvo: 3750 });
    expect(parsiSadasosat('100')).toEqual({ arvo: 10_000 });
    expect(parsiSadasosat('1 234,25')).toEqual({ arvo: 123_425 });
    expect(parsiSadasosat('0.15')).toEqual({ arvo: 15 });
    expect(parsiSadasosat('')).toEqual({ arvo: 0 });
  });
  it('kokonaislukumäärät (päivät, ateriat)', () => {
    expect(parsiSadasosat('3', true)).toEqual({ arvo: 300 });
    expect(parsiSadasosat('1,5', true)).toEqual({ virhe: 'Määrän on oltava kokonaisluku.' });
  });
  it('hylkää virheelliset', () => {
    expect(parsiSadasosat('12,345')).toEqual({ virhe: 'Määrä: enintään kaksi desimaalia.' });
    expect(parsiSadasosat('-1')).toEqual({ virhe: 'Määrä ei ole kelvollinen luku.' });
    expect(parsiSadasosat('1e3')).toEqual({ virhe: 'Määrä ei ole kelvollinen luku.' });
  });
  it('muotoilee takaisin', () => {
    expect(muotoileSadasosat(3750)).toBe('37,5');
    expect(muotoileSadasosat(10_000)).toBe('100');
    expect(muotoileSadasosat(15)).toBe('0,15');
    expect(muotoileSadasosat(0)).toBe('');
  });
});
