import { describe, expect, it } from 'vitest';
import { OCR_KEHOTE, rakennaKuittiKehote } from './kehote.js';

describe('rakennaKuittiKehote', () => {
  it('pyytää pelkkää JSONia ja nimeää vaaditut kentät', () => {
    const k = rakennaKuittiKehote();
    expect(k).toMatch(/JSON/i);
    expect(k).toContain('bruttoSumma');
    expect(k).toContain('ytunnus');
    expect(k).toContain('YYYY-MM-DD');
    expect(k).toContain('alv');
  });
});

describe('OCR_KEHOTE', () => {
  it('pyytää litteroinnin riveittäin eikä JSONia', () => {
    expect(OCR_KEHOTE).toContain('Never join several lines into one.');
    expect(OCR_KEHOTE).toContain('no JSON');
    expect(OCR_KEHOTE).toContain('Do not calculate');
  });
});
