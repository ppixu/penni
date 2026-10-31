/**
 * Code 128, alajoukko C: pankin virtuaaliviivakoodin (54 numeroa) koodaus palkki- ja
 * väliviivojen leveyksiksi. Kitsas-pariteetti: kitsas-source laskunalaosa.cpp:413-445.
 */

/** Symbolien 0..102 leveydet (ISO/IEC 15417): palkki, väli, palkki, väli, palkki, väli. */
const SYMBOLIT: readonly string[] = (
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

const START_C = 105;
const START_C_KUVIO = '211232';
/** Stop-symboli: 13 moduulia, päättyy päätepalkkiin. */
const STOP_KUVIO = '2331112';

const PARIA = 27;

function leveydet(kuvio: string): number[] {
  return [...kuvio].map(Number);
}

function symboli(arvo: number): number[] {
  const kuvio = SYMBOLIT[arvo];
  if (kuvio === undefined) throw new Error(`Code 128 -symbolia ${arvo} ei ole`);
  return leveydet(kuvio);
}

/**
 * Koodaa 54-numeroisen virtuaaliviivakoodin Code 128C:ksi. Palauttaa palkkien ja välien
 * moduulileveydet vuorotellen palkista alkaen (start C, 27 numeroparia, tarkiste, stop),
 * yhteensä 332 moduulia. Palauttaa `null`, ellei syöte ole täsmälleen 54 numeroa.
 */
export function code128c(digits: string): number[] | null {
  if (!/^[0-9]{54}$/.test(digits)) return null;

  const tulos = leveydet(START_C_KUVIO);
  let summa = START_C;
  for (let i = 1; i <= PARIA; i++) {
    const arvo = Number(digits.slice((i - 1) * 2, i * 2));
    summa += i * arvo;
    tulos.push(...symboli(arvo));
  }
  tulos.push(...symboli(summa % 103), ...leveydet(STOP_KUVIO));
  return tulos;
}
