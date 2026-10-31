import type { AlvIlmoitus } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { WireAlvIlmoitusSchema } from '../schema/wire.js';
import { decodeAlvIlmoitus, encodeAlvIlmoitus } from './alvIlmoitus.js';

const c = (n: number): Cents => n as Cents;

describe('alv-ilmoitus-koodekit', () => {
  const ilmoitus: AlvIlmoitus = {
    alkupvm: '2026-06-01',
    loppupvm: '2026-06-30',
    kausityyppi: 'K',
    koodit: new Map([
      [301, c(2550)],
      [311, c(8000)],
    ]),
    maksettava: c(2550),
    nolla: false,
    maksuperusteinen: false,
  };

  it('enkoodaa rahat "N.NN"-muotoon ja koodit numerojärjestykseen', () => {
    const w = encodeAlvIlmoitus(ilmoitus);
    expect(w.koodit).toEqual({ '301': '25.50', '311': '80.00' });
    expect(w.maksettava).toBe('25.50');
    expect(w.kausityyppi).toBe('K');
    expect(w.nolla).toBe(false);
    expect(WireAlvIlmoitusSchema.parse(w)).toBeTruthy();
  });

  it('kiertää tappiotta molempiin suuntiin', () => {
    const takaisin = decodeAlvIlmoitus(encodeAlvIlmoitus(ilmoitus));
    expect(takaisin.koodit.get(301)).toBe(2550);
    expect(takaisin.maksettava).toBe(2550);
    expect(takaisin.kausityyppi).toBe('K');
    expect(takaisin.maksuperusteinen).toBe(false);
  });
});
