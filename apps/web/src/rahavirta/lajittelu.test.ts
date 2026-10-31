import type { RahavirtaRivi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  OLETUSLAJITTELU,
  lajitteleRivit,
  onRahavirtaLajittelukentta,
  seuraavaRahavirtaLajittelu,
} from './lajittelu.js';

const c = (n: number) => n as Cents;

function rivi(tosite: number, pvm: string, ylim: Partial<RahavirtaRivi> = {}): RahavirtaRivi {
  return {
    tosite,
    pvm,
    tunniste: tosite,
    sarja: '',
    tyyppi: 200,
    tila: 100,
    netto: c(0),
    alv: c(0),
    summa: c(0),
    avoin: c(0),
    liitteita: 0,
    ...ylim,
  };
}

const lasku = (r: RahavirtaRivi) => r.era !== undefined;
const tosit = (rivit: RahavirtaRivi[]) => rivit.map((r) => r.tosite);

describe('lajitteleRivit', () => {
  const rivit = [
    rivi(1, '2026-03-01', { summa: c(5000), otsikko: 'Banaani', kumppaniNimi: 'Öljy Oy' }),
    rivi(2, '2026-03-03', { summa: c(-100), otsikko: 'appelsiini', era: 7, erapvm: '2026-04-01' }),
    rivi(3, '2026-03-02', { summa: c(20000), kumppaniNimi: 'Aalto' }),
  ];

  it('oletuksena uusin ensin', () => {
    expect(tosit(lajitteleRivit(rivit, OLETUSLAJITTELU, lasku))).toEqual([2, 3, 1]);
  });

  it('summa numeerisesti, negatiivinen pienin', () => {
    expect(tosit(lajitteleRivit(rivit, { kentta: 'summa', suunta: 'nouseva' }, lasku))).toEqual([
      2, 1, 3,
    ]);
    expect(tosit(lajitteleRivit(rivit, { kentta: 'summa', suunta: 'laskeva' }, lasku))).toEqual([
      3, 1, 2,
    ]);
  });

  it('teksti suomalaisittain (kirjainkoko ei ratkaise, Ö lopussa) ja tyhjät aina viimeiseksi', () => {
    expect(tosit(lajitteleRivit(rivit, { kentta: 'otsikko', suunta: 'nouseva' }, lasku))).toEqual([
      2, 1, 3,
    ]);
    expect(tosit(lajitteleRivit(rivit, { kentta: 'kumppani', suunta: 'nouseva' }, lasku))).toEqual([
      3, 1, 2,
    ]);
    expect(tosit(lajitteleRivit(rivit, { kentta: 'kumppani', suunta: 'laskeva' }, lasku))).toEqual([
      1, 3, 2,
    ]);
  });

  it('eräpäivättömät viimeiseksi kumpaankin suuntaan', () => {
    expect(tosit(lajitteleRivit(rivit, { kentta: 'erapvm', suunta: 'laskeva' }, lasku))[0]).toBe(2);
    expect(tosit(lajitteleRivit(rivit, { kentta: 'erapvm', suunta: 'nouseva' }, lasku))[0]).toBe(2);
  });

  it('laji: Lasku ennen Suoraa nousevassa', () => {
    expect(tosit(lajitteleRivit(rivit, { kentta: 'laji', suunta: 'nouseva' }, lasku))[0]).toBe(2);
  });

  it('ei muuta syötettä', () => {
    const kopio = [...rivit];
    lajitteleRivit(rivit, { kentta: 'summa', suunta: 'nouseva' }, lasku);
    expect(rivit).toEqual(kopio);
  });
});

describe('seuraavaRahavirtaLajittelu', () => {
  it('uusi sarake nousevaksi, sitten laskevaksi, sitten takaisin oletukseen', () => {
    const a = seuraavaRahavirtaLajittelu(OLETUSLAJITTELU, 'summa');
    expect(a).toEqual({ kentta: 'summa', suunta: 'nouseva' });
    const b = seuraavaRahavirtaLajittelu(a, 'summa');
    expect(b).toEqual({ kentta: 'summa', suunta: 'laskeva' });
    expect(seuraavaRahavirtaLajittelu(b, 'summa')).toEqual(OLETUSLAJITTELU);
  });

  it('päivämäärä vain kääntyy', () => {
    const a = seuraavaRahavirtaLajittelu(OLETUSLAJITTELU, 'pvm');
    expect(a).toEqual({ kentta: 'pvm', suunta: 'nouseva' });
    expect(seuraavaRahavirtaLajittelu(a, 'pvm')).toEqual(OLETUSLAJITTELU);
  });
});

it('tunnistaa vain lajiteltavat sarakkeet', () => {
  expect(onRahavirtaLajittelukentta('summa')).toBe(true);
  expect(onRahavirtaLajittelukentta('maksu')).toBe(false);
  expect(onRahavirtaLajittelukentta(undefined)).toBe(false);
});
