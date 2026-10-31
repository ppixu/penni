/**
 * Poimii assistentin tuottaman tekstin transformers.js:n image-text-to-text -tulosteesta.
 * Puhdas ja versioriippumaton: sietää sekä merkkijono- että viestilistamuotoa.
 */
export function poimiVastaus(tulos: unknown): string {
  const eka = Array.isArray(tulos) ? tulos[0] : tulos;
  if (eka && typeof eka === 'object' && 'generated_text' in eka) {
    const g = (eka as { generated_text: unknown }).generated_text;
    if (typeof g === 'string') return g;
    if (Array.isArray(g)) {
      const viim = g[g.length - 1];
      if (viim && typeof viim === 'object' && 'content' in viim) {
        const c = (viim as { content: unknown }).content;
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) {
          const osa = c.find(
            (x) => x && typeof x === 'object' && (x as { type?: unknown }).type === 'text',
          );
          const teksti = (osa as { text?: unknown } | undefined)?.text;
          if (typeof teksti === 'string') return teksti;
        }
      }
    }
  }
  return typeof tulos === 'string' ? tulos : (JSON.stringify(tulos) ?? '');
}
