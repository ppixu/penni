import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { type Tili, lataaKartta } from '../accounts/tili.js';
import { VientiTyyppi } from '../vouchers/enums.js';
import { type VerollinenRivi, generoiVeroviennit } from './generoiVeroviennit.js';
import { AlvKoodi } from './koodit.js';

const c = (n: number): Cents => n as Cents;
// Minimal chart with the two VAT accounts (BL=ALVVELKA, AL=ALVSAATAVA) + a revenue + expense.
const CHART: Tili[] = lataaKartta([
  { numero: 2939, tyyppi: 'BL', nimi: { fi: 'ALV-velka' } },
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
]);
// Sama kartta + maksuperusteisen alv:n kohdentamaton saatavatili (ALM).
const CHART_MAKSUPERUSTEINEN: Tili[] = lataaKartta([
  { numero: 2939, tyyppi: 'BL', nimi: { fi: 'ALV-velka' } },
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
  { numero: 1764, tyyppi: 'ALM', nimi: { fi: 'Kohdentamaton ALV-saatava' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
]);
const PVM = '2026-03-01';

function rivi(yli: Partial<VerollinenRivi>): VerollinenRivi {
  return {
    tili: 3000,
    alvKoodi: AlvKoodi.MYYNNIT_NETTO,
    alvProsentti: 25.5,
    maara: c(12550),
    bruttoSyotto: true,
    puoli: 'kredit',
    pvm: PVM,
    ...yli,
  };
}

describe('generoiVeroviennit', () => {
  it('kotimaan myynti (netto), brutto-syöttö: netto myyntitilille + suoritettava ALV-velkaan', () => {
    const v = generoiVeroviennit([rivi({})], CHART);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ tili: 3000, kredit: 10000, debet: 0, alvKoodi: 11 });
    expect(v[1]).toMatchObject({ tili: 2939, kredit: 2550, debet: 0, alvKoodi: 111 });
  });

  it('kotimaan osto (netto): netto kululle + vähennettävä ALV-saatavaan (debet)', () => {
    const v = generoiVeroviennit(
      [rivi({ tili: 4000, alvKoodi: AlvKoodi.OSTOT_NETTO, puoli: 'debet', maara: c(12550) })],
      CHART,
    );
    expect(v[0]).toMatchObject({ tili: 4000, debet: 10000, alvKoodi: 21 });
    expect(v[1]).toMatchObject({ tili: 1763, debet: 2550, alvKoodi: 221 });
  });

  it('brutto-koodi (12): kirjaa bruttona ilman ALV-vientiä', () => {
    const v = generoiVeroviennit(
      [rivi({ alvKoodi: AlvKoodi.MYYNNIT_BRUTTO, maara: c(12550) })],
      CHART,
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ tili: 3000, kredit: 12550, alvKoodi: 12 });
  });

  it('käänteinen (rakennuspalvelun osto): sekä velka että saatava, nettovaikutus 0', () => {
    const v = generoiVeroviennit(
      [
        rivi({
          tili: 4000,
          alvKoodi: AlvKoodi.RAKENNUSPALVELU_OSTO,
          puoli: 'debet',
          bruttoSyotto: false,
          maara: c(10000),
        }),
      ],
      CHART,
    );
    // base net 10000 debet expense; output 2550 credit ALVVELKA; deductible 2550 debet ALVSAATAVA
    expect(v[0]).toMatchObject({ tili: 4000, debet: 10000, alvKoodi: 26 });
    expect(v.find((x) => x.tili === 2939)).toMatchObject({ kredit: 2550, alvKoodi: 126 });
    expect(v.find((x) => x.tili === 1763)).toMatchObject({ debet: 2550, alvKoodi: 226 });
  });

  it('palveluosto EU:n ulkopuolelta (maahantuonti 29): käänteinen alv, nettovaikutus 0', () => {
    const v = generoiVeroviennit(
      [
        rivi({
          tili: 4000,
          alvKoodi: AlvKoodi.MAAHANTUONTI_PALVELUT,
          puoli: 'debet',
          bruttoSyotto: false,
          maara: c(2000),
        }),
      ],
      CHART,
    );
    // base net 2000 debet; output 510 credit ALVVELKA (129); deductible 510 debet ALVSAATAVA (229)
    expect(v[0]).toMatchObject({ tili: 4000, debet: 2000, alvKoodi: 29 });
    expect(v.find((x) => x.tili === 2939)).toMatchObject({ kredit: 510, alvKoodi: 129 });
    expect(v.find((x) => x.tili === 1763)).toMatchObject({ debet: 510, alvKoodi: 229 });
  });

  it('EU-myynti (nollalaji): ei ALV-vientiä, prosentti 0', () => {
    const v = generoiVeroviennit(
      [
        rivi({
          alvKoodi: AlvKoodi.YHTEISOMYYNTI_TAVARAT,
          alvProsentti: 0,
          bruttoSyotto: false,
          maara: c(10000),
        }),
      ],
      CHART,
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ tili: 3000, kredit: 10000, alvKoodi: 14, alvProsentti: 0 });
  });

  it('käänteinen ilman vähennysoikeutta: vähennyskelvoton osuus kulutilille (932)', () => {
    const v = generoiVeroviennit(
      [
        rivi({
          tili: 4000,
          alvKoodi: AlvKoodi.RAKENNUSPALVELU_OSTO,
          puoli: 'debet',
          bruttoSyotto: false,
          maara: c(10000),
          alvVahennys: false,
        }),
      ],
      CHART,
    );
    expect(v.find((x) => x.alvKoodi === AlvKoodi.VAHENNYSKELVOTON)).toMatchObject({
      tili: 4000,
      debet: 2550,
    });
    expect(v.find((x) => x.tili === 1763)).toBeUndefined(); // no deductible leg
  });

  it('EIALV: läpivienti ilman ALV-jalkaa', () => {
    const v = generoiVeroviennit(
      [
        rivi({
          tili: 1900,
          alvKoodi: AlvKoodi.EIALV,
          alvProsentti: 0,
          bruttoSyotto: false,
          maara: c(10000),
          puoli: 'debet',
        }),
      ],
      CHART,
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ tili: 1900, debet: 10000, alvKoodi: 0 });
  });

  it('nollaverollinen ostorivi (EIALV) kirjautuu OSTO-suuntaan (101), ei MYYNTI-suuntaan (201)', () => {
    const v = generoiVeroviennit(
      [
        rivi({
          tili: 4000,
          alvKoodi: AlvKoodi.EIALV,
          alvProsentti: 0,
          bruttoSyotto: false,
          maara: c(10000),
          puoli: 'debet',
        }),
      ],
      CHART,
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ tyyppi: VientiTyyppi.OSTO + VientiTyyppi.KIRJAUS });
  });

  it('puuttuva ALV-tili heittää selkeän virheen', () => {
    const tyhja = lataaKartta([{ numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } }]);
    expect(() => generoiVeroviennit([rivi({})], tyhja)).toThrow(/ALV-tili/i);
  });

  it('margin purchase (code 23) books the full amount with no VAT leg', () => {
    const legs = generoiVeroviennit(
      [
        {
          tili: 4000,
          alvKoodi: AlvKoodi.OSTOT_MARGINAALI,
          alvProsentti: 25.5,
          maara: c(10_000),
          bruttoSyotto: false,
          puoli: 'debet',
          pvm: '2026-06-01',
        },
      ],
      CHART,
    );
    expect(legs).toHaveLength(1);
    expect(legs[0]?.tili).toBe(4000);
    expect(legs[0]?.debet).toBe(c(10_000)); // full amount, no VAT added
    expect(legs[0]?.alvKoodi).toBe(23);
    expect(legs[0]?.alvProsentti).toBe(25.5); // rate retained for the period-end calc
  });
});

