import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  type LaskentaYmparisto,
  type PalkkaSyote,
  type SyoteRivi,
  laskePalkka,
  oletusRivit,
  taulukkoHaku,
} from './laske.js';
import { PalkatVirhe, haeTaulukko } from './taulukot.js';
import type { PalkatAsetukset, Tyontekija, Verokortti } from './tyontekija.js';

/*
 * Kaikki henkilöt ovat keksittyjä, henkilötunnusten yksilönumerot 900-999 (testitunnukset).
 * Odotusarvot on laskettu käsin kommentteihin: pyöristys lähimpään senttiin, puolikkaat ylös
 * (VH/7526 §4.1.1), jokainen maksu omana laskunaan perusteesta.
 * Taulukkoarvot (2026): TyEL työntekijä 7,30 %, TyEL kokonais (oletus) 24,85 %,
 * TVR työntekijä 0,89 % / työnantaja 0,31 %, osaomistaja 0,39 % / 0,31 %, sava 1,91 %,
 * km 0,55 €, puhelinetu 20 €/kk, ravintoetu 8,80 € (ylä 14,00 €), ei verokorttia 60 %.
 */

const c = (n: number) => n as Cents;
const TARKISTEMERKIT = '0123456789ABCDEFHJKLMNPRSTUVWXY';
/** Testitunnus: `ppkkvv` + vuosisatamerkki + yksilönumero 900-999 + laskettu tarkiste. */
function testiHetu(ppkkvv: string, merkki: string, yksilo: string): string {
  return `${ppkkvv}${merkki}${yksilo}${TARKISTEMERKIT[Number(`${ppkkvv}${yksilo}`) % 31]}`;
}

const HETU_1990 = testiHetu('010190', '-', '900'); // 36 v vuonna 2026
const HETU_1970 = testiHetu('010370', '-', '901'); // 55 v kesäkuussa 2025
const HETU_1955 = testiHetu('150655', '-', '902'); // yli 70 v vuonna 2026 (TyEL-yläraja 68)
const HETU_1956 = testiHetu('010156', '-', '903'); // 70 v kesäkuussa 2026

function kortti(
  perusBp: number,
  lisaBp: number,
  tuloraja = 3_000_000,
  alkaa = '2026-01-01',
  paattyy = '2026-12-31',
): Verokortti {
  return { alkaa, paattyy, perusBp, lisaBp, tuloraja: c(tuloraja), aiemminMaksettu: c(0) };
}

function tyontekija(osat: Partial<Tyontekija> = {}): Tyontekija {
  return {
    id: 't1',
    nimi: 'Testi Työntekijä',
    hetu: HETU_1990,
    vakuutusperuste: 'tyontekija',
    palkkamuoto: 'kuukausi',
    puhelinetu: false,
    verokortit: [],
    aktiivinen: true,
    ...osat,
  };
}

const ASETUKSET: PalkatAsetukset = { tilapainenTyonantaja: false, tvrVapautus: false };

function ymp(aiempiKertyma = 0, asetukset: PalkatAsetukset = ASETUKSET): LaskentaYmparisto {
  return { taulukko: taulukkoHaku(), asetukset, aiempiKertyma: c(aiempiKertyma) };
}

function syote(t: Tyontekija, rivit: SyoteRivi[], maksupaiva = '2026-10-31'): PalkkaSyote {
  const [v, k] = maksupaiva.split('-');
  return {
    tyontekija: t,
    maksupaiva,
    kausiAlkaa: `${v}-${k}-01`,
    kausiLoppuu: maksupaiva,
    rivit,
  };
}

const palkka = (summa: number): SyoteRivi => ({
  laji: 'kuukausipalkka',
  selite: 'Kuukausipalkka',
  summa: c(summa),
});

