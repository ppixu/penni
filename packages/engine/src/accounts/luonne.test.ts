import { describe, expect, it } from 'vitest';
import { Luonne, onko, tilityypit, tyyppiKoodilla } from './luonne.js';

describe('Luonne bit values (verbatim from tilityyppimodel.h)', () => {
  it('has the exact lattice values', () => {
    expect(Luonne.TUNTEMATON).toBe(0);
    expect(Luonne.OTSIKKO).toBe(1);
    expect(Luonne.TASE).toBe(2);
    expect(Luonne.TULOS).toBe(4);
    expect(Luonne.VASTAAVAA).toBe(10);
    expect(Luonne.VASTATTAVAA).toBe(18);
    expect(Luonne.SAATAVA).toBe(74);
    expect(Luonne.ALVSAATAVA).toBe(330);
    expect(Luonne.MYYNTISAATAVA).toBe(1098);
    expect(Luonne.PANKKITILI).toBe(650);
    expect(Luonne.KATEINEN).toBe(1162);
    expect(Luonne.EDELLISTENTULOS).toBe(562);
    expect(Luonne.KAUDENTULOS).toBe(1074);
    expect(Luonne.VELKATILI).toBe(722);
    expect(Luonne.SIIRTOVELKA).toBe(722); // documented collision with VELKATILI
    expect(Luonne.ALVVELKA).toBe(1234);
    expect(Luonne.KOHDENTAMATONALVVELKA).toBe(3282);
    expect(Luonne.KOHDENTAMATONALVSAATAVA).toBe(842);
    expect(Luonne.TULO).toBe(20);
    expect(Luonne.LVTULO).toBe(84);
    expect(Luonne.MENO).toBe(36);
    expect(Luonne.POISTO).toBe(164);
  });
});

describe('onko — subset (contains) test', () => {
  it('an ALVSAATAVA account is also SAATAVA, VASTAAVAA, TASE', () => {
    expect(onko(Luonne.ALVSAATAVA, Luonne.SAATAVA)).toBe(true);
    expect(onko(Luonne.ALVSAATAVA, Luonne.VASTAAVAA)).toBe(true);
    expect(onko(Luonne.ALVSAATAVA, Luonne.TASE)).toBe(true);
    expect(onko(Luonne.ALVSAATAVA, Luonne.TULOS)).toBe(false);
  });
  it('a MYYNTISAATAVA account contains SAATAVA but a plain SAATAVA is not MYYNTISAATAVA', () => {
    expect(onko(Luonne.MYYNTISAATAVA, Luonne.SAATAVA)).toBe(true);
    expect(onko(Luonne.SAATAVA, Luonne.MYYNTISAATAVA)).toBe(false);
  });
  it('TULO/MENO are TULOS-side, not TASE-side', () => {
    expect(onko(Luonne.MENO, Luonne.TULOS)).toBe(true);
    expect(onko(Luonne.MENO, Luonne.TASE)).toBe(false);
    expect(onko(Luonne.LVTULO, Luonne.TULO)).toBe(true);
  });
  it('a KOHDENTAMATONALVVELKA account contains its own mask', () => {
    expect(onko(Luonne.KOHDENTAMATONALVVELKA, Luonne.KOHDENTAMATONALVVELKA)).toBe(true);
  });
});

describe('tyyppiKoodilla — resolve a chart type-code to a TiliTyyppi', () => {
  it('maps known leaf codes to their luonne (verbatim table)', () => {
    expect(tyyppiKoodilla('A').luonne).toBe(Luonne.VASTAAVAA);
    expect(tyyppiKoodilla('APT').luonne).toBe(Luonne.TASAERAPOISTO);
    expect(tyyppiKoodilla('AL').luonne).toBe(Luonne.ALVSAATAVA);
    expect(tyyppiKoodilla('AL').uniikki).toBe(true);
    expect(tyyppiKoodilla('ARP').luonne).toBe(Luonne.PANKKITILI);
    expect(tyyppiKoodilla('BSP').luonne).toBe(Luonne.VELKATILI);
    expect(tyyppiKoodilla('BJ').luonne).toBe(Luonne.SIIRTOVELKA);
    expect(tyyppiKoodilla('CL').luonne).toBe(Luonne.LVTULO);
    expect(tyyppiKoodilla('D').luonne).toBe(Luonne.MENO);
    expect(tyyppiKoodilla('DP').luonne).toBe(Luonne.POISTO);
    expect(tyyppiKoodilla('BY').luonne).toBe(Luonne.VASTATTAVAA);
    expect(tyyppiKoodilla('A').uniikki).toBe(false);
  });
  it('maps heading codes H<n> to OTSIKKO at level n', () => {
    expect(tyyppiKoodilla('H1').luonne).toBe(Luonne.OTSIKKO);
    expect(tyyppiKoodilla('H1').otsikkotaso).toBe(1);
    expect(tyyppiKoodilla('H4').otsikkotaso).toBe(4);
  });
  it('maps an unknown code to TUNTEMATON', () => {
    expect(tyyppiKoodilla('ZZZ').luonne).toBe(Luonne.TUNTEMATON);
    expect(tyyppiKoodilla('ZZZ').koodi).toBe('ZZZ');
  });
});

describe('tilityypit — enumerate the leaf-account type catalogue', () => {
  it('lists catalogue entries as { koodi, kuvaus, luonne, uniikki, otsikkotaso: 0 }', () => {
    const tyypit = tilityypit();
    // A representative sample of known leaf codes is present.
    const koodit = tyypit.map((t) => t.koodi);
    expect(koodit).toContain('A');
    expect(koodit).toContain('ARP');
    expect(koodit).toContain('CL');
    expect(koodit).toContain('D');
    expect(koodit).toContain('T');
    // Each entry agrees with tyyppiKoodilla and is a leaf (otsikkotaso 0).
    for (const t of tyypit) {
      expect(t.otsikkotaso).toBe(0);
      expect(t.luonne).toBe(tyyppiKoodilla(t.koodi).luonne);
      expect(t.kuvaus).toBe(tyyppiKoodilla(t.koodi).kuvaus);
    }
  });
  it('excludes synthetic heading types (no H<n> codes)', () => {
    expect(tilityypit().some((t) => t.koodi.startsWith('H'))).toBe(false);
  });
});
