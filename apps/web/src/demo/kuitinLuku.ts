import { annaMalliYmparisto } from '@/kuitit/malliYmparisto';
import type { KuitinLukuRiippuvuudet } from '@/kuitit/useKuitinLuku';

/**
 * Kuitinluku demossa: PDF:n tekstikerros luetaan pdf.js:llä kuten aina, mutta näkömallia
 * (0,85 Gt) ei tarjota ladattavaksi — kuvakuitit jäävät käsin täytettäviksi.
 */
export const demonKuitinLuku: KuitinLukuRiippuvuudet = {
  ymparisto: annaMalliYmparisto,
  malli: () => ({
    saatavilla: async () => false,
    lataa: async () => {},
    tulkitse: async () => '',
  }),
  pdfTeksti: async (pdf) => (await import('@/kuitit/pdf')).luePdfTeksti(pdf),
  rasteroiPdf: async (pdf) => (await import('@/kuitit/pdf')).rasteroiPdf(pdf),
};
