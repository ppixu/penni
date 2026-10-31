import { describe, expect, it } from 'vitest';
import { esikatselunTyyppi } from './LiiteEsikatselu.js';

const teksti = (s: string) => new TextEncoder().encode(s);

describe('esikatselunTyyppi', () => {
  it('tunnistaa PDF:n tavuista, myös ilman oikeaa tyyppiä', () => {
    expect(esikatselunTyyppi('application/pdf', teksti('%PDF-1.7\n'))).toBe('application/pdf');
    expect(esikatselunTyyppi('application/octet-stream', teksti('\n\n%PDF-1.4'))).toBe(
      'application/pdf',
    );
  });

  it('tunnistaa kuvat tavuista', () => {
    expect(esikatselunTyyppi('', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(
      esikatselunTyyppi('', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
    expect(esikatselunTyyppi('', teksti('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });

  it('ei upota PDF:ksi väitettyä muuta sisältöä eikä HTML:ää tai SVG:tä', () => {
    expect(esikatselunTyyppi('application/pdf', teksti('<html><script></script>'))).toBeNull();
    expect(esikatselunTyyppi('text/html', teksti('<html></html>'))).toBeNull();
    expect(esikatselunTyyppi('image/svg+xml', teksti('<svg onload="x()"/>'))).toBeNull();
  });

  it('ilmoitettu kuvatyyppi kelpaa <img>-esikatseluun', () => {
    expect(esikatselunTyyppi('image/JPEG; charset=binary', new Uint8Array([1, 2]))).toBe(
      'image/jpeg',
    );
  });
});
