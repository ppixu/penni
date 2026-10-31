import type { TositeVienti } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { tositeTyyppiLabel, tyypinVoiVaihtaa, vientienSumma } from './tosite.js';

const vienti = (debet: number, kredit: number): TositeVienti => ({
  tili: 1900,
  debet: Euro.fromCents(debet),
  kredit: Euro.fromCents(kredit),
  pvm: '2026-06-26',
  alvKoodi: 0,
  alvProsentti: 0,
});

describe('vientienSumma', () => {
  it('summaa debetit (tositteen bruttosumma) sentteinä', () => {
    expect(vientienSumma([vienti(8640, 0), vienti(0, 8640)])).toBe(8640);
  });
  it('palauttaa 0 tyhjälle', () => {
    expect(vientienSumma([])).toBe(0);
  });
});

describe('tositeTyyppiLabel', () => {
  it.each([
    [100, 'Meno'],
    [200, 'Tulo'],
    [300, 'Siirto'],
    [700, 'Muistio'],
    [210, 'Myyntilasku'],
    [400, 'Tiliote'],
  ])('nimeää tyyppikoodin %d', (koodi, label) => {
    expect(tositeTyyppiLabel(koodi)).toBe(label);
  });
  it('tuntematon koodi -> "Tosite"', () => {
    expect(tositeTyyppiLabel(12345)).toBe('Tosite');
  });
});

describe('tyypinVoiVaihtaa', () => {
  const tosite = (tyyppi: number, extra: Record<string, unknown> = {}) =>
    ({ tyyppi, ...extra }) as Parameters<typeof tyypinVoiVaihtaa>[0];
  it('tavallisen tositteen tyypin voi vaihtaa (myös tiliote, muu ja tuonti)', () => {
    for (const t of [0, 90, 100, 200, 300, 400, 500, 700, 800]) {
      expect(tyypinVoiVaihtaa(tosite(t))).toBe(true);
    }
  });
  it('laskutyypit pitävät tyyppinsä', () => {
    for (const t of [110, 120, 210, 214, 216]) expect(tyypinVoiVaihtaa(tosite(t))).toBe(false);
  });
  it('järjestelmätositteet (>= 1000) pitävät tyyppinsä', () => {
    for (const t of [1000, 9010, 9100, 9930]) expect(tyypinVoiVaihtaa(tosite(t))).toBe(false);
  });
  it('laskutietoja kantava tosite pitää tyyppinsä', () => {
    expect(tyypinVoiVaihtaa(tosite(100, { erapvm: '2026-05-01' }))).toBe(false);
    expect(tyypinVoiVaihtaa(tosite(100, { laskupvm: '2026-05-01' }))).toBe(false);
    expect(tyypinVoiVaihtaa(tosite(200, { numero: '1001' }))).toBe(false);
    expect(tyypinVoiVaihtaa(tosite(200, { alkuperainenTosite: 3 }))).toBe(false);
    expect(tyypinVoiVaihtaa(tosite(200, { rivit: [{ myyntiKpl: 1 }] }))).toBe(false);
    expect(tyypinVoiVaihtaa(tosite(200, { rivit: [] }))).toBe(true);
  });
});
