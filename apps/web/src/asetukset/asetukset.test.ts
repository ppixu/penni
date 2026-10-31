import type { Tilikausi } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { seuraavaKausi } from './asetukset.js';

describe('seuraavaKausi', () => {
  it('laskee seuraavan kalenterivuoden vuoden vaihteen yli', () => {
    const viimeinen: Tilikausi = { alkaa: '2026-01-01', loppuu: '2026-12-31' };
    expect(seuraavaKausi(viimeinen)).toEqual({ alkaa: '2027-01-01', loppuu: '2027-12-31' });
  });

  it('laskee keskellä vuotta alkavan kauden ja kunnioittaa karkausvuotta', () => {
    // 2024 on karkausvuosi (29.2.2024 on olemassa); alkaa = päivä loppuun jälkeen.
    const viimeinen: Tilikausi = { alkaa: '2024-02-01', loppuu: '2025-01-31' };
    expect(seuraavaKausi(viimeinen)).toEqual({ alkaa: '2025-02-01', loppuu: '2026-01-31' });
  });

  it('siirtää alkupäivän kuukauden vaihteen yli oikein', () => {
    // loppuu 30.11. -> alkaa 1.12.; +12 kk -1 pv -> 30.11. seuraavana vuonna.
    const viimeinen: Tilikausi = { alkaa: '2025-12-01', loppuu: '2026-11-30' };
    expect(seuraavaKausi(viimeinen)).toEqual({ alkaa: '2026-12-01', loppuu: '2027-11-30' });
  });
});
