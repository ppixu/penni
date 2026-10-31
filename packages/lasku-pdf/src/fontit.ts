import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from 'pdf-lib';
import { INTER_REGULAR_BASE64 } from './fontData/interRegular.js';
import { INTER_SEMIBOLD_BASE64 } from './fontData/interSemiBold.js';

export interface Fontit {
  normaali: PDFFont;
  lihava: PDFFont;
}

/** base64 → tavut; atob on käytettävissä sekä Node 22:ssa että selaimessa. */
function tavuiksi(base64: string): Uint8Array {
  const binaari = atob(base64);
  const tavut = new Uint8Array(binaari.length);
  for (let i = 0; i < binaari.length; i++) tavut[i] = binaari.charCodeAt(i);
  return tavut;
}

let regular: Uint8Array | undefined;
let semibold: Uint8Array | undefined;

/**
 * Upottaa Inter Regular + SemiBold -fontit (subset). `customName` kiinnittää osajoukon
 * nimen: pdf-lib lisäisi muuten fontin nimeen satunnaisen päätteen ja PDF ei olisi
 * deterministinen. Nimi noudattaa PDF:n osajoukkokäytäntöä (6 isoa kirjainta + '+').
 */
export async function lataaFontit(doc: PDFDocument): Promise<Fontit> {
  doc.registerFontkit(fontkit);
  regular ??= tavuiksi(INTER_REGULAR_BASE64);
  semibold ??= tavuiksi(INTER_SEMIBOLD_BASE64);
  return {
    normaali: await doc.embedFont(regular, { subset: true, customName: 'PENNIA+Inter-Regular' }),
    lihava: await doc.embedFont(semibold, { subset: true, customName: 'PENNIB+Inter-SemiBold' }),
  };
}
