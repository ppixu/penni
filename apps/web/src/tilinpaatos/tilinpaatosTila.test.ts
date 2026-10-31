import { describe, expect, it } from 'vitest';
import { tilinpaatosTila } from './tilinpaatosTila.js';

const doc = (vahvistettu: string | null) => ({ tilikausi: { loppuu: '2026-12-31' }, vahvistettu });

describe('tilinpaatosTila', () => {
  it('avoin kun rajaa ei ole', () => {
    expect(tilinpaatosTila(doc(null), null)).toBe('avoin');
  });
  it('avoin kun raja on ennen kauden loppua', () => {
    expect(tilinpaatosTila(doc(null), '2026-06-30')).toBe('avoin');
  });
  it('lukittu kun raja on tasan kauden lopussa', () => {
    expect(tilinpaatosTila(doc(null), '2026-12-31')).toBe('lukittu');
  });
  it('lukittu kun raja on kauden lopun jälkeen', () => {
    expect(tilinpaatosTila(doc(null), '2027-01-31')).toBe('lukittu');
  });
  it('vahvistettu voittaa lukitustilan', () => {
    expect(tilinpaatosTila(doc('2026-06-01'), '2026-12-31')).toBe('vahvistettu');
  });
});
