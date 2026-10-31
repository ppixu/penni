import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { decodeTosite, encodeTosite } from './tosite.js';

const c = (n: number) => Euro.fromCents(n);

describe('golden: a purchase (MENO) voucher from the legacy wire', () => {
  // Shape per sqlite/routes/tositeroute.cpp:474-477 + sqliteroute.cpp:91-134 (Tier-0 subset).
  const wire = {
    id: 1234,
    pvm: '2026-03-15',
    tyyppi: 100,
    tila: 100,
    tunniste: 87,
    sarja: 'A',
    otsikko: 'Toimistotarvikkeet',
    kumppani: { id: 42 },
    viite: '13245',
    viennit: [
      {
        tili: 4000,
        pvm: '2026-03-15',
        debet: '100.00',
        alvkoodi: 9,
        alvprosentti: '25.50',
        kohdennus: 3,
      },
      { tili: 1900, pvm: '2026-03-15', kredit: '125.50', era: { id: 5003 } },
      {
        tili: 29390,
        pvm: '2026-03-15',
        debet: '25.50',
        alvkoodi: 169,
        alvprosentti: '25.50',
        tyyppi: 3,
      },
    ],
  };

  it('decodes to integer-cent engine money with the right keys', () => {
    const t = decodeTosite(wire);
    expect(t.id).toBe(1234);
    expect(t.kumppani).toBe(42);
    expect(t.viennit).toHaveLength(3);
    expect(t.viennit[0]).toMatchObject({
      tili: 4000,
      debet: c(10000),
      kredit: c(0),
      alvKoodi: 9,
      alvProsentti: 25.5,
      kohdennus: 3,
    });
    expect(t.viennit[1]).toMatchObject({ tili: 1900, kredit: c(12550), era: 5003 });
    expect(t.viennit[2]).toMatchObject({ tili: 29390, debet: c(2550), alvKoodi: 169, tyyppi: 3 });
    // debit total (10000 + 2550) and credit (12550) balance in cents
    const debits = t.viennit.reduce((s, v) => s + v.debet, 0);
    const credits = t.viennit.reduce((s, v) => s + v.kredit, 0);
    expect(debits).toBe(credits);
  });

  it('re-encodes back to the same wire object', () => {
    expect(encodeTosite(decodeTosite(wire))).toEqual(wire);
  });
});
