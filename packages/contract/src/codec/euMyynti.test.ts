import type { EuMyyntiYhteenveto } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { WireEuMyyntiSchema } from '../schema/wire.js';
import { decodeEuMyynti, encodeEuMyynti } from './euMyynti.js';

const c = (n: number): Cents => n as Cents;

describe('eu-myynti-koodekit', () => {
  const yv: EuMyyntiYhteenveto = {
    alkupvm: '2026-06-01',
    loppupvm: '2026-06-30',
    rivit: [
      {
        kumppani: 1,
        nimi: 'Alfa GmbH',
        alvtunnus: 'DE111',
        maa: 'de',
        tavara: c(8000),
        palvelu: c(0),
      },
      { kumppani: 2, nimi: 'Beeta AB', tavara: c(0), palvelu: c(5000) }, // ei alvtunnusta/maata
    ],
    puuttuviaTunnuksia: true,
  };

  it('enkoodaa rivien rahat "N.NN"-muotoon ja jättää puuttuvat kentät pois', () => {
    const w = encodeEuMyynti(yv);
    expect(w.rivit[0]).toEqual({
      kumppani: 1,
      nimi: 'Alfa GmbH',
      alvtunnus: 'DE111',
      maa: 'de',
      tavara: '80.00',
      palvelu: '0.00',
    });
    expect(w.rivit[1]?.alvtunnus).toBeUndefined();
    expect(w.puuttuviaTunnuksia).toBe(true);
    expect(WireEuMyyntiSchema.parse(w)).toBeTruthy();
  });

  it('kiertää tappiotta', () => {
    const takaisin = decodeEuMyynti(encodeEuMyynti(yv));
    expect(takaisin.rivit[0]?.tavara).toBe(8000);
    expect(takaisin.rivit[1]?.palvelu).toBe(5000);
    expect(takaisin.rivit[1]?.alvtunnus).toBeUndefined();
    expect(takaisin.puuttuviaTunnuksia).toBe(true);
  });
});
