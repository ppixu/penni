import type { ErantyneetToistot, Toisto, Tuote, Vakioviite } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { WireErantyneetToistotSchema } from '../schema/wire.js';
import {
  decodeErantyneetToistot,
  decodeToisto,
  decodeTuote,
  decodeVakioviite,
  decodeVakioviiteSyote,
  encodeErantyneetToistot,
  encodeToisto,
  encodeTuote,
  encodeVakioviite,
} from './laskutusRekisterit.js';

describe('laskutuksen rekisterien koodekit', () => {
  it('tuote: aNetto pysyy numerona ja tuntemattomat avaimet säilyvät', () => {
    const t: Tuote = {
      id: 3,
      nimike: 'Työ',
      aNetto: 80.5,
      alvKoodi: 1,
      alvProsentti: 25.5,
      nimi: { fi: 'Työ', sv: 'Arbete' },
    };
    const w = encodeTuote(t);
    expect(w.aNetto).toBe(80.5);
    expect(decodeTuote(w)).toEqual(t);
  });

  it('tuote: puuttuva id jää pois, merkkijono-id muuttuu numeroksi', () => {
    const uusi = decodeTuote({ nimike: 'A', aNetto: 1, alvKoodi: 0, alvProsentti: 0 });
    expect('id' in uusi).toBe(false);
    expect(decodeTuote({ id: '7', nimike: 'A', aNetto: 1, alvKoodi: 0, alvProsentti: 0 }).id).toBe(
      7,
    );
  });

  it('erääntyneiden toistojen tulos: epäonnistuneet pyörivät ympäri, tyhjä lista jää pois', () => {
    const t: ErantyneetToistot = {
      luodut: [4],
      epaonnistuneet: [
        { toisto: 2, nimi: 'Vuokra', virhe: 'EIRIVEJA' },
        { toisto: 3, virhe: 'X' },
      ],
    };
    const w = encodeErantyneetToistot(t);
    expect(WireErantyneetToistotSchema.parse(w)).toEqual(w);
    expect(decodeErantyneetToistot(w)).toEqual(t);
    expect(decodeErantyneetToistot({ luodut: [], epaonnistuneet: [] })).toEqual({ luodut: [] });
    expect(decodeErantyneetToistot({ luodut: [] })).toEqual({ luodut: [] });
  });

  it('vakioviite pyörii ympäri', () => {
    const v: Vakioviite = { viite: '1009', tili: 3000, kohdennus: 2, otsikko: 'Jäsenmaksu' };
    expect(decodeVakioviite(encodeVakioviite(v))).toEqual(v);
    expect(decodeVakioviiteSyote({ otsikko: 'X', tili: 3000 })).toEqual({
      otsikko: 'X',
      tili: 3000,
    });
  });

  it('toisto: pohjan rivit kulkevat laskuriveinä ja palaavat rikkaiksi', () => {
    const t: Toisto = {
      id: 1,
      kuukausia: 1,
      seuraava: '2026-07-01',
      aktiivinen: true,
      pohja: {
        maksutapa: 1,
        maksuaikaPaivia: 14,
        rivit: [{ myyntiKpl: 2, aNetto: 49.9, alvKoodi: 1, alvProsentti: 25.5, selite: 'Palvelu' }],
      },
    };
    const w = encodeToisto(t) as { pohja: { rivit: Record<string, unknown>[] } };
    expect(w.pohja.rivit[0]).toEqual({
      myyntikpl: 2,
      ahinta: 49.9,
      alvkoodi: 1,
      alvprosentti: 25.5,
      selite: 'Palvelu',
    });
    expect(decodeToisto(w)).toEqual(t);
  });
});