describe('laskePalkka: tapaukset A-D (2026)', () => {
  it('tapaus A kuukausipalkka', () => {
    const t = tyontekija({ puhelinetu: true, verokortit: [kortti(2000, 4000)] });
    const h = laskePalkka(
      syote(t, [
        palkka(300_000),
        { laji: 'puhelinetu', selite: 'Puhelinetu' },
        { laji: 'km', selite: 'Helsinki–Espoo asiakaskäynti', maara: 10_000 },
      ]),
      ymp(0),
    );
    // km: 100,00 km × 0,55 € = 55,00 € (verovapaa)
    // pidätysperuste: 3 000,00 + puhelinetu 20,00 = 3 020,00
    // ennakonpidätys: 3 020,00 × 20 % = 604,00
    // TyEL työntekijä: 3 020,00 × 7,30 % = 220,46
    // TVR työntekijä: 3 020,00 × 0,89 % = 26,878 -> 26,88
    // TyEL työnantaja: 3 020,00 × (24,85 - 7,30 = 17,55 %) = 530,01
    // TVR työnantaja: 3 020,00 × 0,31 % = 9,362 -> 9,36
    // sava: 3 020,00 × 1,91 % = 57,682 -> 57,68
    // netto: 3 000,00 + 55,00 - 604,00 - 220,46 - 26,88 = 2 203,66
    expect(h.tulos).toMatchObject({
      rahapalkka: 300_000,
      luontoisedut: 2000,
      verovapaat: 5500,
      pidatysperuste: 302_000,
      pidatysOsat: [{ bp: 2000, peruste: 302_000 }],
      ennakonpidatys: 60_400,
      tyelTyontekija: 22_046,
      tvrTyontekija: 2688,
      tyelTyonantaja: 53_001,
      tvrTyonantaja: 936,
      sava: 5768,
      nettopalkka: 220_366,
      kertymaJalkeen: 302_000,
      varoitukset: [],
    });
    expect(h.prosentit).toEqual({
      tyelTyontekijaBp: 730,
      tyelKokonaisBp: 2485,
      tvrTyontekijaBp: 89,
      tvrTyonantajaBp: 31,
      savaBp: 191,
    });
    expect(h.verokortti).toEqual({
      alkaa: '2026-01-01',
      paattyy: '2026-12-31',
      perusBp: 2000,
      lisaBp: 4000,
      tuloraja: 3_000_000,
      tammikuuSaanto: false,
    });
    expect(h.rivit.map((r) => [r.laji, r.summa, r.ahinta])).toEqual([
      ['kuukausipalkka', 300_000, undefined],
      ['puhelinetu', 2000, 2000],
      ['km', 5500, 55],
    ]);
    expect(h).toMatchObject({ tyontekijaId: 't1', nimi: 'Testi Työntekijä' });
    expect(JSON.stringify(h)).not.toContain(HETU_1990);
  });

  it('tapaus B tuntipalkka', () => {
    const t = tyontekija({ palkkamuoto: 'tunti', verokortit: [kortti(1000, 3000)] });
    const h = laskePalkka(
      syote(t, [{ laji: 'tuntipalkka', selite: 'Tunnit', maara: 3750, ahinta: c(1250) }]),
      ymp(0),
    );
    // 37,50 h × 12,50 € = 468,75
    // ennakonpidätys: 468,75 × 10 % = 46,875 -> 46,88
    // TyEL työntekijä: 468,75 × 7,30 % = 34,21875 -> 34,22
    // TVR työntekijä: 468,75 × 0,89 % = 4,171875 -> 4,17
    // sava: 468,75 × 1,91 % = 8,953125 -> 8,95
    // netto: 468,75 - 46,88 - 34,22 - 4,17 = 383,48
    expect(h.tulos).toMatchObject({
      rahapalkka: 46_875,
      pidatysperuste: 46_875,
      ennakonpidatys: 4688,
      tyelTyontekija: 3422,
      tvrTyontekija: 417,
      sava: 895,
      nettopalkka: 38_348,
    });
  });

  it('tapaus C YEL-osakas', () => {
    const t = tyontekija({ vakuutusperuste: 'yel', verokortit: [kortti(1500, 3500)] });
    const h = laskePalkka(syote(t, [palkka(200_000)]), ymp(0));
    // ennakonpidätys: 2 000,00 × 15 % = 300,00
    // ei TyEL:iä (YEL) eikä työttömyysvakuutusta; sava 2 000,00 × 1,91 % = 38,20
    // netto: 2 000,00 - 300,00 = 1 700,00
    expect(h.tulos).toMatchObject({
      ennakonpidatys: 30_000,
      tyelTyontekija: 0,
      tyelTyonantaja: 0,
      tvrTyontekija: 0,
      tvrTyonantaja: 0,
      sava: 3820,
      nettopalkka: 170_000,
    });
    expect(h.prosentit).toEqual({
      tyelTyontekijaBp: 0,
      tyelKokonaisBp: 0,
      tvrTyontekijaBp: 0,
      tvrTyonantajaBp: 0,
      savaBp: 191,
    });
  });

  it('tapaus D osaomistaja', () => {
    const t = tyontekija({ vakuutusperuste: 'osaomistaja', verokortit: [kortti(1800, 3800)] });
    const h = laskePalkka(syote(t, [palkka(250_000)]), ymp(0));
    // ennakonpidätys: 2 500,00 × 18 % = 450,00
    // TyEL työntekijä: 2 500,00 × 7,30 % = 182,50
    // TVR osaomistaja työntekijä: 2 500,00 × 0,39 % = 9,75; työnantaja × 0,31 % = 7,75
    // TyEL työnantaja: 2 500,00 × 17,55 % = 438,75
    // sava: 2 500,00 × 1,91 % = 47,75
    // netto: 2 500,00 - 450,00 - 182,50 - 9,75 = 1 857,75
    expect(h.tulos).toMatchObject({
      ennakonpidatys: 45_000,
      tyelTyontekija: 18_250,
      tvrTyontekija: 975,
      tvrTyonantaja: 775,
      tyelTyonantaja: 43_875,
      sava: 4775,
      nettopalkka: 185_775,
    });
    expect(h.prosentit.tvrTyontekijaBp).toBe(39);
  });
});

