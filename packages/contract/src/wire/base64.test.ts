import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './base64.js';

describe('base64-apuri', () => {
  it('kiertää kaikki tavuarvot 0–255 muuttumattomina', () => {
    const kaikki = new Uint8Array(256);
    for (let i = 0; i < 256; i++) kaikki[i] = i;
    expect(base64ToBytes(bytesToBase64(kaikki))).toEqual(kaikki);
  });

  it('kiertää tyhjän taulukon', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
    expect(base64ToBytes('')).toEqual(new Uint8Array(0));
  });

  it('kiertää ison puskurin (~1 Mt) ilman pinovirhettä', () => {
    const iso = new Uint8Array(1_000_000);
    for (let i = 0; i < iso.length; i++) iso[i] = i % 256;
    expect(base64ToBytes(bytesToBase64(iso))).toEqual(iso);
  });
});
