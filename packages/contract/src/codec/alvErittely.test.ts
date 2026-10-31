import type { AlvErittely } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { WireAlvErittelySchema } from '../schema/wire.js';
import { decodeAlvErittely, encodeAlvErittely } from './alvErittely.js';

const c = (n: number): Cents => n as Cents;

describe('alv-erittely-koodekit', () => {
  const e: AlvErittely = {
    alkupvm: '2026-06-01',
    loppupvm: '2026-06-30',
    rivit: [
      {
        alvKoodi: 11,
        kanta: 2550,
        tili: 3000,
        pvm: '2026-06-05',
        tosite: 7,
        tositeNumero: 'M 3',
        tositePvm: '2026-06-04',
        kumppani: 'Asiakas Oy',
        selite: 'Konsultointi',
        summa: c(10000),
      },
      {
        alvKoodi: 12,
        kanta: 2400,
        tili: 3000,
        pvm: '2026-06-30',
        tositeNumero: '',
        tositePvm: '2026-06-30',
        kumppani: '',
        selite: 'Bruttomyyntien oikaisu',
        summa: c(-2400),
      },
    ],
  };

  it('enkoodaa rahat "N.NN"-muotoon ja jättää puuttuvan tositteen pois', () => {
    const w = encodeAlvErittely(e);
    expect(w.rivit[0]).toEqual({
      alvKoodi: 11,
      kanta: 2550,
      tili: 3000,
      pvm: '2026-06-05',
      tosite: 7,
      tositeNumero: 'M 3',
      tositePvm: '2026-06-04',
      kumppani: 'Asiakas Oy',
      selite: 'Konsultointi',
      summa: '100.00',
    });
    expect(w.rivit[1]?.summa).toBe('-24.00');
    expect(Object.hasOwn(w.rivit[1] ?? {}, 'tosite')).toBe(false);
    expect(WireAlvErittelySchema.parse(w)).toBeTruthy();
  });

  it('kiertää tappiotta', () => {
    expect(decodeAlvErittely(encodeAlvErittely(e))).toEqual(e);
  });
});
