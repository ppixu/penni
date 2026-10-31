import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Kuitti } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { exifOrientaatio } from '../exif.js';
import { FIKSTUURIT, TOTUUDET } from './fikstuurit.js';
import { FIKSTUURIHAKEMISTO } from './generoi.js';
import { kirjoitaPdf, winAnsi } from './pdf.js';
import { alvSumma, pisteyta } from './pisteyta.js';

describe('fikstuurit', () => {
  it('totuus.json vastaa kooditiedoston määrittelyjä (aja generoi-fikstuurit jos ei)', () => {
    const json = JSON.parse(
      readFileSync(join(FIKSTUURIHAKEMISTO, 'totuus.json'), 'utf8'),
    ) as unknown;
    expect(json).toEqual(TOTUUDET);
  });

  it('jokaisella totuudella on tiedosto, ja yhteiskoko on pieni (< 2 MB)', () => {
    let yhteensa = 0;
    for (const t of TOTUUDET) {
      const polku = join(FIKSTUURIHAKEMISTO, t.tiedosto);
      expect(existsSync(polku), t.tiedosto).toBe(true);
      yhteensa += statSync(polku).size;
    }
    expect(yhteensa).toBeLessThan(2_000_000);
  });

  it('sisältää veloituksen tapaukset: ei hintaa, tyhjä ALV, monialv, ulkomainen, kierretty', () => {
    expect(TOTUUDET).toHaveLength(10);
    expect(TOTUUDET.filter((t) => t.brutto === null).length).toBeGreaterThanOrEqual(2);
    expect(
      TOTUUDET.filter((t) => t.alv === null && t.brutto !== null).length,
    ).toBeGreaterThanOrEqual(1);
    expect(TOTUUDET.some((t) => t.myyja.includes('Cloud'))).toBe(true);
    expect(new Set(TOTUUDET.map((t) => t.tiedosto)).size).toBe(TOTUUDET.length);
  });

  it('EXIF-fikstuurissa on oikea orientaatiotagi 6', () => {
    const f = FIKSTUURIT.find((x) => x.muoto === 'jpg-exif');
    expect(f?.exif).toBe(6);
    const tavut = new Uint8Array(readFileSync(join(FIKSTUURIHAKEMISTO, f?.totuus.tiedosto ?? '')));
    expect(exifOrientaatio(tavut)).toBe(6);
  });

  it('summat ovat järkeviä: ALV <= brutto, kaikki kokonaislukusentteinä', () => {
    for (const t of TOTUUDET) {
      if (t.brutto !== null) {
        expect(Number.isInteger(t.brutto), t.tiedosto).toBe(true);
        if (t.alv !== null) expect(t.alv).toBeLessThanOrEqual(t.brutto);
      }
    }
  });
});

