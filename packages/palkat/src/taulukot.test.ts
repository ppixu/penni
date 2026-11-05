import { describe, expect, it } from 'vitest';
import { PalkatVirhe, type TaulukkoKentta, haeTaulukko, taulukonLahteet } from './taulukot.js';

describe('haeTaulukko', () => {
  it('2026: bundlatut arvot', () => {
    const h = haeTaulukko(2026);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    const t = h.taulukko;
    expect(t.vuosi).toBe(2026);
    expect(t.tyelTyontekijaBp).toBe(730);
    expect(t.savaBp).toBe(191);
    expect(t.tvrTyontekijaBp).toBe(89);
    expect(t.kmKorvaus).toBe(55);
    expect(t.kokopaivaraha).toBe(5400);
    expect(t.ravintoetu).toBe(880);
    expect(t.ravintoetuYlaraja).toBe(1400);
    expect(t.tyelTyontekija53_62Bp).toBeUndefined(); // 53-62-vuotiaiden korotus poistui 2026
  });

  it('2025: 53-62-vuotiaiden TyEL-osuus 8,65 %', () => {
    const h = haeTaulukko(2025);
    expect(h.ok).toBe(true);
    if (h.ok) expect(h.taulukko.tyelTyontekija53_62Bp).toBe(865);
  });

  it('2027: pelkät matkakorvaukset, loput puuttuvat', () => {
    const h = haeTaulukko(2027);
    expect(h.ok).toBe(false);
    if (h.ok) return;
    expect(h.vuosi).toBe(2027);
    expect(h.puuttuvat).toContain('savaBp');
    expect(h.puuttuvat).toContain('tyelTyontekijaBp');
    expect(h.puuttuvat).not.toContain('kmKorvaus');
    expect(h.puuttuvat).not.toContain('tyelTyontekija53_62Bp'); // valinnainen
  });

  it('2027: ohitus täydentää puuttuvat kentät', () => {
    const ohitus = {
      '2027': {
        tyelTyontekijaBp: 730,
        tyelOletusKokonaisBp: 2485,
        tyelTilapainenKokonaisBp: 2585,
        tyelAlarajaKk: 7300,
        tvrTyontekijaBp: 74,
        tvrTyonantajaBp: 26,
        tvrOsaomistajaTyontekijaBp: 35,
        tvrOsaomistajaTyonantajaBp: 26,
        savaBp: 184,
        puhelinetuKk: 2000,
        ravintoetu: 900,
        ravintoetuYlaraja: 1420,
        eiVerokorttiaBp: 6000,
      },
    };
    const h = haeTaulukko(2027, ohitus);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.taulukko.savaBp).toBe(184);
    expect(h.taulukko.kmKorvaus).toBe(58); // bundlattu arvo säilyy
  });

  it('ohitus voittaa bundlatun arvon', () => {
    const h = haeTaulukko(2026, { '2026': { savaBp: 200 } });
    expect(h.ok).toBe(true);
    if (h.ok) {
      expect(h.taulukko.savaBp).toBe(200);
      expect(h.taulukko.tyelTyontekijaBp).toBe(730);
    }
  });

  it('vain pyydetyt kentät vaaditaan', () => {
    expect(haeTaulukko(2027, undefined, ['kmKorvaus']).ok).toBe(true);
    const h = haeTaulukko(2027, undefined, ['kmKorvaus', 'savaBp']);
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.puuttuvat).toEqual(['savaBp']);
  });

  it('tuntematon vuosi: kaikki vaaditut kentät puuttuvat', () => {
    const h = haeTaulukko(2024);
    expect(h.ok).toBe(false);
    if (!h.ok) {
      expect(h.vuosi).toBe(2024);
      expect(h.puuttuvat).toContain('kmKorvaus');
    }
  });

  it('virheellinen ohitus (ei kokonaisluku) hylätään', () => {
    expect(() => haeTaulukko(2026, { '2026': { savaBp: 1.5 } })).toThrow(PalkatVirhe);
  });
});

describe('taulukonLahteet', () => {
  it.each([2025, 2026])('vuoden %i jokaisella kentällä on https-lähde', (vuosi) => {
    const lahteet = taulukonLahteet(vuosi);
    const h = haeTaulukko(vuosi);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    const kentat = Object.keys(h.taulukko).filter((k) => k !== 'vuosi') as TaulukkoKentta[];
    expect(kentat.length).toBeGreaterThanOrEqual(17);
    for (const k of kentat) expect(lahteet[k], `${vuosi} ${k}`).toMatch(/^https:\/\//);
  });

  it('2027: lähde jokaiselle matkakorvaukselle', () => {
    const l = taulukonLahteet(2027);
    expect(Object.keys(l).sort()).toEqual(
      ['ateriakorvaus', 'kmKorvaus', 'kokopaivaraha', 'osapaivaraha'].sort(),
    );
  });

  it('tuntematon vuosi: tyhjä', () => {
    expect(taulukonLahteet(2024)).toEqual({});
  });
});
