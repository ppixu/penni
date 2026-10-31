import type { MyyntilaskuRivi, MyyntilaskuSyote, SuoritusSyote } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  decodeMyyntilaskuRivi,
  decodeMyyntilaskuSyote,
  decodeSuoritusSyote,
  encodeMyyntilaskuRivi,
  encodeMyyntilaskuSyote,
  encodeSuoritusSyote,
} from './myyntilasku.js';
import { decodeRivi, encodeRivi } from './rivi.js';
import { decodeTosite, encodeTosite } from './tosite.js';

describe('rivi codec carries tili/kohdennus', () => {
  it('round-trips a row with tili and kohdennus', () => {
    const r = decodeRivi(
      encodeRivi({
        myyntiKpl: 2,
        aNetto: 50,
        alvKoodi: 11,
        alvProsentti: 25.5,
        tili: 3001,
        kohdennus: 7,
      }),
    );
    expect(r.tili).toBe(3001);
    expect(r.kohdennus).toBe(7);
  });
});

describe('tosite codec carries numero/maksutapa', () => {
  it('preserves numero and maksutapa (including LASKU=0)', () => {
    const t = decodeTosite(
      encodeTosite({
        pvm: '2026-06-01',
        tyyppi: 210,
        tila: 100,
        tunniste: 1,
        sarja: '',
        numero: '1',
        maksutapa: 0,
        viennit: [],
      }),
    );
    expect(t.numero).toBe('1');
    expect(t.maksutapa).toBe(0);
  });
});

describe('myyntilasku syote codec', () => {
  it('round-trips a syote (rivit + kumppani + maksutapa)', () => {
    const syote: MyyntilaskuSyote = {
      pvm: '2026-06-01',
      erapvm: '2026-07-01',
      kumppani: 42,
      maksutapa: 1,
      rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
    };
    const back = decodeMyyntilaskuSyote(encodeMyyntilaskuSyote(syote));
    expect(back.pvm).toBe('2026-06-01');
    expect(back.erapvm).toBe('2026-07-01');
    expect(back.kumppani).toBe(42);
    expect(back.maksutapa).toBe(1);
    expect(back.rivit).toHaveLength(1);
    expect(back.rivit[0]?.aNetto).toBe(100);
  });
});

describe('myyntilaskuRivi codec', () => {
  it('round-trips a row with money as canonical strings', () => {
    const rivi: MyyntilaskuRivi = {
      tosite: 7,
      pvm: '2026-06-01',
      viite: '1234',
      numero: '1',
      asiakas: 'Asiakas Oy',
      asiakasId: 3,
      summa: Euro.fromCents(12_550),
      avoin: Euro.fromCents(10_000),
      era: 1,
      tili: 1701,
      tyyppi: 210,
      tunniste: 4,
      sarja: '',
      tila: 100,
    };
    const w = encodeMyyntilaskuRivi(rivi);
    expect(w.summa).toBe('125.50');
    expect(w.avoin).toBe('100.00');
    const back = decodeMyyntilaskuRivi(w);
    expect(back.summa).toBe(Euro.fromCents(12_550));
    expect(back.avoin).toBe(Euro.fromCents(10_000));
    expect(back.asiakas).toBe('Asiakas Oy');
    expect(back.era).toBe(1);
  });

  it('round-trips avoin = 0 (fully paid)', () => {
    const w = encodeMyyntilaskuRivi({
      tosite: 1,
      summa: Euro.fromCents(5_000),
      avoin: Euro.fromCents(0),
      tyyppi: 210,
      tunniste: 1,
      sarja: '',
      tila: 100,
    });
    expect(w.avoin).toBe('0.00');
    expect(decodeMyyntilaskuRivi(w).avoin).toBe(Euro.fromCents(0));
  });
});

describe('suoritusSyote codec', () => {
  it('round-trips a payment body', () => {
    const s: SuoritusSyote = { tosite: 7, pvm: '2026-06-15', summa: Euro.fromCents(2_550) };
    const w = encodeSuoritusSyote(s);
    expect(w.summa).toBe('25.50');
    const back = decodeSuoritusSyote(w);
    expect(back.tosite).toBe(7);
    expect(back.summa).toBe(Euro.fromCents(2_550));
  });

  it('accepts a raw number amount on decode (legacy double)', () => {
    const back = decodeSuoritusSyote({ tosite: 1, pvm: '2026-06-15', summa: 25.5 });
    expect(back.summa).toBe(Euro.fromCents(2_550));
  });
});
