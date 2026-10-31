import { TositeTyyppi, muodostaValidointiKonteksti } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { alustaTila, uusiRivi } from './reducer.js';
import { voiTallentaaKirjattuna, voiTallentaaLuonnoksena } from './tallennuskelpoisuus.js';
import { CHART } from './testHelpers.js';
import type { TositeEditoriTila } from './types.js';

const CTX = muodostaValidointiKonteksti(CHART, [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }], {
  TilitPaatetty: '2026-03-31',
});

function lomake({
  paiva = '2026-06-01',
  debet = 1_000,
  kredit = 1_000,
  vastatili = 1900 as number | null,
} = {}): TositeEditoriTila {
  return alustaTila({
    paiva,
    tyyppi: TositeTyyppi.MENO,
    selite: 'Kahvit',
    rows: [
      uusiRivi({
        tili: 7800,
        debetSnt: Euro.fromCents(debet),
        kreditSnt: Euro.fromCents(0),
        alvKoodi: 0,
        alvProsentti: 0,
        bruttoSyotto: true,
      }),
      uusiRivi({
        ...(vastatili !== null ? { tili: vastatili } : {}),
        debetSnt: Euro.fromCents(0),
        kreditSnt: Euro.fromCents(kredit),
        alvKoodi: 0,
        alvProsentti: 0,
        bruttoSyotto: true,
      }),
    ],
  });
}

describe('voiTallentaaKirjattuna', () => {
  it('täsmäävä tosite avoimella kaudella kelpaa', () => {
    expect(voiTallentaaKirjattuna(lomake(), CHART, CTX)).toEqual({ voi: true });
  });

  it('täsmäämätön: ei täsmää', () => {
    expect(voiTallentaaKirjattuna(lomake({ kredit: 900 }), CHART, CTX)).toEqual({
      voi: false,
      syy: 'ei täsmää',
    });
  });

  it('summa ilman tiliä', () => {
    expect(voiTallentaaKirjattuna(lomake({ vastatili: null }), CHART, CTX)).toEqual({
      voi: false,
      syy: 'rivillä on summa ilman tiliä',
    });
  });

  it('lukittu kausi', () => {
    expect(voiTallentaaKirjattuna(lomake({ paiva: '2026-03-15' }), CHART, CTX)).toEqual({
      voi: false,
      syy: 'päivä osuu lukittuun kauteen',
    });
  });

  it('kauden ulkopuolella', () => {
    expect(voiTallentaaKirjattuna(lomake({ paiva: '2027-01-05' }), CHART, CTX)).toEqual({
      voi: false,
      syy: 'päivälle ei ole avointa tilikautta',
    });
  });
});

describe('voiTallentaaLuonnoksena', () => {
  it('luonnoksen ei tarvitse täsmätä eikä osua avoimeen kauteen', () => {
    expect(voiTallentaaLuonnoksena(lomake({ kredit: 900 }), CHART, CTX)).toEqual({ voi: true });
    expect(voiTallentaaLuonnoksena(lomake({ paiva: '2027-01-05' }), CHART, CTX)).toEqual({
      voi: true,
    });
  });

  it('lukitun kauden luonnosta ei tallenneta', () => {
    expect(voiTallentaaLuonnoksena(lomake({ paiva: '2026-03-15' }), CHART, CTX)).toEqual({
      voi: false,
      syy: 'päivä osuu lukittuun kauteen',
    });
  });
});