describe('laskePalkka: ennakonpidätys', () => {
  const t = tyontekija({ puhelinetu: true, verokortit: [kortti(2000, 4000)] });
  const rivitA: SyoteRivi[] = [palkka(300_000), { laji: 'puhelinetu', selite: 'Puhelinetu' }];

  it('tulorajan ylitys jakaa pidätyksen', () => {
    // Käsin laskettu esimerkki (VH/7526:ssa ei ole numeerista tulorajan ylitysesimerkkiä).
    // Tuloraja 30 000,00, aiempi kertymä 28 500,00 -> tilaa 1 500,00.
    // 1 500,00 × 20 % = 300,00; loput 1 520,00 × 40 % = 608,00; yhteensä 908,00.
    const h = laskePalkka(syote(t, rivitA), ymp(2_850_000));
    expect(h.tulos.pidatysOsat).toEqual([
      { bp: 2000, peruste: 150_000 },
      { bp: 4000, peruste: 152_000 },
    ]);
    expect(h.tulos.ennakonpidatys).toBe(90_800);
    expect(h.tulos.kertymaJalkeen).toBe(3_152_000);
  });

  it('kun tuloraja on jo ylitetty, koko peruste lisäprosentilla', () => {
    // 3 020,00 × 40 % = 1 208,00
    const h = laskePalkka(syote(t, rivitA), ymp(3_100_000));
    expect(h.tulos.pidatysOsat).toEqual([{ bp: 4000, peruste: 302_000 }]);
    expect(h.tulos.ennakonpidatys).toBe(120_800);
  });

  it('tuloraja täsmälleen täyttyy: yksi osa perusprosentilla', () => {
    const h = laskePalkka(syote(t, rivitA), ymp(2_698_000));
    expect(h.tulos.pidatysOsat).toEqual([{ bp: 2000, peruste: 302_000 }]);
    expect(h.tulos.kertymaJalkeen).toBe(3_000_000);
  });

  it('osien pyöristys tehdään kerran koko pidätykselle', () => {
    // Tuloraja 30 000,00, aiempi 29 999,97 -> 0,03 × 10 % + 1,01 × 30 %
    // = 0,003 + 0,303 = 0,306 -> 0,31 (osittain pyöristäen tulisi 0,00 + 0,30 = 0,30)
    const t2 = tyontekija({ verokortit: [kortti(1000, 3000)] });
    const h = laskePalkka(syote(t2, [palkka(104)]), ymp(2_999_997));
    expect(h.tulos.pidatysOsat).toEqual([
      { bp: 1000, peruste: 3 },
      { bp: 3000, peruste: 101 },
    ]);
    expect(h.tulos.ennakonpidatys).toBe(31);
  });

  it('ilman verokorttia 60 % ja varoitus (VH/7526 §6.1.1)', () => {
    // 3 000,00 × 60 % = 1 800,00
    const h = laskePalkka(syote(tyontekija(), [palkka(300_000)]), ymp(0));
    expect(h.verokortti).toBeNull();
    expect(h.tulos.pidatysOsat).toEqual([{ bp: 6000, peruste: 300_000 }]);
    expect(h.tulos.ennakonpidatys).toBe(180_000);
    expect(h.tulos.varoitukset).toHaveLength(1);
    expect(h.tulos.varoitukset[0]).toContain('60 %');
    expect(h.tulos.varoitukset.join(' ')).not.toContain(HETU_1990);
  });

  it('pidätys ei ylitä rahapalkkaa', () => {
    // VH/7526 §4.1.2: ennakonpidätystä ei toimiteta rahana maksettua suoritusta suurempana.
    // Henkilö ilman TyEL- ja TVR-velvollisuutta (yli 70 v), jotta testi eristää pidätyksen katon.
    // Raha 100,00 + ravintoetu 20 × 15,00 € (kustannus yli ylärajan 14,00 -> arvo kustannus)
    // = 300,00; peruste 400,00 × 50 % = 200,00 > raha 100,00 -> pidätys 100,00.
    const t2 = tyontekija({ hetu: HETU_1955, verokortit: [kortti(5000, 5000)] });
    const h = laskePalkka(
      syote(t2, [
        palkka(10_000),
        { laji: 'ravintoetu', selite: 'Lounaat', maara: 2000, ahinta: c(1500) },
      ]),
      ymp(0),
    );
    expect(h.tulos.luontoisedut).toBe(30_000);
    expect(h.tulos.ennakonpidatys).toBe(10_000);
    expect(h.tulos.varoitukset).toHaveLength(1);
    expect(h.tulos.nettopalkka).toBeGreaterThanOrEqual(0);
    expect(h.tulos.nettopalkka).toBe(0);
  });

  it('pidätyksen katto työntekijällä: työntekijän maksut voivat tehdä nettopalkasta negatiivisen', () => {
    // MVP: pidätys katotaan rahapalkkaan, työntekijän maksuja ei; molemmista varoitus.
    // Peruste 400,00: TyEL 400,00 × 7,30 % = 29,20; TVR 400,00 × 0,89 % = 3,56
    // netto: 100,00 - 100,00 - 29,20 - 3,56 = -32,76
    const t2 = tyontekija({ verokortit: [kortti(5000, 5000)] });
    const h = laskePalkka(
      syote(t2, [
        palkka(10_000),
        { laji: 'ravintoetu', selite: 'Lounaat', maara: 2000, ahinta: c(1500) },
      ]),
      ymp(0),
    );
    expect(h.tulos.ennakonpidatys).toBe(10_000);
    expect(h.tulos.nettopalkka).toBe(-3276);
    expect(h.tulos.varoitukset).toHaveLength(2);
  });

  it('tammikuu ilman uutta korttia', () => {
    // VH/7526 §4.3.3: tammikuussa voi käyttää edellisen vuoden verokorttia.
    const t2 = tyontekija({
      verokortit: [kortti(2000, 4000, 3_000_000, '2025-01-01', '2025-12-31')],
    });
    const tammi = laskePalkka(syote(t2, [palkka(300_000)], '2026-01-15'), ymp(0));
    expect(tammi.verokortti?.tammikuuSaanto).toBe(true);
    expect(tammi.verokortti?.perusBp).toBe(2000);
    // 3 000,00 × 20 % = 600,00
    expect(tammi.tulos.ennakonpidatys).toBe(60_000);

    const helmi = laskePalkka(syote(t2, [palkka(300_000)], '2026-02-15'), ymp(0));
    expect(helmi.verokortti).toBeNull();
    // 3 000,00 × 60 % = 1 800,00
    expect(helmi.tulos.ennakonpidatys).toBe(180_000);
    expect(helmi.tulos.varoitukset.some((v) => v.includes('60 %'))).toBe(true);
  });
});

