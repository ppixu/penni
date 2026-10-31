/** Pyöristä millisekunnit sadasosiin (tulosteet ovat lukuja, ei näennäistarkkuutta). */
export const pyorista = (ms: number): number => Math.round(ms * 100) / 100;

/** Persentiili lähimmän sijan menetelmällä (p väliltä 0–100); tyhjällä joukolla NaN. */
export function persentiili(arvot: readonly number[], p: number): number {
  if (arvot.length === 0) return Number.NaN;
  const jarjestetty = [...arvot].sort((a, b) => a - b);
  const sija = Math.max(1, Math.ceil((p / 100) * jarjestetty.length));
  return jarjestetty[Math.min(sija, jarjestetty.length) - 1] as number;
}

export interface Jakauma {
  n: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  keskiarvoMs: number;
}

/** Aikajakauman tunnusluvut millisekunteina. */
export function jakauma(arvot: readonly number[]): Jakauma {
  const summa = arvot.reduce((s, x) => s + x, 0);
  return {
    n: arvot.length,
    minMs: pyorista(Math.min(...arvot)),
    p50Ms: pyorista(persentiili(arvot, 50)),
    p95Ms: pyorista(persentiili(arvot, 95)),
    maxMs: pyorista(Math.max(...arvot)),
    keskiarvoMs: pyorista(summa / arvot.length),
  };
}

/** Deterministinen pseudosatunnaisgeneraattori (mulberry32): sama siemen, sama aineisto. */
export function satunnainen(siemen: number): () => number {
  let a = siemen >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
