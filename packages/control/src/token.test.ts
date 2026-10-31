import { describe, expect, it } from 'vitest';
import { luoToken, tiivistaToken } from './token.js';

describe('token', () => {
  it('luo eri tokenit ja vakaan tiivisteen', () => {
    const a = luoToken();
    const b = luoToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(tiivistaToken(a)).toBe(tiivistaToken(a));
    expect(tiivistaToken(a)).not.toBe(a); // tiiviste ≠ token
    expect(tiivistaToken(a)).toHaveLength(64); // SHA-256 hex
  });
});
