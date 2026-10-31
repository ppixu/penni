import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { laskuTila } from './laskuTila.js';

const TANAAN = '2026-06-15';

describe('laskuTila', () => {
  it('avoin 0 → maksettu, vaikka eräpäivä olisi mennyt', () => {
    expect(laskuTila({ avoin: Euro.fromCents(0), erapvm: '2026-01-01' }, TANAAN)).toBe('maksettu');
  });

  it('avoin > 0 ja eräpäivä tulevaisuudessa → avoin', () => {
    expect(laskuTila({ avoin: Euro.fromCents(100), erapvm: '2026-07-01' }, TANAAN)).toBe('avoin');
  });

  it('eräpäivä tänään ei ole vielä erääntynyt', () => {
    expect(laskuTila({ avoin: Euro.fromCents(100), erapvm: TANAAN }, TANAAN)).toBe('avoin');
  });

  it('avoin > 0 ja eräpäivä ohitettu → erääntynyt', () => {
    expect(laskuTila({ avoin: Euro.fromCents(100), erapvm: '2026-06-14' }, TANAAN)).toBe(
      'eraantynyt',
    );
  });

  it('ilman eräpäivää lasku on avoin', () => {
    expect(laskuTila({ avoin: Euro.fromCents(100) }, TANAAN)).toBe('avoin');
  });

  it('tyhjä eräpäivä ("") ei koskaan tee laskusta erääntynyttä', () => {
    // Regressio: '' < tanaan on totta merkkijonovertailussa, joten !== undefined -testi
    // päästäisi tämän läpi virheellisesti erääntyneeksi (ks. rakennaLaskuSyote.ts-korjaus).
    expect(laskuTila({ avoin: Euro.fromCents(100), erapvm: '' }, TANAAN)).toBe('avoin');
  });
});
