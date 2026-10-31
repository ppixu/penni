import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pdfTekstiLukija } from './kuittiLukija.js';
import { luoTestiPdf } from './testi/luoTestiPdf.js';

let kansio: string;
beforeAll(() => {
  kansio = mkdtempSync(join(tmpdir(), 'luku-kuitti-'));
});
afterAll(() => rmSync(kansio, { recursive: true, force: true }));

describe('pdfTekstiLukija', () => {
  it('lukee digitaalisen kuitin myyjän ja summan', async () => {
    const polku = join(kansio, 'pilvipalvelu.pdf');
    writeFileSync(
      polku,
      luoTestiPdf(['Pilvipalvelu Ltd', 'Date: 04/04/2026', 'Total: 20,00 EUR', 'VAT 25,5%: 4,06']),
    );
    const tulos = await pdfTekstiLukija().lue(polku);
    expect(tulos.ok).toBe(true);
    if (tulos.ok) expect(tulos.kuitti.bruttoSumma).toBe(2000);
  });

  it('palauttaa ok:false kun tekstikerrosta ei ole (kuva tai skannaus)', async () => {
    const polku = join(kansio, 'tyhja.pdf');
    writeFileSync(polku, luoTestiPdf([]));
    const tulos = await pdfTekstiLukija().lue(polku);
    expect(tulos).toEqual({ ok: false, virhe: expect.stringContaining('tekstikerrosta') });
  });
});
