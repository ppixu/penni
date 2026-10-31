import { describe, expect, it } from 'vitest';
import { pudotaTyhjat } from './omit.js';

describe('pudotaTyhjat', () => {
  it('drops undefined, null, empty string and numeric zero', () => {
    expect(pudotaTyhjat({ a: 1, b: 0, c: '', d: undefined, e: null, f: 'x', g: false })).toEqual({
      a: 1,
      f: 'x',
      g: false,
    });
  });
  it('keeps nested objects and arrays as-is', () => {
    const era = { id: 5 };
    const arr = [1, 2];
    expect(pudotaTyhjat({ era, arr, empty: 0 })).toEqual({ era, arr });
  });
  it('returns a new object (does not mutate the input)', () => {
    const input = { a: 0, b: 1 };
    const out = pudotaTyhjat(input);
    expect(input).toEqual({ a: 0, b: 1 });
    expect(out).not.toBe(input);
  });
});