describe('laskePalkka: rivit', () => {
  const t = tyontekija({ verokortit: [kortti(2000, 4000)] });

  it('ravintoetu arvo', () => {
    // Työnantajan kustannus ateriaa kohti välillä 8,80-14,00 -> arvo 8,80; muuten kustannus.
    const etu = (ahinta: number) =>
      laskePalkka(
        syote(t, [
          palkka(300_000),
          { laji: 'ravintoetu', selite: 'Lounaat', maara: 100, ahinta: c(ahinta) },
        ]),
        ymp(0),
      ).tulos.luontoisedut;
    expect(etu(1050)).toBe(880);
    expect(etu(1500)).toBe(1500);
    expect(etu(700)).toBe(700);
    expect(etu(880)).toBe(880); // alaraja kuuluu väliin
    expect(etu(1400)).toBe(880); // yläraja kuuluu väliin
    expect(etu(1401)).toBe(1401);
  });

  it('matkakorvaus edellisen vuoden taulukolla', () => {
    // Matkapäivä 20.12.2025 -> 2025 km-korvaus 0,59 €/km, vaikka maksetaan 2026.
    const h = laskePalkka(
      syote(
        t,
        [palkka(300_000), { laji: 'km', selite: 'Oulu', maara: 10_000, pvm: '2025-12-20' }],
        '2026-01-10',
      ),
      ymp(0),
    );
    const km = h.rivit.find((r) => r.laji === 'km');
    expect(km?.ahinta).toBe(59);
    expect(km?.summa).toBe(5900); // 100 km × 0,59
  });

  it('km ilman päivää käyttää kauden loppupäivää', () => {
    const s = syote(t, [{ laji: 'km', selite: 'Tampere', maara: 1250 }], '2026-01-10');
    s.kausiLoppuu = '2025-12-31';
    // 12,50 km × 0,59 = 7,375 -> 7,38
    expect(laskePalkka(s, ymp(0)).tulos.verovapaat).toBe(738);
  });

  it('päivärahat ja ateriakorvaus', () => {
    // koko 2 × 54,00 = 108,00; osa 1 × 25,00; ateria 3 × 13,50 = 40,50; kulukorvaus 45,90
    const h = laskePalkka(
      syote(t, [
        palkka(300_000),
        { laji: 'kokopaivaraha', selite: 'Turku', maara: 200 },
        { laji: 'osapaivaraha', selite: 'Lahti', maara: 100 },
        { laji: 'ateriakorvaus', selite: 'Kotka', maara: 300 },
        { laji: 'kulukorvaus', selite: 'Junaliput', summa: c(4590), tili: 7500 },
      ]),
      ymp(0),
    );
    expect(h.rivit.map((r) => r.summa)).toEqual([300_000, 10_800, 2500, 4050, 4590]);
    expect(h.tulos.verovapaat).toBe(21_940);
    expect(h.tulos.pidatysperuste).toBe(300_000); // verovapaat eivät kuulu perusteeseen
    // netto: 3 000,00 + 219,40 - 600,00 - 219,00 - 26,70 = 2 373,70
    expect(h.tulos.nettopalkka).toBe(237_370);
  });

  it('päivärahojen määrän on oltava kokonaisluku', () => {
    expect(() =>
      laskePalkka(syote(t, [{ laji: 'kokopaivaraha', selite: 'x', maara: 150 }]), ymp(0)),
    ).toThrow(PalkatVirhe);
  });

  it('kuukausipalkka, lisä ja kulukorvaus vaativat summan', () => {
    for (const laji of ['kuukausipalkka', 'lisa', 'kulukorvaus'] as const) {
      expect(() => laskePalkka(syote(t, [{ laji, selite: 'x' }]), ymp(0))).toThrow(PalkatVirhe);
    }
  });

  it('tuntipalkka vaatii määrän ja hinnan', () => {
    expect(() =>
      laskePalkka(syote(t, [{ laji: 'tuntipalkka', selite: 'x', maara: 100 }]), ymp(0)),
    ).toThrow(PalkatVirhe);
  });

  it('lisä on veronalaista palkkaa', () => {
    const h = laskePalkka(
      syote(t, [palkka(300_000), { laji: 'lisa', selite: 'Bonus', summa: c(50_000) }]),
      ymp(0),
    );
    expect(h.tulos.rahapalkka).toBe(350_000);
    expect(h.tulos.pidatysperuste).toBe(350_000);
  });
});

