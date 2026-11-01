import { describe, expect, it } from 'vitest';
import {
  budjettivertailuParametrit,
  kohdennusRaporttiParametrit,
  raporttiParametrit,
  saldotParametrit,
  tositeSuodatin,
  viennitSuodatin,
} from './pyynnot.js';

/**
 * Numeeriset kyselyparametrit kulkevat kaikki numero()-apurin läpi. Ilman kelpoisuustarkistusta
 * Number('abc') on NaN, joka päätyy suodattimeen ja sieltä ajurille: muistilla ja SQLitellä
 * vertailu on aina epätosi (tyhjä tulos), Postgresissa INTEGER-sarakkeen sidonta kaatuu
 * ("invalid input syntax for type integer: NaN") ja pyyntö palauttaa paljaan 500:n. Sama syöte
 * ei saa käyttäytyä eri tavoin ajurista riippuen, joten kelvoton luku pudotetaan suodattimesta.
 */
describe('numeeristen kyselyparametrien kelpoisuus', () => {
  it('pudottaa kelvottoman kumppanin tositesuodattimesta', () => {
    expect(tositeSuodatin({ kumppani: 'abc' })).toEqual({});
  });

  it('pudottaa kelvottoman tyypin tositesuodattimesta', () => {
    expect(tositeSuodatin({ tyyppi: 'roska' })).toEqual({});
  });

  it('pudottaa kelvottoman tilin vientisuodattimesta', () => {
    expect(viennitSuodatin({ tili: 'abc' })).toEqual({});
  });

  it('pudottaa kelvottoman tilin ja kohdennuksen saldoparametreista', () => {
    expect(saldotParametrit({ pvm: '2026-12-31', tili: 'abc', kohdennus: 'xyz' })).toEqual({
      pvm: '2026-12-31',
    });
  });

  it('pudottaa myös Infinityn', () => {
    expect(tositeSuodatin({ kumppani: 'Infinity' })).toEqual({});
  });

  it('säilyttää kelvolliset luvut, myös nollan', () => {
    expect(tositeSuodatin({ kumppani: '0', tyyppi: '100' })).toEqual({ kumppani: 0, tyyppi: 100 });
    expect(viennitSuodatin({ tili: '1900' })).toEqual({ tili: 1900 });
  });
});

describe('tositeSuodatin', () => {
  it('maps query strings to a TositeFilter, omitting empties, coercing numbers', () => {
    expect(
      tositeSuodatin({ bucket: 'luonnos', alkupvm: '2026-01-01', kumppani: '42', tyyppi: '100' }),
    ).toEqual({ bucket: 'luonnos', alkupvm: '2026-01-01', kumppani: 42, tyyppi: 100 });
  });
  it('ignores an invalid bucket (defaults downstream to kirjanpidossa)', () => {
    expect(tositeSuodatin({ bucket: 'roska' })).toEqual({});
  });
  it('is empty for no query', () => {
    expect(tositeSuodatin({})).toEqual({});
  });
});

describe('viennitSuodatin', () => {
  it('maps alkupvm/loppupvm/tili', () => {
    expect(viennitSuodatin({ alkupvm: '2026-01-01', tili: '1900' })).toEqual({
      alkupvm: '2026-01-01',
      tili: 1900,
    });
  });
});

describe('saldotParametrit', () => {
  it('requires pvm and maps presence flags + numeric params', () => {
    expect(saldotParametrit({ pvm: '2026-12-31', tase: 'true', tili: '1900' })).toEqual({
      pvm: '2026-12-31',
      tase: true,
      tili: 1900,
    });
  });
  it('treats false/0/empty flags as absent', () => {
    expect(saldotParametrit({ pvm: '2026-12-31', tase: 'false', alkusaldot: '' })).toEqual({
      pvm: '2026-12-31',
    });
  });
  it('maps alkusaldot + tuloslaskelma + kohdennus', () => {
    expect(
      saldotParametrit({
        pvm: '2026-12-31',
        tuloslaskelma: '1',
        alkusaldot: 'true',
        kohdennus: '7',
      }),
    ).toEqual({ pvm: '2026-12-31', tuloslaskelma: true, alkusaldot: true, kohdennus: 7 });
  });
});

describe('kohdennusparametrit', () => {
  it('raportin kohdennus 0 (Yleinen) säilyy, kelvoton pudotetaan', () => {
    const q = { muoto: 'tulos/yleinen', pvm: '2026-12-31' };
    expect(raporttiParametrit({ ...q, kohdennus: '0' }).kohdennus).toBe(0);
    expect(raporttiParametrit({ ...q, kohdennus: '7' }).kohdennus).toBe(7);
    expect(raporttiParametrit({ ...q, kohdennus: 'abc' })).not.toHaveProperty('kohdennus');
    expect(raporttiParametrit(q)).not.toHaveProperty('kohdennus');
  });

  it('kohdennusraportin ja budjettivertailun kyselyt kääntyvät moottorin parametreiksi', () => {
    expect(
      kohdennusRaporttiParametrit({
        muoto: 'tulos/yleinen',
        alkupvm: '2026-01-01',
        pvm: '2026-12-31',
        laji: 'projektit',
        kustannuspaikka: '0',
      }),
    ).toEqual({
      muoto: 'tulos/yleinen',
      alkupvm: '2026-01-01',
      pvm: '2026-12-31',
      laji: 'projektit',
      kustannuspaikka: 0,
    });
    expect(
      budjettivertailuParametrit({
        muoto: 'tulos/yleinen',
        tilikausi: '2026-01-01',
        kohdennus: 'x',
      }),
    ).toEqual({ muoto: 'tulos/yleinen', tilikausi: '2026-01-01' });
  });
});
