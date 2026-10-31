import { describe, expect, it } from 'vitest';
import { luoTestiPdf } from './luoTestiPdf.js';

describe('luoTestiPdf', () => {
  it('tuottaa PDF-otsakkeella alkavan ja %%EOF-lopetuksella päättyvän tavujonon', () => {
    const pdf = luoTestiPdf(['ensimmainen rivi', 'toinen rivi']);
    const teksti = new TextDecoder('latin1').decode(pdf);
    expect(teksti.startsWith('%PDF-1.4')).toBe(true);
    expect(teksti.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(teksti).toContain('/Type /Catalog');
  });

  it('suojaa sulkeet ja kenoviivat PDF-merkkijonossa', () => {
    const teksti = new TextDecoder('latin1').decode(luoTestiPdf(['a (b) c \\ d']));
    expect(teksti).toContain('(a \\(b\\) c \\\\ d)');
  });
});
