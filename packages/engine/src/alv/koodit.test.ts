import { describe, expect, it } from 'vitest';
import {
  AlvKoodi,
  TILITYS,
  alvKoodilla,
  debetistaKoodilla,
  palautuskoodi,
  veroTyyppi,
} from './koodit.js';

describe('alv/koodit', () => {
  it('alvKoodilla lisää offsetin', () => {
    expect(alvKoodilla(AlvKoodi.MYYNNIT_NETTO, AlvKoodi.ALVKIRJAUS)).toBe(111);
    expect(alvKoodilla(AlvKoodi.OSTOT_NETTO, AlvKoodi.ALVVAHENNYS)).toBe(221);
    expect(alvKoodilla(AlvKoodi.RAKENNUSPALVELU_OSTO, AlvKoodi.ALVKIRJAUS)).toBe(126);
  });

  it('debetistaKoodilla — verbatim-portin totuustaulu', () => {
    // 200-299 (vähennys/deductible) => debet
    expect(debetistaKoodilla(221)).toBe(true);
    expect(debetistaKoodilla(224)).toBe(true);
    // 100-199 (suoritettava/output) => kredit
    expect(debetistaKoodilla(111)).toBe(false);
    expect(debetistaKoodilla(124)).toBe(false);
    // base 11: floor(11/100)=0, floor((11%20)/10)=1 -> (0&&false)||false||false => false
    expect(debetistaKoodilla(11)).toBe(false);
    // base 8: floor(8/100)=0, floor((8%20)/10)=0 -> true
    expect(debetistaKoodilla(8)).toBe(true);
    // VAHENNYSKELVOTON => debet
    expect(debetistaKoodilla(932)).toBe(true);
  });

  it('veroTyyppi tuntee soveltamisalan koodit + liput', () => {
    expect(veroTyyppi(AlvKoodi.MYYNNIT_NETTO)?.puoli).toBe('myynti');
    expect(veroTyyppi(AlvKoodi.OSTOT_NETTO)?.puoli).toBe('osto');
    expect(veroTyyppi(AlvKoodi.RAKENNUSPALVELU_OSTO)?.kaanteinen).toBe(true);
    expect(veroTyyppi(AlvKoodi.YHTEISOMYYNTI_TAVARAT)?.nollalaji).toBe(true);
    expect(veroTyyppi(AlvKoodi.RAKENNUSPALVELU_OSTO)?.nollalaji).toBe(false);
    expect(veroTyyppi(999)).toBeUndefined();
  });
});

describe('TILITYS', () => {
  it('on verbatim 901 (kitsas.h:49)', () => {
    expect(TILITYS).toBe(901);
  });
});

describe('palautuskoodi', () => {
  it('jakaa kotimaan myynnin veron verokannan mukaan (111 -> 301/302/303)', () => {
    expect(palautuskoodi(111, 2550)).toBe(301);
    expect(palautuskoodi(111, 2400)).toBe(301);
    expect(palautuskoodi(111, 1400)).toBe(302);
    expect(palautuskoodi(111, 1350)).toBe(302);
    expect(palautuskoodi(111, 1000)).toBe(303);
    expect(palautuskoodi(111, 999)).toBeUndefined();
  });

  it('bruttokirjauksen oikaisuvero (112) kuuluu kotimaan myyntiin (alvlaskelma.cpp:468)', () => {
    expect(palautuskoodi(112, 2550)).toBe(301);
    expect(palautuskoodi(112, 2400)).toBe(301);
    expect(palautuskoodi(112, 1400)).toBe(302);
    expect(palautuskoodi(112, 1000)).toBe(303);
    expect(palautuskoodi(12, 2550)).toBeUndefined(); // bruttoperuste ei ilmoitu
  });

  it('kuvaa kiinteät koodit taulukon mukaan', () => {
    expect(palautuskoodi(124, 2550)).toBe(305);
    expect(palautuskoodi(125, 2550)).toBe(306);
    expect(palautuskoodi(126, 2550)).toBe(318);
    for (const k of [221, 222, 224, 225, 226]) expect(palautuskoodi(k, 2550)).toBe(307);
    expect(palautuskoodi(19, 0)).toBe(309);
    expect(palautuskoodi(14, 0)).toBe(311);
    expect(palautuskoodi(15, 0)).toBe(312);
    expect(palautuskoodi(24, 2550)).toBe(313);
    expect(palautuskoodi(25, 2550)).toBe(314);
    expect(palautuskoodi(16, 0)).toBe(319);
    expect(palautuskoodi(26, 2550)).toBe(320);
  });

  it('kuvaa EU:n ulkopuolisen palveluoston (koodi 29) käänteisen alv:n veroilmoitukselle', () => {
    // Suoritettava vero (129) summautuu kotimaan myynnin veroon (alvlaskelma.cpp:472,
    // kotimaanmyyntivero) -> 301/302/303 verokannan mukaan, kuten 111.
    expect(palautuskoodi(129, 2550)).toBe(301);
    expect(palautuskoodi(129, 2400)).toBe(301);
    expect(palautuskoodi(129, 1400)).toBe(302);
    expect(palautuskoodi(129, 1000)).toBe(303);
    // Vähennettävä vero (229) kuuluu kaistaan 200-299 -> 307 (kaikki vähennykset).
    expect(palautuskoodi(229, 2550)).toBe(307);
    // Paljasta perustetta (29) ei summata millekään ilmoitusriville (ei omaa laatikkoa).
    expect(palautuskoodi(29, 2550)).toBeUndefined();
  });

  it('ohittaa kuvaamattomat koodit (EIALV, brutto, TILITYS, 932, paljaat netto-kannat)', () => {
    for (const k of [0, 11, 12, 21, 22, 901, 932]) {
      expect(palautuskoodi(k, 2550)).toBeUndefined();
    }
  });
});