describe('laskePalkka: maksut ja ikärajat', () => {
  it('ikäraja: 2025 55-vuotias maksaa korotetun TyEL-osuuden', () => {
    // 2025: 53-62-vuotiaiden työntekijän TyEL 8,65 %; kokonais 25,28 %.
    // 3 000,00 × 8,65 % = 259,50; työnantaja 3 000,00 × (25,28 - 8,65 = 16,63 %) = 498,90
    const t = tyontekija({
      hetu: HETU_1970,
      verokortit: [kortti(2000, 4000, 3_000_000, '2025-01-01', '2025-12-31')],
    });
    const h = laskePalkka(syote(t, [palkka(300_000)], '2025-06-15'), ymp(0));
    expect(h.prosentit.tyelTyontekijaBp).toBe(865);
    expect(h.tulos.tyelTyontekija).toBe(25_950);
    expect(h.tulos.tyelTyonantaja).toBe(49_890);
  });

  it('ikäraja: 2026 55-vuotias maksaa normaalin osuuden (korotus poistui)', () => {
    const t = tyontekija({ hetu: HETU_1970, verokortit: [kortti(2000, 4000)] });
    const h = laskePalkka(syote(t, [palkka(300_000)], '2026-06-15'), ymp(0));
    expect(h.prosentit.tyelTyontekijaBp).toBe(730);
  });

  it('ikäraja: 70-vuotias ei maksa TyEL- eikä TVR-maksuja eikä työnantaja savaa', () => {
    // Synt. 1.1.1956: TyEL-yläraja 68 v (synt. ennen 1958), TVR 65 v, sava 68 v -> kaikki päättyneet.
    const t = tyontekija({ hetu: HETU_1956, verokortit: [kortti(2000, 4000)] });
    const h = laskePalkka(syote(t, [palkka(300_000)], '2026-06-15'), ymp(0));
    expect(h.tulos).toMatchObject({
      tyelTyontekija: 0,
      tyelTyonantaja: 0,
      tvrTyontekija: 0,
      tvrTyonantaja: 0,
      sava: 0,
      nettopalkka: 240_000, // 3 000,00 - 600,00
    });
    expect(h.prosentit).toEqual({
      tyelTyontekijaBp: 0,
      tyelKokonaisBp: 0,
      tvrTyontekijaBp: 0,
      tvrTyonantajaBp: 0,
      savaBp: 0,
    });
  });

  it('kirjan oma TyEL-kokonaisprosentti ohittaa taulukon', () => {
    // 3 000,00 × (26,00 - 7,30 = 18,70 %) = 561,00
    const t = tyontekija({ verokortit: [kortti(2000, 4000)] });
    const a: PalkatAsetukset = { ...ASETUKSET, tyelKokonaisBp: { '2026': 2600 } };
    const h = laskePalkka(syote(t, [palkka(300_000)]), ymp(0, a));
    expect(h.prosentit.tyelKokonaisBp).toBe(2600);
    expect(h.tulos.tyelTyonantaja).toBe(56_100);
  });

  it('tilapäinen työnantaja käyttää tilapäisen työnantajan prosenttia', () => {
    // 3 000,00 × (25,85 - 7,30 = 18,55 %) = 556,50
    const t = tyontekija({ verokortit: [kortti(2000, 4000)] });
    const h = laskePalkka(
      syote(t, [palkka(300_000)]),
      ymp(0, { ...ASETUKSET, tilapainenTyonantaja: true }),
    );
    expect(h.prosentit.tyelKokonaisBp).toBe(2585);
    expect(h.tulos.tyelTyonantaja).toBe(55_650);
  });

  it('työnantajan TVR-vapautus (palkkasumma alle rajan)', () => {
    const t = tyontekija({ verokortit: [kortti(2000, 4000)] });
    const h = laskePalkka(syote(t, [palkka(300_000)]), ymp(0, { ...ASETUKSET, tvrVapautus: true }));
    expect(h.tulos.tvrTyonantaja).toBe(0);
    expect(h.prosentit.tvrTyonantajaBp).toBe(0);
    expect(h.tulos.tvrTyontekija).toBe(2670); // 3 000,00 × 0,89 %
  });

  it('TyEL-alarajan alittava maksu antaa varoituksen mutta lasketaan', () => {
    // 50,00 < 71,72 (TyEL-alaraja 2026); TyEL 50,00 × 7,30 % = 3,65
    const t = tyontekija({ verokortit: [kortti(2000, 4000)] });
    const h = laskePalkka(syote(t, [palkka(5000)]), ymp(0));
    expect(h.tulos.tyelTyontekija).toBe(365);
    expect(h.tulos.varoitukset).toHaveLength(1);
    expect(h.tulos.varoitukset[0]).toContain('alaraja');
  });

  it('virheellinen henkilötunnus on syötevirhe eikä viesti sisällä tunnusta', () => {
    const t = tyontekija({ hetu: '010190-9000' });
    try {
      laskePalkka(syote(t, [palkka(300_000)]), ymp(0));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PalkatVirhe);
      expect((e as PalkatVirhe).koodi).toBe('SYOTE');
      expect((e as Error).message).not.toContain('010190');
    }
  });
});

