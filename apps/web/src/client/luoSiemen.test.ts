import { describe, expect, it } from 'vitest';
import { OLETUS_SYOTE, luoKirjanpidonSiemen } from './luoSiemen.js';

describe('luoKirjanpidonSiemen', () => {
  it('lataa koko yritys-tilikartan (1079 tiliä)', () => {
    const siemen = luoKirjanpidonSiemen(OLETUS_SYOTE);
    expect(siemen.tilit).toHaveLength(1079);
  });

  it('taittaa raporttilayoutit asetuksiin JSON-merkkijonoina', () => {
    const { asetukset } = luoKirjanpidonSiemen(OLETUS_SYOTE);
    const layout = JSON.parse(asetukset?.['tulos/yleinen'] ?? '');
    expect(Array.isArray(layout.rivit)).toBe(true);
    expect(asetukset?.['tase/yleinen']).toBeDefined();
  });

  it('serialisoi sisäkkäiset template-asetukset merkkijonoiksi', () => {
    const { asetukset } = luoKirjanpidonSiemen(OLETUS_SYOTE);
    expect(typeof asetukset?.muodot).toBe('string');
    expect(JSON.parse(asetukset?.muodot ?? '').oy).toBeDefined();
    expect(asetukset?.OletusMyyntitili).toBe('3000'); // plain strings pass through
  });

  it('soveltaa käyttäjän syötteet asetusten päälle', () => {
    const { asetukset, tilikaudet } = luoKirjanpidonSiemen({
      nimi: 'Testiyritys Oy',
      muoto: 'tmi',
      alvVelvollinen: true,
      kausiAlkaa: '2025-04-01',
      kausiLoppuu: '2026-03-31',
    });
    expect(asetukset?.Nimi).toBe('Testiyritys Oy');
    expect(asetukset?.muoto).toBe('tmi');
    expect(asetukset?.AlvVelvollinen).toBe('true');
    expect(tilikaudet).toEqual([{ alkaa: '2025-04-01', loppuu: '2026-03-31' }]);
  });

  it('asettaa perustarpeiden suosikkitilit, jotka eivät ole piilossa', () => {
    const { asetukset } = luoKirjanpidonSiemen({
      ...OLETUS_SYOTE,
      muoto: 'tmi',
      alvVelvollinen: true,
    });
    const suosikit = (asetukset?.suosikkitilit ?? '').split(',').map(Number);
    expect(suosikit).toEqual(expect.arrayContaining([1910, 3000, 4000, 1763, 2939, 2365, 2361]));
    const piilossa = new Set((asetukset?.piilotilit ?? '').split(',').map(Number));
    expect(suosikit.filter((n) => piilossa.has(n))).toEqual([]);
    const oy = luoKirjanpidonSiemen(OLETUS_SYOTE).asetukset?.suosikkitilit ?? '';
    expect(oy.split(',').map(Number)).not.toContain(2365);
  });

  it('koodaa alvVelvollinen=false merkkijonoksi "false"', () => {
    const { asetukset } = luoKirjanpidonSiemen({ ...OLETUS_SYOTE, alvVelvollinen: false });
    expect(asetukset?.AlvVelvollinen).toBe('false');
  });

  it('toiminimelle piilottaa muut kuin pienyrittäjän perustilit', () => {
    const siemen = luoKirjanpidonSiemen({ ...OLETUS_SYOTE, muoto: 'tmi' });
    const piilossa = (siemen.asetukset?.piilotilit ?? '').split(',').map(Number);
    expect(piilossa.length).toBeGreaterThan(700);
    expect(piilossa).not.toContain(3000);
    expect(piilossa).not.toContain(1910);
  });

  it('osakeyhtiölle ei piiloteta tilejä', () => {
    const siemen = luoKirjanpidonSiemen({ ...OLETUS_SYOTE, muoto: 'oy' });
    expect(siemen.asetukset?.piilotilit).toBeUndefined();
  });
});
