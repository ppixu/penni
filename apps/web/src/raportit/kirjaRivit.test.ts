import type { ListattuTosite } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { kirjaRivit, paakirjaTilit, tositeTunniste } from './kirjaRivit';

const e = (n: number) => Euro.fromCents(n);

function tosite(
  id: number,
  pvm: string,
  viennit: [number, number, number, string?][],
  tunniste = id,
): ListattuTosite {
  return {
    id,
    pvm,
    tyyppi: 200,
    tila: 100,
    tunniste,
    sarja: 'A',
    liitteita: 0,
    viennit: viennit.map(([tili, debet, kredit, vpvm]) => ({
      tili,
      debet: e(debet),
      kredit: e(kredit),
      pvm: vpvm ?? pvm,
      alvKoodi: 0,
      alvProsentti: 0,
    })),
  };
}

describe('tositeTunniste', () => {
  it('yhdistää sarjan ja tunnisteen; luonnoksella tyhjä', () => {
    expect(tositeTunniste({ sarja: 'A', tunniste: 12 })).toBe('A 12');
    expect(tositeTunniste({ sarja: '', tunniste: 3 })).toBe('3');
    expect(tositeTunniste({ sarja: 'A', tunniste: 0 })).toBe('');
  });
});

describe('kirjaRivit', () => {
  it('järjestää vientien pvm:n, tositeen id:n ja viennin paikan mukaan ja suodattaa viennin pvm:llä', () => {
    const rivit = kirjaRivit(
      [
        tosite(2, '2026-02-01', [
          [1900, 100, 0],
          [3000, 0, 100],
        ]),
        tosite(1, '2026-02-01', [
          [4000, 50, 0],
          [1900, 0, 50],
        ]),
        tosite(3, '2026-01-31', [
          [1900, 5, 0, '2026-02-01'],
          [3000, 0, 5, '2025-12-31'],
        ]),
      ],
      '2026-01-01',
      '2026-12-31',
    );
    expect(rivit.map((r) => r.avain)).toEqual(['3-0', '1-0', '1-1', '2-0', '2-1']);
  });
});

describe('paakirjaTilit', () => {
  it('laskee juoksevan saldon omaan suuntaan ja ottaa mukaan tilit joilla on vain alkusaldo', () => {
    const rivit = kirjaRivit(
      [
        tosite(1, '2026-02-01', [
          [1900, 100, 0],
          [3000, 0, 100],
        ]),
      ],
      '2026-01-01',
      '2026-12-31',
    );
    const tilit = paakirjaTilit(
      rivit,
      new Map([
        [1900, e(1000)],
        [2000, e(-300)],
        [3000, e(0)],
        [4000, e(0)],
      ]),
    );
    expect(tilit.map((t) => t.tili)).toEqual([1900, 2000, 3000]);
    expect(tilit[0]?.loppusaldo).toBe(1100);
    expect(tilit[0]?.muutos).toBe(100);
    // Velkatili: kredit-positiivinen; pelkkä alkusaldo, ei rivejä.
    expect(tilit[1]?.rivit).toEqual([]);
    expect(tilit[1]?.loppusaldo).toBe(-300);
    // Tulostili: kredit kasvattaa saldoa.
    expect(tilit[2]?.rivit[0]?.saldo).toBe(100);
  });
});

describe('kirjaRivit — selite', () => {
  it('viennin oma selite, muuten tositteen otsikko', () => {
    const t = tosite(1, '2026-08-12', [
      [1910, 100, 0],
      [2361, 0, 100],
    ]);
    t.otsikko = 'Yksityissijoitus';
    const v0 = t.viennit[0];
    if (v0) v0.selite = 'MATTI JUHANI MEIKÄLÄINEN';
    const rivit = kirjaRivit([t], '2026-01-01', '2026-12-31');
    expect(rivit.map((r) => r.selite)).toEqual(['MATTI JUHANI MEIKÄLÄINEN', 'Yksityissijoitus']);
  });
});