describe('laskePalkka: taulukot', () => {
  const t = tyontekija();

  it('2027 km-rivi toimii, vaikka maksuprosentit puuttuvat', () => {
    // 100 km × 0,58 € (2027)
    const h = laskePalkka(
      syote(t, [{ laji: 'km', selite: 'Kuopio', maara: 10_000 }], '2027-01-15'),
      ymp(0),
    );
    expect(h.tulos.verovapaat).toBe(5800);
    expect(h.tulos.nettopalkka).toBe(5800);
    expect(h.tulos.ennakonpidatys).toBe(0);
    expect(h.tulos.varoitukset).toEqual([]);
  });

  it('2027 palkanmaksu heittää TAULUKKO_PUUTTUU', () => {
    try {
      laskePalkka(syote(t, [palkka(300_000)], '2027-01-15'), ymp(0));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PalkatVirhe);
      const v = e as PalkatVirhe;
      expect(v.koodi).toBe('TAULUKKO_PUUTTUU');
      const tiedot = v.tiedot as { vuosi: number; puuttuvat: string[] };
      expect(tiedot.vuosi).toBe(2027);
      expect(tiedot.puuttuvat).toContain('savaBp');
    }
  });

  it('taulukkoHaku käyttää kirjan ohitusta', () => {
    const haku = taulukkoHaku({ '2027': { savaBp: 200 } });
    expect(haku(2027, ['savaBp']).savaBp).toBe(200);
    expect(() => haku(2027, ['tyelTyontekijaBp'])).toThrow(PalkatVirhe);
    expect(haku(2026).savaBp).toBe(191);
  });
});

