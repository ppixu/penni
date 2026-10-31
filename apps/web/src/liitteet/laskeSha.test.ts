import { describe, expect, it } from 'vitest';
import { laskeSha } from './laskeSha.js';

describe('laskeSha', () => {
  it('laskee tyhjän syötteen SHA-256:n', async () => {
    // tunnettu tyhjän tavujonon SHA-256
    expect(await laskeSha(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
