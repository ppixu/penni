import { describe, expect, it } from 'vitest';
import { yritysAsetukset, yritysRaportit, yritysTilit } from './index.js';

describe('@penni/charts — yritys-malli', () => {
  it('tilikartassa on 1079 tiliä/otsikkoa', () => {
    expect(yritysTilit).toHaveLength(1079);
  });

  it('raporttilayoutit sisältävät tuloslaskelman ja taseen', () => {
    expect(yritysRaportit['tulos/yleinen']).toBeDefined();
    expect(yritysRaportit['tase/yleinen']).toBeDefined();
    expect(yritysRaportit['tulos/yleinen']?.rivit.length).toBeGreaterThan(0);
  });

  it('asetukset sisältävät yritysmuodot ja oletustilit', () => {
    expect((yritysAsetukset.muodot as Record<string, unknown>).oy).toBeDefined();
    expect(yritysAsetukset.OletusMyyntitili).toBe('3000');
    expect(yritysAsetukset.OletusMenotili).toBe('4000');
  });
});
