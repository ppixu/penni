import { describe, expect, it } from 'vitest';
import { code128c } from './code128.js';

/**
 * Code 128 -symbolien leveydet arvoille 0..102 sekä start C (105), ISO/IEC 15417.
 * Taulukko on tässä testissä erikseen (ei tuotu toteutuksesta) ja otettu
 * python-barcode 0.16.1:n `barcode.charsets.code128.CODES`-taulukosta ajojen pituuksina.
 */
const TAULUKKO = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 ' +
  '112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 ' +
  '311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 ' +
  '112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
  '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 ' +
  '122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 ' +
  '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
  '114311 411113 411311 113141 114131 311141 411131'
).split(' ');
const START_C = '211232';
const STOP = '2331112';

/** Moduulijono ('1' = palkki, '0' = väli) -> vuorottelevat leveydet. */
function ajot(moduulit: string): number[] {
  const tulos: number[] = [];
  for (let i = 0; i < moduulit.length; ) {
    let j = i;
    while (j < moduulit.length && moduulit[j] === moduulit[i]) j++;
    tulos.push(j - i);
    i = j;
  }
  return tulos;
}

const numerot = (kuvio: string) => [...kuvio].map(Number);
const symboli = (arvo: number) => numerot(TAULUKKO[arvo] ?? '');

// Keksitty virtuaaliviivakoodi (54 numeroa): testi-IBAN FI21 1234 5600 0007 85,
// 1 234,56 €, viite 1000193, eräpäivä 15.6.2026.
const V = '421123456000007850012345600000000000000001000193260615';

describe('code128c', () => {
  it('hylkää väärän pituisen tai ei-numeerisen syötteen', () => {
    expect(code128c('1'.repeat(53))).toBeNull();
    expect(code128c('1'.repeat(55))).toBeNull();
    expect(code128c('x'.repeat(54))).toBeNull();
    expect(code128c(`${'1'.repeat(53)}a`)).toBeNull();
    expect(code128c('')).toBeNull();
  });

  it('tuottaa 332 moduulia, start C -alun ja stop-lopun', () => {
    const w = code128c(V);
    expect(w).not.toBeNull();
    if (!w) return;
    expect(w.reduce((a, b) => a + b, 0)).toBe(11 + 27 * 11 + 11 + 13);
    expect(w).toHaveLength(6 + 27 * 6 + 6 + 7);
    expect(w.slice(0, 6)).toEqual([2, 1, 1, 2, 3, 2]);
    expect(w.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
  });

  it('numeroparit koodataan taulukon mukaisiksi symboleiksi', () => {
    const w = code128c(V);
    expect(w).not.toBeNull();
    if (!w) return;
    for (let i = 0; i < 27; i++) {
      const arvo = Number(V.slice(i * 2, i * 2 + 2));
      expect(w.slice(6 + i * 6, 12 + i * 6)).toEqual(symboli(arvo));
    }
  });

  it('tarkistesymboli vastaa kaavaa (105 + Σ i × pari_i) mod 103', () => {
    const w = code128c(V);
    expect(w).not.toBeNull();
    if (!w) return;
    let summa = 105;
    for (let i = 1; i <= 27; i++) summa += i * Number(V.slice((i - 1) * 2, i * 2));
    const arvo = summa % 103;
    const alku = 6 + 27 * 6;
    expect(w.slice(alku, alku + 6)).toEqual(symboli(arvo));
  });

  it('start C on taulukon arvo 105 ja stop-kuvio 2331112', () => {
    const w = code128c(V);
    expect(w?.slice(0, 6).join('')).toBe(START_C);
    expect(w?.slice(-7).join('')).toBe(STOP);
  });

  // Tunnetut vastaukset riippumattomasta enkooderista: python-barcode 0.16.1,
  // `barcode.codex.Code128(syöte).build()[0]` ('1' = palkki, '0' = väli, ilman hiljaista
  // aluetta; Code128 valitsee itse alajoukon C kaikille 54 numerolle).
  const TUNNETUT: [string, string][] = [
    [
      V,
      '11010011100101101110001100010010011101101110101110110001110111101011011001100110110011001100001010011000101110110011011001110110111010111011000111011110101101100110011011001100110110011001101100110011011001100110110011001101100110011001101100110110011001100110110010100011110111001001101001100100010111001100101000011001100011101011',
    ],
    [
      '404142434445464748495051525354555657585960616263646566',
      '11010011100110001010001100010001010110111000101100011101000110111010111011000101110001101000111011011101110110110100011101100010111011011101000110111000101101110111011101011000111010001101110001011011101101000111011000101110001101011101111010110010000101111000101010100110000101000011001001011000010010000110100011011101100011101011',
    ],
    [
      '0'.repeat(54),
      '11010011100110110011001101100110011011001100110110011001101100110011011001100110110011001101100110011011001100110110011001101100110011011001100110110011001101100110011011001100110110011001101100110011011001100110110011001101100110011011001100110110011001101100110011011001100110110011001101100110011011001100110011001101100011101011',
    ],
  ];

  it.each(TUNNETUT)('vastaa python-barcode-enkooderia: %s', (syote, moduulit) => {
    expect(moduulit).toHaveLength(332);
    expect(code128c(syote)).toEqual(ajot(moduulit));
  });
});
