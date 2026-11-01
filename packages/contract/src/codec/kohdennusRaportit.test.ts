import type { BudjettivertailuRivi, KohdennusOsio } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  decodeBudjettivertailuRivi,
  decodeKohdennusOsio,
  encodeBudjettivertailuRivi,
  encodeKohdennusOsio,
} from './kohdennusRaportit.js';

describe('kohdennusraporttien koodekit', () => {
  it('kohdennusosio kiertää, tuntematon-lippu mukana', () => {
    const o: KohdennusOsio = {
      kohdennus: { id: 9, nimi: 'Tuntematon kohdennus (9)', polku: 'x', tuntematon: true },
      rivit: [{ teksti: 'Liikevaihto', sisennys: 0, lihava: true, arvo: Euro.fromCents(12345) }],
    };
    const w = encodeKohdennusOsio(o);
    expect(w.rivit[0]?.arvo).toBe('123.45');
    expect(decodeKohdennusOsio(w)).toEqual(o);
  });

  it('budjettivertailurivi kiertää: rahat merkkijonoina, null ja prosentti säilyvät', () => {
    const r: BudjettivertailuRivi = {
      teksti: 'Liikevaihto',
      sisennys: 1,
      lihava: false,
      tili: 3000,
      kaavarivi: 2,
      budjetti: Euro.fromCents(100000),
      toteutunut: Euro.fromCents(-5050),
      ero: Euro.fromCents(-105050),
      prosentti: -505,
    };
    const w = encodeBudjettivertailuRivi(r);
    expect(w).toMatchObject({ budjetti: '1000.00', toteutunut: '-50.50', ero: '-1050.50' });
    expect(decodeBudjettivertailuRivi(w)).toEqual(r);
    const otsikko: BudjettivertailuRivi = {
      teksti: 'Tulot',
      sisennys: 0,
      lihava: true,
      budjetti: null,
      toteutunut: null,
      ero: null,
    };
    const wo = encodeBudjettivertailuRivi(otsikko);
    expect(wo).not.toHaveProperty('prosentti');
    expect(decodeBudjettivertailuRivi(wo)).toEqual(otsikko);
  });
});
