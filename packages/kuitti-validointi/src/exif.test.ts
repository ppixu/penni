import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asetaExifOrientaatio, exifOrientaatio } from './exif.js';
import { FIKSTUURIHAKEMISTO } from './synteettinen/generoi.js';

const valokuva = new Uint8Array(readFileSync(join(FIKSTUURIHAKEMISTO, '10-valokuva-exif.jpg')));

/** Pienin mahdollinen JPEG-runko: SOI + APP0(JFIF) + EOI. */
const MINIJPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

describe('exifOrientaatio', () => {
  it('lukee fikstuurin orientaation 6', () => {
    expect(exifOrientaatio(valokuva)).toBe(6);
  });

  it('palauttaa 1 kun EXIF-tagia ei ole, ja muille kuin JPEG:eille', () => {
    expect(exifOrientaatio(MINIJPEG)).toBe(1);
    expect(exifOrientaatio(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe(1);
    expect(exifOrientaatio(new Uint8Array([1, 2]))).toBe(1);
  });

  it('ei kaadu katkenneeseen tai rikkinäiseen EXIF-segmenttiin', () => {
    expect(exifOrientaatio(valokuva.subarray(0, 30))).toBe(1);
    const rikki = asetaExifOrientaatio(MINIJPEG, 6).slice();
    rikki[4] = 0xff; // segmentin pituus järjettömäksi
    rikki[5] = 0xff;
    expect(exifOrientaatio(rikki)).toBe(1);
  });

  it('ei heitä millään katkaisupituudella 0..N (fikstuuri katkaistu joka pituuteen)', () => {
    for (let n = 0; n <= valokuva.length; n++) {
      const o = exifOrientaatio(valokuva.slice(0, n));
      expect(o).toBeGreaterThanOrEqual(1);
      expect(o).toBeLessThanOrEqual(8);
    }
  });

  it('ei heitä rikotuilla tavuilla: jokainen EXIF-alueen tavu eri arvoille ja katkaisuille', () => {
    // EXIF-segmentti sijaitsee tiedoston alussa; rikotaan sen jokainen tavu ja katkaistaan
    // rikotusta kopiosta pari pituutta (julistettu segmentti > todellinen puskuri).
    const alue = Math.min(valokuva.length, 160);
    for (let i = 0; i < alue; i++) {
      for (const arvo of [0x00, 0x01, 0x7f, 0xff]) {
        const rikki = valokuva.slice();
        rikki[i] = arvo;
        for (const n of [rikki.length, Math.min(rikki.length, i + 12), Math.min(rikki.length, i)]) {
          const o = exifOrientaatio(rikki.subarray(0, n));
          expect(o).toBeGreaterThanOrEqual(1);
          expect(o).toBeLessThanOrEqual(8);
        }
      }
    }
  });

  it('lukee myös little-endian-TIFFin', () => {
    const tiff = [
      0x49,
      0x49,
      0x2a,
      0x00,
      0x08,
      0x00,
      0x00,
      0x00, // II, IFD0 @8
      0x01,
      0x00, // 1 merkintä
      0x12,
      0x01,
      0x03,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x08,
      0x00,
      0x00,
      0x00, // 0x0112 = 8
      0x00,
      0x00,
      0x00,
      0x00,
    ];
    const runko = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
    const pituus = runko.length + 2;
    const jpeg = Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xe1,
      pituus >> 8,
      pituus & 0xff,
      ...runko,
      0xff,
      0xd9,
    ]);
    expect(exifOrientaatio(jpeg)).toBe(8);
  });

  it('hylkää arvot 1…8 ulkopuolelta', () => {
    const j = asetaExifOrientaatio(MINIJPEG, 9);
    expect(exifOrientaatio(j)).toBe(1);
  });
});

describe('asetaExifOrientaatio', () => {
  it.each([1, 3, 6, 8])('kirjoittaa orientaation %i luettavaksi', (o) => {
    expect(exifOrientaatio(asetaExifOrientaatio(MINIJPEG, o))).toBe(o);
  });

  it('korvaa vanhan tagin eikä jätä kahta EXIF-segmenttiä', () => {
    const uusi = asetaExifOrientaatio(valokuva, 1);
    expect(exifOrientaatio(uusi)).toBe(1);
    let exifSegmentteja = 0;
    for (let i = 2; i + 8 < uusi.length; ) {
      if (uusi[i] !== 0xff || uusi[i + 1] === 0xda) break;
      const pit = ((uusi[i + 2] ?? 0) << 8) | (uusi[i + 3] ?? 0);
      if (uusi[i + 1] === 0xe1 && String.fromCharCode(...uusi.subarray(i + 4, i + 8)) === 'Exif') {
        exifSegmentteja += 1;
      }
      i += 2 + pit;
    }
    expect(exifSegmentteja).toBe(1);
  });

  it('heittää jos syöte ei ole JPEG', () => {
    expect(() => asetaExifOrientaatio(new Uint8Array([1, 2, 3]), 6)).toThrow(/JPEG/);
  });
});
