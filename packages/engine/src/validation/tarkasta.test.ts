import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { type Tili, lataaKartta } from '../accounts/tili.js';
import { TositeTyyppi } from '../vouchers/enums.js';
import type { Tosite, TositeVienti } from '../vouchers/types.js';
import { type ValidationContext, tarkasta, voiValmistua } from './tarkasta.js';

const c = (n: number): Cents => n as Cents;
const chart: Tili[] = lataaKartta([
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 1700, tyyppi: 'AO', nimi: { fi: 'Myyntisaamiset' }, erittely: 1 },
]);

function ctx(over: Partial<ValidationContext> = {}): ValidationContext {
  return {
    kausiAlkaa: '2026-01-01',
    kausiLoppuu: '2026-12-31',
    tilitPaatetty: null,
    chart,
    onkoAlvIlmoitettu: () => false,
    onkoAlvVelvollinen: () => true,
    ...over,
  };
}

function vienti(over: Partial<TositeVienti>): TositeVienti {
  return {
    tili: 1900,
    debet: c(0),
    kredit: c(0),
    pvm: '2026-06-01',
    alvKoodi: 0,
    alvProsentti: 0,
    ...over,
  };
}

function tosite(over: Partial<Tosite>): Tosite {
  return {
    pvm: '2026-06-01',
    tyyppi: TositeTyyppi.MUU,
    tila: 50,
    tunniste: 0,
    sarja: '',
    viennit: [],
    ...over,
  };
}

const codes = (t: Tosite, x = ctx()): string[] => tarkasta(t, x).map((v) => v.code);

describe('tarkasta', () => {
  it('a balanced voucher within the period has no violations', () => {
    const t = tosite({
      viennit: [vienti({ tili: 1900, debet: c(10000) }), vienti({ tili: 3000, kredit: c(10000) })],
    });
    expect(tarkasta(t, ctx())).toEqual([]);
    expect(voiValmistua(tarkasta(t, ctx()))).toBe(true);
  });

  it('EITASMAA (block) when debet != kredit', () => {
    const t = tosite({
      viennit: [vienti({ tili: 1900, debet: c(10000) }), vienti({ tili: 3000, kredit: c(9000) })],
    });
    expect(codes(t)).toContain('EITASMAA');
    expect(voiValmistua(tarkasta(t, ctx()))).toBe(false);
  });

  it('EITASMAA is exempted for TILINAVAUS', () => {
    const t = tosite({
      tyyppi: TositeTyyppi.TILINAVAUS,
      viennit: [vienti({ tili: 1900, debet: c(10000) })],
    });
    expect(codes(t)).not.toContain('EITASMAA');
  });

  it('EITASMAAPVM (warn only) when a single posting date is unbalanced but the voucher nets to zero', () => {
    const t = tosite({
      viennit: [
        vienti({ tili: 1900, debet: c(10000), pvm: '2026-06-01' }),
        vienti({ tili: 3000, kredit: c(10000), pvm: '2026-06-02' }),
      ],
    });
    const v = tarkasta(t, ctx());
    expect(v.map((x) => x.code)).toEqual(['EITASMAAPVM']);
    expect(v[0]?.severity).toBe('warn');
    expect(voiValmistua(v)).toBe(true); // EITASMAAPVM does not block finalize
  });

  it('EIAVOINTAKUTTA (block) when pvm is outside the fiscal year', () => {
    expect(codes(tosite({ pvm: '2025-12-31', viennit: [vienti({ debet: c(100) })] }))).toContain(
      'EIAVOINTAKUTTA',
    );
  });

  it('PVMLUKITTU (block) when pvm <= tilitPaatetty', () => {
    const x = ctx({ tilitPaatetty: '2026-06-30' });
    expect(codes(tosite({ pvm: '2026-06-15', viennit: [vienti({ debet: c(100) })] }), x)).toContain(
      'PVMLUKITTU',
    );
  });

  it('PVMPUUTTUU (block) when the voucher date is invalid', () => {
    expect(codes(tosite({ pvm: '', viennit: [vienti({ debet: c(100) })] }))).toContain(
      'PVMPUUTTUU',
    );
  });

  it('TILIPUUTTUU (block) when an amount sits on an unknown account', () => {
    const t = tosite({
      viennit: [vienti({ tili: 9999, debet: c(100) }), vienti({ tili: 3000, kredit: c(100) })],
    });
    expect(codes(t)).toContain('TILIPUUTTUU');
  });

  it('ALVITON_ALVKIRJAUS (confirm) when a non-VAT book carries a VAT entry', () => {
    const x = ctx({ onkoAlvVelvollinen: () => false });
    const t = tosite({
      viennit: [
        vienti({ tili: 1900, debet: c(10000) }),
        vienti({ tili: 3000, kredit: c(10000), alvProsentti: 24 }),
      ],
    });
    const v = tarkasta(t, x);
    expect(v.map((y) => y.code)).toContain('ALVITON_ALVKIRJAUS');
    expect(v.find((y) => y.code === 'ALVITON_ALVKIRJAUS')?.severity).toBe('confirm');
    expect(voiValmistua(v)).toBe(true); // confirm does not block the finalize rule itself
  });

  it('ERA_ILMAN_ERITTELYA (confirm) when an era sits on a non-erittely account', () => {
    const t = tosite({
      viennit: [
        vienti({ tili: 1900, debet: c(10000), era: 7 }),
        vienti({ tili: 3000, kredit: c(10000) }),
      ],
    });
    expect(codes(t)).toContain('ERA_ILMAN_ERITTELYA');
  });

  it('no ERA_ILMAN_ERITTELYA when the era id is 0 (matches C++ eraId() treating 0 as no era)', () => {
    const t = tosite({
      viennit: [
        vienti({ tili: 1900, debet: c(10000), era: 0 }),
        vienti({ tili: 3000, kredit: c(10000) }),
      ],
    });
    expect(codes(t)).not.toContain('ERA_ILMAN_ERITTELYA');
  });

  it('no ERA_ILMAN_ERITTELYA when the era sits on an erittely account', () => {
    const t = tosite({
      viennit: [
        vienti({ tili: 1700, debet: c(10000), era: 7 }),
        vienti({ tili: 3000, kredit: c(10000) }),
      ],
    });
    expect(codes(t)).not.toContain('ERA_ILMAN_ERITTELYA');
  });
});
