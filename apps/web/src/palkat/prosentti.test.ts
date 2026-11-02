import { describe, expect, it } from 'vitest';
import { muotoileBp, parsiBp } from './prosentti';

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
