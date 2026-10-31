import { describe, expect, it } from 'vitest';
import lahde from './pdf.ts?raw';

// Työpöytäsovelluksen Electron 33 on Chrome 130. pdf.js 6:n moderni build kutsuu ilman
// polyfillejä uudempia rajapintoja (Map.prototype.getOrInsertComputed, Uint8Array.prototype.toHex,
// Math.sumPrecise, Float16Array), joten tiliotteen ja kuitin PDF:n luku kaatui sovelluksessa
// vaikka toimi uudemmassa selaimessa. Legacy-build tuo ne polyfilleinä.
describe('pdf.js-build', () => {
  const tuonnit = [...lahde.matchAll(/from '(pdfjs-dist[^']*)'/g)].map((m) => m[1]);

  it('käyttää sekä pääsäikeessä että työntekijässä legacy-buildia', () => {
    expect(tuonnit).toEqual([
      'pdfjs-dist/legacy/build/pdf.mjs',
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker',
    ]);
  });
});