describe('marginaali codes', () => {
  it('defines the base codes', () => {
    expect(AlvKoodi.MYYNNIT_MARGINAALI).toBe(13);
    expect(AlvKoodi.OSTOT_MARGINAALI).toBe(23);
  });
  it('marks 13/23 as margin in VEROTYYPIT', () => {
    expect(veroTyyppi(13)?.marginaali).toBe(true);
    expect(veroTyyppi(23)?.marginaali).toBe(true);
  });
  it('maps recognized margin sale VAT (113) to the domestic rate line like 111', () => {
    expect(palautuskoodi(113, 2550)).toBe(301);
    expect(palautuskoodi(113, 1400)).toBe(302);
    expect(palautuskoodi(113, 1000)).toBe(303);
  });
  it('does not map base 13/23 or the technical 914 to a return box', () => {
    expect(palautuskoodi(13, 2550)).toBeUndefined();
    expect(palautuskoodi(23, 2550)).toBeUndefined();
    expect(palautuskoodi(914, 2550)).toBeUndefined();
  });
});

describe('maksuperusteinen codes', () => {
  it('defines the base codes and offset', () => {
    expect(AlvKoodi.MAKSUPERUSTEINEN_MYYNTI).toBe(18);
    expect(AlvKoodi.MAKSUPERUSTEINEN_OSTO).toBe(28);
    expect(AlvKoodi.MAKSUPERUSTEINEN_KOHDENTAMATON).toBe(400);
  });

  it('maps recognized sale VAT (118) to the domestic rate line like 111', () => {
    expect(palautuskoodi(118, 2550)).toBe(301);
    expect(palautuskoodi(118, 1400)).toBe(302);
    expect(palautuskoodi(118, 1000)).toBe(303);
  });

  it('maps recognized purchase deduction (228) to 307', () => {
    expect(palautuskoodi(228, 2550)).toBe(307);
  });

  it('never maps deferred codes (418/428) to a return bucket', () => {
    expect(palautuskoodi(418, 2550)).toBeUndefined();
    expect(palautuskoodi(428, 2550)).toBeUndefined();
  });

  it('sums recognized/deferred codes on the correct side and keeps deferred out of vero/vahennys ranges', () => {
    expect(debetistaKoodilla(118)).toBe(false); // output VAT: credit side
    expect(debetistaKoodilla(228)).toBe(true); // deduction: debit side
    expect(debetistaKoodilla(18)).toBe(false); // net sale base: credit side (like 11)
    expect(debetistaKoodilla(28)).toBe(true); // net purchase base: debit side (like 21)
    expect(debetistaKoodilla(418)).toBe(false);
    expect(debetistaKoodilla(428)).toBe(true);
    // deferred codes are in the 400-band, outside the vero(100-199)/vahennys(200-299) ranges
    for (const koodi of [418, 428]) {
      expect(koodi >= 100 && koodi <= 199).toBe(false);
      expect(koodi >= 200 && koodi <= 299).toBe(false);
    }
    // recognized codes ARE in-range
    expect(118 >= 100 && 118 <= 199).toBe(true);
    expect(228 >= 200 && 228 <= 299).toBe(true);
  });
});