describe('generoiVeroviennit maksuperusteinen', () => {
  it('routes the deductible leg to the KOHDENTAMATON account with code 428 and base code 28', () => {
    const legs = generoiVeroviennit(
      [
        {
          tili: 4000,
          alvKoodi: AlvKoodi.OSTOT_NETTO,
          alvProsentti: 25.5,
          maara: c(10_000),
          bruttoSyotto: false,
          puoli: 'debet',
          pvm: '2026-06-01',
        },
      ],
      CHART_MAKSUPERUSTEINEN,
      true,
    );
    const base = legs.find((v) => v.tili === 4000);
    expect(base?.alvKoodi).toBe(AlvKoodi.MAKSUPERUSTEINEN_OSTO); // 28
    const vat = legs.find((v) => v.tili === 1764); // KOHDENTAMATONALVSAATAVA
    expect(vat?.debet).toBe(c(2_550));
    expect(vat?.alvKoodi).toBe(428);
    expect(vat?.era).toBeUndefined();
    // real ALVSAATAVA (1763) is NOT used under cash-basis
    expect(legs.some((v) => v.tili === 1763)).toBe(false);
  });

  it('accrual (default) is unchanged — deductible leg on the real ALVSAATAVA with code 221', () => {
    const legs = generoiVeroviennit(
      [
        {
          tili: 4000,
          alvKoodi: AlvKoodi.OSTOT_NETTO,
          alvProsentti: 25.5,
          maara: c(10_000),
          bruttoSyotto: false,
          puoli: 'debet',
          pvm: '2026-06-01',
        },
      ],
      CHART_MAKSUPERUSTEINEN,
    );
    expect(legs.find((v) => v.tili === 1763)?.alvKoodi).toBe(221);
    expect(legs.some((v) => v.tili === 1764)).toBe(false);
  });

  it('puuttuva kohdentamaton-tili maksuperusteisessa alv:ssa heittää selkeän virheen', () => {
    const legs = () =>
      generoiVeroviennit(
        [
          {
            tili: 4000,
            alvKoodi: AlvKoodi.OSTOT_NETTO,
            alvProsentti: 25.5,
            maara: c(10_000),
            bruttoSyotto: false,
            puoli: 'debet',
            pvm: '2026-06-01',
          },
        ],
        CHART, // ei sisällä ALM-tiliä
        true,
      );
    expect(legs).toThrow(/kohdentamaton/i);
    try {
      legs();
      expect.unreachable();
    } catch (e) {
      expect((e as { code?: string }).code).toBe('EIKOHDENTAMATONTILIA');
    }
  });

  it('käänteinen osto pysyy suoriteperusteisena maksuperusteisessakin kirjanpidossa', () => {
    const legs = generoiVeroviennit(
      [
        {
          tili: 4000,
          alvKoodi: AlvKoodi.RAKENNUSPALVELU_OSTO,
          alvProsentti: 25.5,
          maara: c(10_000),
          bruttoSyotto: false,
          puoli: 'debet',
          pvm: '2026-06-01',
        },
      ],
      CHART_MAKSUPERUSTEINEN,
      true,
    );
    expect(legs.find((v) => v.tili === 4000)?.alvKoodi).toBe(AlvKoodi.RAKENNUSPALVELU_OSTO);
    expect(legs.find((v) => v.tili === 1763)?.alvKoodi).toBe(226);
    expect(legs.some((v) => v.tili === 1764)).toBe(false);
  });
});

describe('generoiVeroviennit: kohdennus ja merkkaukset', () => {
  it('kopioi kohdennuksen ja normalisoidut merkkaukset jokaiseen vientiin', () => {
    const v = generoiVeroviennit(
      [
        rivi({
          tili: 4000,
          alvKoodi: AlvKoodi.OSTOT_NETTO,
          puoli: 'debet',
          kohdennus: 4,
          merkkaukset: [7, 3, 7],
        }),
      ],
      CHART,
    );
    expect(v).toHaveLength(2);
    for (const x of v) {
      expect(x.kohdennus).toBe(4);
      expect(x.merkkaukset).toEqual([3, 7]);
    }
  });

  it('tyhjä merkkauslista ei tuota avainta', () => {
    const v = generoiVeroviennit([rivi({ merkkaukset: [] })], CHART);
    for (const x of v) expect('merkkaukset' in x).toBe(false);
  });

  it('vientien merkkauslistat ovat erillisiä kopioita', () => {
    const v = generoiVeroviennit([rivi({ merkkaukset: [1] })], CHART);
    v[0]?.merkkaukset?.push(99);
    expect(v[1]?.merkkaukset).toEqual([1]);
  });
});