describe('pdf', () => {
  it('kirjoittaa kelvollisen PDF-rungon ja WinAnsi-tavut ääkkösille ja €:lle', () => {
    const pdf = kirjoitaPdf({
      leveys: 100,
      korkeus: 100,
      tekstit: [{ x: 1, y: 1, teksti: 'Äö (5 €)', fontti: 'Courier', koko: 10 }],
    });
    const teksti = Buffer.from(pdf).toString('latin1');
    expect(teksti.startsWith('%PDF-1.4')).toBe(true);
    expect(teksti.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(teksti).toContain('\\(5 \x80\\)');
    expect(teksti).toContain('\xc4\xf6');
    expect([...winAnsi('ä€')]).toEqual([0xe4, 0x80]);
  });

  it('on deterministinen', () => {
    const f = FIKSTUURIT[0];
    if (!f) throw new Error('ei fikstuureja');
    expect(Buffer.from(kirjoitaPdf(f.sivu)).equals(Buffer.from(kirjoitaPdf(f.sivu)))).toBe(true);
  });
});

const kuitti = (o: Partial<Kuitti>): Kuitti => ({ valuutta: 'EUR', alv: [], ...o });
const pTotuus = {
  tiedosto: 'x',
  kuvaus: 'x',
  pvm: '2026-01-01',
  myyja: 'Testi Oy',
};

describe('pisteyta', () => {
  it('täysi osuma kun kaikki kentät täsmäävät', () => {
    const p = pisteyta(
      1,
      { ...pTotuus, brutto: 1655, alv: 336 },
      kuitti({
        pvm: '2026-01-01',
        myyja: 'Testi Oy',
        bruttoSumma: 1655,
        alv: [{ kanta: 25.5, vero: 336 }],
      }),
    );
    expect(p.tulos.taysinTasmaa).toBe(true);
    expect(p.luettu).toBe(true);
    expect(p.keksittyBrutto || p.keksittyAlv).toBe(false);
  });

  it('keksitty brutto: totuudessa ei hintaa mutta sarake palautti summan', () => {
    const t = { ...pTotuus, brutto: null, alv: null };
    const keksi = pisteyta(1, t, kuitti({ bruttoSumma: 3794673096 }));
    expect(keksi.keksittyBrutto).toBe(true);
    expect(keksi.tulos.kentat.find((k) => k.nimi === 'brutto')?.ok).toBe(false);
    const rehellinen = pisteyta(1, t, kuitti({ pvm: '2026-01-01', myyja: 'Testi Oy' }));
    expect(rehellinen.keksittyBrutto).toBe(false);
    expect(rehellinen.tulos.kentat.find((k) => k.nimi === 'brutto')?.ok).toBe(true);
  });

  it('keksitty ALV: tyhjä ALV-rivi mutta sarake palautti positiivisen veron; nolla ei ole keksintä', () => {
    const t = { ...pTotuus, brutto: 47500, alv: null };
    const keksi = pisteyta(1, t, kuitti({ bruttoSumma: 47500, alv: [{ kanta: 24, vero: 5938 }] }));
    expect(keksi.keksittyAlv).toBe(true);
    const nolla = pisteyta(1, t, kuitti({ bruttoSumma: 47500, alv: [{ kanta: 0, vero: 0 }] }));
    expect(nolla.keksittyAlv).toBe(false);
    expect(nolla.tulos.kentat.find((k) => k.nimi === 'alv')?.ok).toBe(true);
  });

  it('totuus alv 0 hyväksyy sekä 0:n että puuttuvan; väärä summa epäonnistuu', () => {
    const t = { ...pTotuus, brutto: 12000, alv: 0 };
    expect(
      pisteyta(1, t, kuitti({ bruttoSumma: 12000 })).tulos.kentat.find((k) => k.nimi === 'alv')?.ok,
    ).toBe(true);
    expect(
      pisteyta(
        1,
        t,
        kuitti({ bruttoSumma: 12000, alv: [{ kanta: 25.5, vero: 2400 }] }),
      ).tulos.kentat.find((k) => k.nimi === 'alv')?.ok,
    ).toBe(false);
  });

  it('epäonnistunut luku on luku-rivi eikä koskaan keksintö', () => {
    const p = pisteyta(1, { ...pTotuus, brutto: null, alv: null }, undefined);
    expect(p.luettu).toBe(false);
    expect(p.keksittyBrutto).toBe(false);
    expect(p.tulos.kentat).toEqual([{ nimi: 'luku', ok: false, odotettu: 'kuitti', saatu: '—' }]);
  });

  it('alvSumma laskee verot yhteen ja palauttaa undefined kun veroja ei luettu', () => {
    expect(
      alvSumma(
        kuitti({
          alv: [
            { kanta: 14, vero: 154 },
            { kanta: 25.5, vero: 510 },
          ],
        }),
      ),
    ).toBe(664);
    expect(alvSumma(kuitti({ alv: [{ kanta: 14 }] }))).toBeUndefined();
    expect(alvSumma(kuitti({}))).toBeUndefined();
  });
});
