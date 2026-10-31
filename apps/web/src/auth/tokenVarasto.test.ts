import { afterEach, describe, expect, it } from 'vitest';
import { lueToken, tallennaToken, tyhjennaToken } from './tokenVarasto.js';

afterEach(() => localStorage.clear());

describe('tokenVarasto', () => {
  it('tallentaa, lukee ja tyhjentää', () => {
    expect(lueToken()).toBeNull();
    tallennaToken('abc');
    expect(lueToken()).toBe('abc');
    tyhjennaToken();
    expect(lueToken()).toBeNull();
  });
});
