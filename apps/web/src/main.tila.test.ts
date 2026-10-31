import { describe, expect, it } from 'vitest';
import { paataTila } from './main';

describe('paataTila', () => {
  it('oletus on paikallinen OPFS-tila', () => {
    expect(paataTila({})).toBe('local');
  });

  it('tunnistaa pilvitilan', () => {
    expect(paataTila({ VITE_TILA: 'cloud' })).toBe('cloud');
  });

  it('tunnistaa työpöytätilan', () => {
    expect(paataTila({ VITE_TILA: 'tyopoyta' })).toBe('tyopoyta');
  });

  it('tuntematon arvo putoaa paikalliseen tilaan', () => {
    expect(paataTila({ VITE_TILA: 'jotain-muuta' })).toBe('local');
  });
});
