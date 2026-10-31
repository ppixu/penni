import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asetaExifOrientaatio, exifOrientaatio } from './exif.js';

/** One page image handed to OCR / the vision model. */
export interface Kuva {
  tavut: Uint8Array;
  mime: string;
}

/** Long edge in pixels. 200 dpi A4 is 1700×2200 — more pixels than the model needs; see spec §6. */
const PITKA_SIVU = 1100;

/** Kuvan leveys ja korkeus PNG:n IHDR:stä tai JPEG:n SOF-segmentistä (ilman kirjastoja). Pure. */
export function kuvanMitat(tavut: Uint8Array): { leveys: number; korkeus: number } | undefined {
  const dv = new DataView(tavut.buffer, tavut.byteOffset, tavut.byteLength);
  if (tavut.length >= 24 && tavut[0] === 0x89 && tavut[1] === 0x50) {
    return { leveys: dv.getUint32(16), korkeus: dv.getUint32(20) };
  }
  if (tavut[0] !== 0xff || tavut[1] !== 0xd8) return undefined;
  let paikka = 2;
  while (paikka + 9 <= tavut.length) {
    if (tavut[paikka] !== 0xff) return undefined;
    const merkki = tavut[paikka + 1] ?? 0;
    if (merkki === 0xff) {
      paikka += 1;
      continue;
    }
    const sof = merkki >= 0xc0 && merkki <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(merkki);
    if (sof) return { korkeus: dv.getUint16(paikka + 5), leveys: dv.getUint16(paikka + 7) };
    if (merkki === 0xda) return undefined;
    paikka += 2 + dv.getUint16(paikka + 2);
  }
  return undefined;
}

/**
 * `sips`-argumentit jotka tekevät EXIF-orientaation `o` mukaisesta kuvasta pystyssä olevan.
 * Järjestys on mitattu PIL:n `exif_transpose`-viitettä vasten (5 ja 7 ovat sipsissä toisin päin
 * kuin ajatus "ensin kierto, sitten peilaus" antaisi). Pure — unit-tested.
 */
export function orientaatioArgv(o: number): string[] {
  switch (o) {
    case 2:
      return ['-f', 'horizontal'];
    case 3:
      return ['--rotate', '180'];
    case 4:
      return ['-f', 'vertical'];
    case 5:
      return ['-f', 'horizontal', '--rotate', '90'];
    case 6:
      return ['--rotate', '90'];
    case 7:
      return ['--rotate', '90', '-f', 'horizontal'];
    case 8:
      return ['--rotate', '270'];
    default:
      return [];
  }
}

/**
 * Kuva ennen mitä tahansa mallia: EXIF-orientaatio sovelletaan pikseleihin (ja tagi nollataan,
 * jotta palvelin ei kierrä toiseen kertaan) ja pitkä sivu rajataan PITKA_SIVU:un samoin kuin
 * PDF-rasteroinnissa (spec §3c). Kuva joka on jo pystyssä ja tarpeeksi pieni palautetaan sellaisenaan.
 * Vain JPEG ja PNG; muu mime ohitetaan. `komento` on injektoitava testejä varten.
 */
export function normalisoiKuva(kuva: Kuva, komento = 'sips'): Kuva {
  if (kuva.mime !== 'image/jpeg' && kuva.mime !== 'image/png') return kuva;
  const o = exifOrientaatio(kuva.tavut);
  const mitat = kuvanMitat(kuva.tavut);
  const pitka = mitat === undefined ? 0 : Math.max(mitat.leveys, mitat.korkeus);
  const pienenna = pitka > PITKA_SIVU;
  if (o === 1 && !pienenna) return kuva;

  const jpeg = kuva.mime === 'image/jpeg';
  const dir = mkdtempSync(join(tmpdir(), 'kuitti-kuva-'));
  const sisaan = join(dir, jpeg ? 'sisaan.jpg' : 'sisaan.png');
  const ulos = join(dir, jpeg ? 'ulos.jpg' : 'ulos.png');
  try {
    writeFileSync(sisaan, kuva.tavut);
    const argv = [
      ...orientaatioArgv(o),
      ...(pienenna ? ['-Z', String(PITKA_SIVU)] : []),
      ...(jpeg ? ['-s', 'formatOptions', '90'] : []),
      sisaan,
      '--out',
      ulos,
    ];
    try {
      execFileSync(komento, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      const syy = e instanceof Error ? e.message : String(e);
      throw new Error(
        `${komento} epäonnistui kuvan käsittelyssä (${syy}). Orientaation korjaus ja skaalaus vaativat macOS:n sipsin.`,
      );
    }
    const tavut = new Uint8Array(readFileSync(ulos));
    // sips kopioi vanhan EXIF-tagin sellaisenaan; pikselit on jo kierretty → nollaa tagi.
    return { tavut: jpeg && o !== 1 ? asetaExifOrientaatio(tavut, 1) : tavut, mime: kuva.mime };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** pdftoppm arguments: first page only, PNG, downscaled. Pure — unit-tested. */
export function rasterointiArgv(sisaan: string, ulosPrefix: string): string[] {
  return [
    '-png',
    '-r',
    '200',
    '-scale-to',
    String(PITKA_SIVU),
    '-f',
    '1',
    '-l',
    '1',
    sisaan,
    ulosPrefix,
  ];
}

/**
 * PDF → page-1 PNG via pdftoppm. Images go through `normalisoiKuva` (EXIF orientation applied,
 * long edge capped) — a phone photo must never reach a model sideways or at 4032×3024.
 * `komento` is injectable so tests can exercise the missing-binary path without a real binary.
 */
export function rasteroi(tavut: Uint8Array, mime: string, komento = 'pdftoppm'): Kuva {
  if (!mime.includes('pdf')) return normalisoiKuva({ tavut, mime });

  const dir = mkdtempSync(join(tmpdir(), 'kuitti-raster-'));
  const sisaan = join(dir, 'kuitti.pdf');
  const ulosPrefix = join(dir, 'sivu');
  try {
    writeFileSync(sisaan, tavut);
    try {
      execFileSync(komento, rasterointiArgv(sisaan, ulosPrefix), {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (e) {
      const syy = e instanceof Error ? e.message : String(e);
      throw new Error(
        `pdftoppm epäonnistui (${syy}). Asenna poppler: brew install poppler — rasterointi ei ole valinnainen.`,
      );
    }
    // pdftoppm nimeää tuloksen prefiksin mukaan, esim. "sivu-1.png" tai "sivu-01.png".
    const tiedosto = readdirSync(dir).find((n) => n.startsWith('sivu') && n.endsWith('.png'));
    if (tiedosto === undefined) throw new Error('pdftoppm ei tuottanut PNG-sivua');
    return { tavut: new Uint8Array(readFileSync(join(dir, tiedosto))), mime: 'image/png' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
