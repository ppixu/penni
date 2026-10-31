import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onkoTekstia, pdfTeksti } from '@penni/luku';
import type { KitsasLiite } from './kitsasLuku.js';

export { onkoTekstia, pdfTeksti };

const paate = (mime: string): string =>
  mime.includes('pdf')
    ? '.pdf'
    : mime.includes('png')
      ? '.png'
      : mime.includes('webp')
        ? '.webp'
        : '.jpg';

/** OCR image/scanned bytes to text via the `tesseract` CLI. Empty string if the binary is missing. */
export function ocrTeksti(tavut: Uint8Array, mime: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kuitti-ocr-'));
  const tiedosto = join(dir, `kuitti${paate(mime)}`);
  try {
    writeFileSync(tiedosto, tavut);
    // `tesseract <input> stdout -l fin+eng` → recognized text on stdout.
    return execFileSync('tesseract', [tiedosto, 'stdout', '-l', 'fin+eng'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return ''; // binary missing or OCR failed → treated as unreadable
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Acquire receipt text: PDF text layer first, OCR fallback for images/scans. */
export async function hankiTeksti(
  liite: KitsasLiite,
): Promise<{ teksti: string; lahde: 'pdf' | 'ocr' | 'tyhja' }> {
  if (liite.mime.includes('pdf')) {
    const teksti = await pdfTeksti(liite.data).catch(() => '');
    if (onkoTekstia(teksti)) return { teksti, lahde: 'pdf' };
  }
  const ocr = ocrTeksti(liite.data, liite.mime);
  if (onkoTekstia(ocr)) return { teksti: ocr, lahde: 'ocr' };
  return { teksti: '', lahde: 'tyhja' };
}
