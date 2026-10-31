import { describe, expect, it, vi } from 'vitest';
import { onkoTekstia, pdfTeksti } from './pdfTeksti.js';
import { luoTestiPdf } from './testi/luoTestiPdf.js';

describe('pdfTeksti', () => {
  it('poimii tekstikerroksen riveittain', async () => {
    const pdf = luoTestiPdf(['1.4.2026 PILVIPALVELU 20,00', '14.4.2026 GITHUB 6,37']);
    const teksti = await pdfTeksti(pdf);
    expect(teksti).toContain('PILVIPALVELU');
    expect(teksti).toContain('GITHUB');
    expect(teksti.split('\n').filter((r) => r.trim() !== '')).toHaveLength(2);
  });

  it('onkoTekstia erottaa tyhjan tekstikerroksen', () => {
    expect(onkoTekstia('   ')).toBe(false);
    expect(onkoTekstia('1.4.2026 PILVIPALVELU 20,00')).toBe(true);
  });

  it('ei tulosta pdf.js:n varoituksia konsoliin', async () => {
    const loki = vi.spyOn(console, 'log').mockImplementation(() => {});
    const varoitus = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await pdfTeksti(luoTestiPdf(['Tiliote', 'Kausi: 01.02.2026 - 28.02.2026']));
      const kutsut = [...loki.mock.calls, ...varoitus.mock.calls].map((k) => String(k[0]));
      expect(kutsut.filter((k) => k.includes('Warning'))).toEqual([]);
    } finally {
      loki.mockRestore();
      varoitus.mockRestore();
    }
  });
});
