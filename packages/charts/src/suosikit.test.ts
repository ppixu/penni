import { describe, expect, it } from 'vitest';
import { PIENYRITTAJAN_TILIT, oletusSuosikit, yritysTilit } from './index.js';

const lehdet = new Map(
  yritysTilit
    .filter((t) => !String(t.tyyppi).startsWith('H'))
    .map((t) => [Number(t.numero), t] as const),
);

describe('oletusSuosikit', () => {
  const muodot = ['tmi', 'oy', 'ay', 'ky', 'osk'];

  it('jokainen suosikki on vakiokartan lehtitili ja pienyrittäjän perustili (ei piilossa)', () => {
    for (const muoto of muodot)
      for (const alv of [true, false])
        for (const n of oletusSuosikit(muoto, alv)) {
          expect(lehdet.has(n), `tili ${n}`).toBe(true);
          expect(PIENYRITTAJAN_TILIT, `tili ${n}`).toContain(n);
        }
  });

  it('pankki, myynti ja ostot aina; ALV-tilit vain ALV-velvolliselle', () => {
    for (const muoto of muodot) {
      expect(oletusSuosikit(muoto, false)).toEqual(expect.arrayContaining([1910, 3000, 4000]));
      expect(oletusSuosikit(muoto, true)).toEqual(expect.arrayContaining([1763, 2939]));
      expect(oletusSuosikit(muoto, false)).not.toContain(2939);
    }
  });

  it('toiminimelle yksityisnostot ja -sijoitukset, yhtiölle ei', () => {
    expect(oletusSuosikit('tmi', false)).toEqual(expect.arrayContaining([2361, 2365, 6100, 9900]));
    expect(oletusSuosikit('oy', false)).not.toContain(2365);
    expect(oletusSuosikit('oy', false)).toContain(2920);
  });

  it('nousevassa järjestyksessä ilman toistoja', () => {
    const tilit = oletusSuosikit('tmi', true);
    expect(tilit).toEqual([...new Set(tilit)].sort((a, b) => a - b));
  });
});
