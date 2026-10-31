import { AlvKoodi, yleinenAlv } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { OSTOKOODIT, alustaOstolaskuTila, ostolaskuReducer } from './ostolaskuReducer.js';

describe('ostolaskuReducer', () => {
  it('alustaa: eräpäivä +14 pv, tyhjä viite, yksi rivi, ostokoodi-oletus alv-velvolliselle', () => {
    const tila = alustaOstolaskuTila({ laskupvm: '2026-06-10', alvVelvollinen: true });
    expect(tila.laskupvm).toBe('2026-06-10');
    expect(tila.erapvm).toBe('2026-06-24');
    expect(tila.viite).toBe('');
    expect(tila.rivit).toHaveLength(1);
    expect(tila.rivit[0]?.alvKoodi).toBe(AlvKoodi.OSTOT_NETTO);
    expect(tila.rivit[0]?.alvProsentti).toBe(yleinenAlv('2026-06-10'));
  });

  it('ei-alv-velvollinen saa EIALV + 0 %', () => {
    const tila = alustaOstolaskuTila({ laskupvm: '2026-06-10', alvVelvollinen: false });
    expect(tila.rivit[0]?.alvKoodi).toBe(AlvKoodi.EIALV);
    expect(tila.rivit[0]?.alvProsentti).toBe(0);
  });

  it('setViite asettaa viitteen; setLaskupvm EI siirrä eräpäivää', () => {
    let tila = alustaOstolaskuTila({ laskupvm: '2026-06-10', alvVelvollinen: true });
    tila = ostolaskuReducer(tila, { type: 'setViite', viite: 'RF4912345' });
    expect(tila.viite).toBe('RF4912345');
    tila = ostolaskuReducer(tila, { type: 'setLaskupvm', pvm: '2026-07-01' });
    expect(tila.laskupvm).toBe('2026-07-01');
    expect(tila.erapvm).toBe('2026-06-24'); // ennallaan
  });

  it('lisää ja poistaa rivejä; viimeisen poisto tyhjentää (lattia 1)', () => {
    let tila = alustaOstolaskuTila({ laskupvm: '2026-06-10', alvVelvollinen: true });
    tila = ostolaskuReducer(tila, { type: 'lisaaRivi' });
    expect(tila.rivit).toHaveLength(2);
    expect(tila.rivit[1]?.alvKoodi).toBe(AlvKoodi.OSTOT_NETTO);
    const avain = tila.rivit[0]?.avain ?? 0;
    tila = ostolaskuReducer(tila, { type: 'poistaRivi', avain });
    expect(tila.rivit).toHaveLength(1);
    const jaljella = tila.rivit[0]?.avain ?? 0;
    tila = ostolaskuReducer(tila, { type: 'poistaRivi', avain: jaljella });
    expect(tila.rivit).toHaveLength(1); // lattia
  });

  it('OSTOKOODIT sisältää kotimaan ja käännetyn verovelvollisuuden koodit', () => {
    expect(OSTOKOODIT).toEqual([
      AlvKoodi.EIALV,
      AlvKoodi.OSTOT_NETTO,
      AlvKoodi.YHTEISOHANKINNAT_TAVARAT,
      AlvKoodi.YHTEISOHANKINNAT_PALVELUT,
      AlvKoodi.RAKENNUSPALVELU_OSTO,
    ]);
  });
});
