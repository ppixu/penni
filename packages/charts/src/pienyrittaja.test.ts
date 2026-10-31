import { describe, expect, it } from 'vitest';
import {
  PIENYRITTAJAN_TILIT,
  pienyrittajanPiilotilit,
  yritysAsetukset,
  yritysTilit,
} from './index.js';

const lehdet = new Map(
  yritysTilit
    .filter((t) => !String(t.tyyppi).startsWith('H'))
    .map((t) => [Number(t.numero), t] as const),
);

describe('pienyrittäjän perustilit', () => {
  it('jokainen perustili on vakiokartan lehtitili, ei toistoja', () => {
    for (const n of PIENYRITTAJAN_TILIT) expect(lehdet.has(n), `tili ${n}`).toBe(true);
    expect(new Set(PIENYRITTAJAN_TILIT).size).toBe(PIENYRITTAJAN_TILIT.length);
  });

  it('käyttäjän itse valitsemat oletustilit pysyvät näkyvissä', () => {
    for (const avain of [
      'OletusMyyntitili',
      'OletusMenotili',
      'LaskuTilit',
      'LaskuSaatavatili',
      'LaskuKateistili',
      'Ostovelkatili',
      'AlvVelkatili',
      'PankkiPalvelumaksutili',
      'Tuloveroennakkotili',
      'Yksityistilit/Peruspaaoma',
    ]) {
      expect(PIENYRITTAJAN_TILIT, avain).toContain(Number(yritysAsetukset[avain]));
    }
  });

  it('piilottaa kaikki muut lehtitilit, ei otsikoita', () => {
    const piilossa = pienyrittajanPiilotilit(yritysTilit).split(',').map(Number);
    expect(piilossa.length + PIENYRITTAJAN_TILIT.length).toBe(lehdet.size);
    expect(piilossa).not.toContain(3000);
    expect(piilossa).toContain(3350);
    expect(piilossa).toEqual([...piilossa].sort((a, b) => a - b));
  });
});
