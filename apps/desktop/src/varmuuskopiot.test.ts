import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  kasinOtettavanNimi,
  otaPaivittainenVarmuuskopio,
  varmuuskopioKansio,
} from './varmuuskopiot.js';

const juuri = mkdtempSync(join(tmpdir(), 'penni-varmuuskopiot-'));
afterAll(() => rmSync(juuri, { recursive: true, force: true }));

/** Kopiointifunktio, joka vain luo kohdetiedoston — kuten SqliteStorage.varmuuskopioi. */
const kopioi = vi.fn((kohde: string) => writeFileSync(kohde, 'kopio'));

function uusiKirja(nimi: string): string {
  const kansio = mkdtempSync(join(juuri, 'kirjat-'));
  const polku = join(kansio, nimi);
  writeFileSync(polku, 'kirja');
  return polku;
}

describe('otaPaivittainenVarmuuskopio', () => {
  it('ottaa kopion kirjan viereiseen varmuuskopiot-kansioon päivämäärällä nimettynä', () => {
    const kirja = uusiKirja('Oy.penni');
    const kohde = otaPaivittainenVarmuuskopio(kirja, kopioi, '2026-10-11');
    expect(kohde).toBe(join(varmuuskopioKansio(kirja), 'Oy-2026-10-11.penni'));
    expect(readdirSync(varmuuskopioKansio(kirja))).toEqual(['Oy-2026-10-11.penni']);
  });

  it('ottaa vain yhden kopion päivässä', () => {
    const kirja = uusiKirja('Oy.penni');
    otaPaivittainenVarmuuskopio(kirja, kopioi, '2026-10-11');
    kopioi.mockClear();
    expect(otaPaivittainenVarmuuskopio(kirja, kopioi, '2026-10-11')).toBeNull();
    expect(kopioi).not.toHaveBeenCalled();
  });

  it('säilyttää 14 uusinta ja poistaa vanhemmat', () => {
    const kirja = uusiKirja('Oy.penni');
    for (let paiva = 1; paiva <= 16; paiva++) {
      otaPaivittainenVarmuuskopio(kirja, kopioi, `2026-09-${String(paiva).padStart(2, '0')}`);
    }
    const jaljella = readdirSync(varmuuskopioKansio(kirja)).sort();
    expect(jaljella).toHaveLength(14);
    expect(jaljella[0]).toBe('Oy-2026-09-03.penni');
    expect(jaljella[13]).toBe('Oy-2026-09-16.penni');
  });

  it('ei koske saman kansion muiden kirjojen eikä käsin otettuihin kopioihin', () => {
    const kirja = uusiKirja('Oy.penni');
    const kansio = varmuuskopioKansio(kirja);
    mkdirSync(kansio, { recursive: true });
    // Toinen kirja, jonka nimi alkaa samalla etuliitteellä, ja käsin otettu kopio.
    const vieraat = [
      'Oy-testi-2026-01-01.penni',
      'Oy-varmuuskopio-2026-01-01.penni',
      'Muu-2026-01-01.penni',
    ];
    for (const nimi of vieraat) writeFileSync(join(kansio, nimi), 'x');
    for (let paiva = 1; paiva <= 15; paiva++) {
      otaPaivittainenVarmuuskopio(kirja, kopioi, `2026-09-${String(paiva).padStart(2, '0')}`);
    }
    const jaljella = readdirSync(kansio);
    for (const nimi of vieraat) expect(jaljella).toContain(nimi);
    expect(jaljella.filter((n) => /^Oy-\d{4}-\d{2}-\d{2}\.penni$/.test(n))).toHaveLength(14);
  });
});

describe('kasinOtettavanNimi', () => {
  it('ehdottaa kirjan viereen nimeä, joka ei sekoitu automaattisiin kopioihin', () => {
    expect(kasinOtettavanNimi('/a/b/Oy.penni', '2026-10-11')).toBe(
      '/a/b/Oy-varmuuskopio-2026-10-11.penni',
    );
  });
});
