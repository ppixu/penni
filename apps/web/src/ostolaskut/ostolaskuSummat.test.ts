import { AlvKoodi, type TositeRivi } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { ostolaskuSummat } from './ostolaskuSummat.js';

function rivi(aNetto: number, alvKoodi: number, alvProsentti: number, myyntiKpl = 1): TositeRivi {
  return { myyntiKpl, aNetto, alvKoodi, alvProsentti };
}

describe('ostolaskuSummat', () => {
  it('kotimaan osto (21): vähennettävä alv lisätään maksettavaan (brutto)', () => {
    const s = ostolaskuSummat([rivi(100, AlvKoodi.OSTOT_NETTO, 25.5)]);
    expect(s.veroton).toBe(10000);
    expect(s.vahennettavaAlv).toBe(2550);
    expect(s.kaannettyAlv).toBe(0);
    expect(s.maksettava).toBe(12550);
  });

  it('EU-tavaraosto (24, käännetty): alv nettoutuu, maksetaan vain netto', () => {
    const s = ostolaskuSummat([rivi(100, AlvKoodi.YHTEISOHANKINNAT_TAVARAT, 25.5)]);
    expect(s.veroton).toBe(10000);
    expect(s.vahennettavaAlv).toBe(0);
    expect(s.kaannettyAlv).toBe(2550);
    expect(s.maksettava).toBe(10000);
  });

  it('sekarivit: kotimaa + käännetty', () => {
    const s = ostolaskuSummat([
      rivi(100, AlvKoodi.OSTOT_NETTO, 25.5),
      rivi(200, AlvKoodi.YHTEISOHANKINNAT_TAVARAT, 25.5),
    ]);
    expect(s.veroton).toBe(30000);
    expect(s.vahennettavaAlv).toBe(2550);
    expect(s.kaannettyAlv).toBe(5100);
    expect(s.maksettava).toBe(32550);
  });

  it('yksi rivi, kpl 2: 2 × 1,10 € @14 % samalla rivillä → vero 31 snt (nettoYhteensaCents kokoaa rivin ensin)', () => {
    const s = ostolaskuSummat([rivi(1.1, AlvKoodi.OSTOT_NETTO, 14, 2)]);
    expect(s.veroton).toBe(220);
    expect(s.vahennettavaAlv).toBe(31);
    expect(s.maksettava).toBe(251);
  });

  it('kaksi ERILLISTÄ riviä 1,10 € @14 % → vero riveittäin 15+15=30 (ei 31, moottori pyöristää riveittäin)', () => {
    const s = ostolaskuSummat([
      rivi(1.1, AlvKoodi.OSTOT_NETTO, 14, 1),
      rivi(1.1, AlvKoodi.OSTOT_NETTO, 14, 1),
    ]);
    expect(s.veroton).toBe(220);
    expect(s.vahennettavaAlv).toBe(30);
    expect(s.maksettava).toBe(250);
  });

  it('erittely kokoaa rivikohtaisen veron kannoittain sekarivistöllä (vähennettävä + käännetty)', () => {
    const s = ostolaskuSummat([
      rivi(1.1, AlvKoodi.OSTOT_NETTO, 14, 1),
      rivi(1.1, AlvKoodi.OSTOT_NETTO, 14, 1),
      rivi(100, AlvKoodi.OSTOT_NETTO, 25.5, 1),
      rivi(200, AlvKoodi.YHTEISOHANKINNAT_TAVARAT, 25.5, 1),
    ]);
    expect(s.veroton).toBe(30220);
    expect(s.vahennettavaAlv).toBe(2580); // 15+15+2550
    expect(s.kaannettyAlv).toBe(5100);
    expect(s.maksettava).toBe(32800);
    expect(s.erittely).toEqual([
      { prosentti: 25.5, vero: 2550, kaanteinen: false },
      { prosentti: 25.5, vero: 5100, kaanteinen: true },
      { prosentti: 14, vero: 30, kaanteinen: false },
    ]);
  });
});