describe('viralliset esimerkit', () => {
  it('VH/7526 §6.1.2 esimerkki 8: ennakko ja loppupalkka saman kortin kertymässä', () => {
    // Ennakonpidätyksen toimittaminen VH/7526/00.01.00/2025, §6.1.2 esimerkki 8:
    // kuukausipalkka 3 000 €; ennakko 1 000 € (25 %) -> pidätys 250 €, nettona 750 €;
    // loppupalkka 2 000 € -> pidätys 500 €, nettona 1 500 €.
    // Henkilö on yli TyEL- ja TVR-ikärajan, jotta nettosummat vastaavat esimerkkiä
    // (esimerkki ei käsittele työntekijän maksuja).
    const t = tyontekija({ hetu: HETU_1955, verokortit: [kortti(2500, 4500, 4_000_000)] });
    const ennakko = laskePalkka(
      syote(t, [{ laji: 'lisa', selite: 'Palkkaennakko', summa: c(100_000) }], '2026-02-01'),
      ymp(0),
    );
    expect(ennakko.tulos.ennakonpidatys).toBe(25_000);
    expect(ennakko.tulos.nettopalkka).toBe(75_000);

    const loppu = laskePalkka(
      syote(t, [palkka(200_000)], '2026-02-15'),
      ymp(ennakko.tulos.kertymaJalkeen),
    );
    expect(loppu.tulos.ennakonpidatys).toBe(50_000);
    expect(loppu.tulos.nettopalkka).toBe(150_000);
    expect(loppu.tulos.kertymaJalkeen).toBe(300_000);
  });

  it('VH/7272 §7.4 esimerkki 8: sava 1,87 % (2025)', () => {
    // Työnantajan sairausvakuutusmaksu VH/7272/00.01.00/2025, §7.4 esimerkki 8:
    // vähennys = 600 euroa × 1,87 % (vuoden 2025 sava-prosentti). Ohje ei kirjoita tulosta auki;
    // 600,00 × 1,87 % = 11,22 on oma laskumme. Sama kaava kuin palkan savassa: 600 € palkka 2025.
    const t = tyontekija({
      verokortit: [kortti(2000, 4000, 3_000_000, '2025-01-01', '2025-12-31')],
    });
    const h = laskePalkka(syote(t, [palkka(60_000)], '2025-04-15'), ymp(0));
    expect(h.prosentit.savaBp).toBe(187);
    expect(h.tulos.sava).toBe(1122);
  });

  it('VH/7272 §7.4 esimerkki 7: sava 1,91 % (2026)', () => {
    // Sama ohje, esimerkki 7: "7,64 euroa (400 euroa x 1,91 %)" — tulos on ohjeessa.
    const t = tyontekija({ verokortit: [kortti(2000, 4000)] });
    const h = laskePalkka(syote(t, [palkka(40_000)], '2026-04-15'), ymp(0));
    expect(h.tulos.sava).toBe(764);
  });
});

