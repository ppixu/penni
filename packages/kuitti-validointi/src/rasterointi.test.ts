import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exifOrientaatio } from './exif.js';
import {
  kuvanMitat,
  normalisoiKuva,
  orientaatioArgv,
  rasteroi,
  rasterointiArgv,
} from './rasterointi.js';
import { FIKSTUURIHAKEMISTO } from './synteettinen/generoi.js';
import { ocrTeksti } from './tekstinLuku.js';

describe('rasterointiArgv', () => {
  it('rajaa ensimmäiseen sivuun ja skaalaa pitkän sivun 1100 pikseliin', () => {
    const argv = rasterointiArgv('/tmp/x/kuitti.pdf', '/tmp/x/sivu');
    expect(argv).toEqual([
      '-png',
      '-r',
      '200',
      '-scale-to',
      '1100',
      '-f',
      '1',
      '-l',
      '1',
      '/tmp/x/kuitti.pdf',
      '/tmp/x/sivu',
    ]);
  });
});

describe('rasteroi', () => {
  it('palauttaa kuvatavut sellaisenaan eikä kutsu pdftoppmia', () => {
    const tavut = new Uint8Array([1, 2, 3]);
    const kuva = rasteroi(tavut, 'image/jpeg', 'ei-ole-olemassa-komentoa');
    expect(kuva.mime).toBe('image/jpeg');
    expect([...kuva.tavut]).toEqual([1, 2, 3]);
  });

  it('heittää selkeän virheen kun pdftoppm puuttuu', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    expect(() => rasteroi(pdf, 'application/pdf', 'ei-ole-olemassa-komentoa')).toThrow(/pdftoppm/);
  });
});

describe('kuvanMitat', () => {
  it('lukee PNG:n ja JPEG:n mitat fikstuureista', () => {
    const png = new Uint8Array(readFileSync(join(FIKSTUURIHAKEMISTO, '01-kauppakuitti.png')));
    const jpg = new Uint8Array(readFileSync(join(FIKSTUURIHAKEMISTO, '10-valokuva-exif.jpg')));
    expect(kuvanMitat(png)).toEqual({ leveys: 670, korkeus: 606 });
    // tallennettu sivuttain: leveä, vaikka kuva näytetään pystyssä
    expect(kuvanMitat(jpg)).toEqual({ leveys: 1250, korkeus: 870 });
  });

  it('palauttaa undefined tunnistamattomalle datalle', () => {
    expect(kuvanMitat(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

describe('orientaatioArgv', () => {
  it('ei tee mitään orientaatiolle 1 ja tuntemattomille', () => {
    expect(orientaatioArgv(1)).toEqual([]);
    expect(orientaatioArgv(0)).toEqual([]);
    expect(orientaatioArgv(9)).toEqual([]);
  });

  it('kiertää puhelimen pystykuvat: 6 = 90° myötäpäivään, 8 = 270°, 3 = 180°', () => {
    expect(orientaatioArgv(6)).toEqual(['--rotate', '90']);
    expect(orientaatioArgv(8)).toEqual(['--rotate', '270']);
    expect(orientaatioArgv(3)).toEqual(['--rotate', '180']);
  });

  it('peilausorientaatiot 2, 4, 5, 7 sisältävät peilauksen', () => {
    for (const o of [2, 4, 5, 7]) expect(orientaatioArgv(o)).toContain('-f');
  });
});

const sipsOlemassa = ((): boolean => {
  try {
    execFileSync('sips', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/**
 * Tesseract on käytössä vain jos se oikeasti lukee tunnetun kuvan. Pelkkä `--version` ei riitä:
 * esim. turbon strict-env pudottaa TMPDIR:n, ja eristetyssä ympäristössä lapsiprosessi ei silloin
 * näe /tmp-tiedostoja — OCR palauttaa tyhjää ilman että binääri "puuttuu".
 */
const tesseractToimii = ((): boolean => {
  try {
    const png = new Uint8Array(readFileSync(join(FIKSTUURIHAKEMISTO, '01-kauppakuitti.png')));
    return /TESTI MARKET/.test(ocrTeksti(png, 'image/png'));
  } catch {
    return false;
  }
})();

const valokuvaTavut = (): Uint8Array =>
  new Uint8Array(readFileSync(join(FIKSTUURIHAKEMISTO, '10-valokuva-exif.jpg')));

describe('normalisoiKuva', () => {
  it('palauttaa pystyssä olevan, riittävän pienen kuvan täsmälleen samana oliona', () => {
    const png = {
      tavut: new Uint8Array(readFileSync(join(FIKSTUURIHAKEMISTO, '01-kauppakuitti.png'))),
      mime: 'image/png',
    };
    expect(normalisoiKuva(png, 'ei-ole-olemassa-komentoa')).toBe(png);
  });

  it('ohittaa muut mimet (pdf, webp)', () => {
    const k = { tavut: new Uint8Array([1, 2, 3, 4]), mime: 'image/webp' };
    expect(normalisoiKuva(k, 'ei-ole-olemassa-komentoa')).toBe(k);
  });

  it('heittää selkeän virheen kun sips puuttuu mutta korjaus tarvitaan', () => {
    expect(() =>
      normalisoiKuva({ tavut: valokuvaTavut(), mime: 'image/jpeg' }, 'ei-ole-olemassa-komentoa'),
    ).toThrow(/sips/);
  });

  it.skipIf(!sipsOlemassa)(
    'soveltaa EXIF-orientaation, nollaa tagin ja rajaa pitkän sivun 1100 pikseliin',
    () => {
      const ennen = valokuvaTavut();
      expect(exifOrientaatio(ennen)).toBe(6);
      const jalkeen = normalisoiKuva({ tavut: ennen, mime: 'image/jpeg' });
      expect(jalkeen.mime).toBe('image/jpeg');
      expect(exifOrientaatio(jalkeen.tavut)).toBe(1); // tagi nollattu: ei tuplakiertoa palvelimella
      const mitat = kuvanMitat(jalkeen.tavut);
      // 1250×870 sivuttain → 870×1250 pystyssä → pitkä sivu 1100: 766×1100
      expect(mitat?.korkeus).toBe(1100);
      expect(mitat?.leveys).toBeLessThan(mitat?.korkeus ?? 0);
    },
  );

  it.skipIf(!sipsOlemassa)('pienentää pystyssä olevan liian ison PNG:n ilman kiertoa', () => {
    // Fikstuuri 1 on 670×606 eli alle rajan; venytä se 1600×1800:ksi, jotta pienennys tapahtuu.
    const dir = mkdtempSync(join(tmpdir(), 'norm-test-'));
    try {
      const iso = join(dir, 'iso.png');
      execFileSync(
        'sips',
        ['-z', '1800', '1600', join(FIKSTUURIHAKEMISTO, '01-kauppakuitti.png'), '--out', iso],
        {
          stdio: 'ignore',
        },
      );
      const tulos = normalisoiKuva({ tavut: new Uint8Array(readFileSync(iso)), mime: 'image/png' });
      expect(kuvanMitat(tulos.tavut)).toEqual({ leveys: 977, korkeus: 1100 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!sipsOlemassa || !tesseractToimii)(
    'kierron suunta on oikea: Tesseract lukee normalisoidun puhelinkuvan, ei sivuttaista alkuperäistä',
    () => {
      const kuva = normalisoiKuva({ tavut: valokuvaTavut(), mime: 'image/jpeg' });
      const luettu = ocrTeksti(kuva.tavut, kuva.mime);
      expect(luettu, `OCR-teksti: ${JSON.stringify(luettu)}`).toMatch(/TESTI KIOSKI/);
      expect(ocrTeksti(valokuvaTavut(), 'image/jpeg')).not.toMatch(/TESTI KIOSKI/);
    },
  );

  it.skipIf(!sipsOlemassa)('rasteroi() ajaa kuvat normalisoinnin läpi', () => {
    const kuva = rasteroi(valokuvaTavut(), 'image/jpeg');
    expect(exifOrientaatio(kuva.tavut)).toBe(1);
    expect(
      Math.max(kuvanMitat(kuva.tavut)?.leveys ?? 0, kuvanMitat(kuva.tavut)?.korkeus ?? 0),
    ).toBe(1100);
  });
});