describe('oletusRivit', () => {
  const taulukko = (() => {
    const r = haeTaulukko(2026);
    if (!r.ok) throw new Error('2026 puuttuu');
    return r.taulukko;
  })();

  it('kuukausipalkka ja puhelinetu', () => {
    const t = tyontekija({ kuukausipalkka: c(300_000), puhelinetu: true });
    expect(oletusRivit(t, taulukko, '2026-10-31')).toEqual([
      { laji: 'kuukausipalkka', selite: 'Palkka 10/2026', summa: 300_000 },
      { laji: 'puhelinetu', selite: 'Puhelinetu 10/2026', summa: 2000 },
    ]);
  });

  it('tuntipalkka: tyhjä tuntirivi tuntipalkalla, ei puhelinetua', () => {
    const t = tyontekija({ palkkamuoto: 'tunti', tuntipalkka: c(1250) });
    expect(oletusRivit(t, taulukko, '2026-10-31')).toEqual([
      { laji: 'tuntipalkka', selite: 'Tuntipalkka 10/2026', maara: 0, ahinta: 1250 },
    ]);
  });

  it('oletusrivit kelpaavat laskentaan', () => {
    const t = tyontekija({
      kuukausipalkka: c(300_000),
      puhelinetu: true,
      verokortit: [kortti(2000, 4000)],
    });
    const h = laskePalkka(syote(t, oletusRivit(t, taulukko, '2026-10-31')), ymp(0));
    expect(h.tulos.pidatysperuste).toBe(302_000);
  });
});
