import { TositeTyyppi } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { alustaTila, reducer } from './reducer.js';
import type { TositeEditoriTila } from './types.js';

const alku = (): TositeEditoriTila => alustaTila({ paiva: '2026-06-01' });
const avainN = (t: TositeEditoriTila, i: number): string => {
  const rivi = t.rows[i];
  if (!rivi) throw new Error(`odotettu rivi indeksissä ${i}`);
  return rivi.avain;
};
const avain1 = (t: TositeEditoriTila): string => avainN(t, 0);

describe('alustaTila', () => {
  it('luo yhden tyhjän rivin ja oletukset', () => {
    const t = alku();
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]?.debetSnt).toBe(0);
    expect(t.rows[0]?.kreditSnt).toBe(0);
    expect(t.rows[0]?.tili).toBeUndefined();
    expect(t.tyyppi).toBe(TositeTyyppi.MENO);
    expect(t.sarja).toBe('');
    expect(t.paiva).toBe('2026-06-01');
  });

  it('antaa joka riville uniikin avaimen', () => {
    const t = reducer(alku(), { type: 'addRow' });
    expect(t.rows[0]?.avain).not.toBe(t.rows[1]?.avain);
  });
});

describe('reducer — top fields', () => {
  it('setPaiva / setTyyppi / setSarja / setSelite', () => {
    let t = alku();
    t = reducer(t, { type: 'setPaiva', pvm: '2026-07-15' });
    t = reducer(t, { type: 'setTyyppi', tyyppi: TositeTyyppi.TULO });
    t = reducer(t, { type: 'setSarja', sarja: 'A' });
    t = reducer(t, { type: 'setSelite', selite: 'Lasku 5' });
    expect(t.paiva).toBe('2026-07-15');
    expect(t.tyyppi).toBe(TositeTyyppi.TULO);
    expect(t.sarja).toBe('A');
    expect(t.selite).toBe('Lasku 5');
  });
});

describe('reducer — row edits', () => {
  it('setTili asettaa tilinumeron riville', () => {
    const t0 = alku();
    const t = reducer(t0, { type: 'setTili', avain: avain1(t0), tili: 7800 });
    expect(t.rows[0]?.tili).toBe(7800);
  });

  it('setRiviSelite asettaa rivin seliteen', () => {
    const t0 = alku();
    const t = reducer(t0, { type: 'setRiviSelite', avain: avain1(t0), selite: 'Kahvit' });
    expect(t.rows[0]?.selite).toBe('Kahvit');
  });

  it('setDebet nollaa saman rivin kreditin (toisensa poissulkevat)', () => {
    let t = alku();
    const a = avain1(t);
    t = reducer(t, { type: 'setKredit', avain: a, snt: Euro.fromCents(5_000) });
    t = reducer(t, { type: 'setDebet', avain: a, snt: Euro.fromCents(8_640) });
    expect(t.rows[0]?.debetSnt).toBe(8_640);
    expect(t.rows[0]?.kreditSnt).toBe(0);
  });

  it('setKredit nollaa saman rivin debetin', () => {
    let t = alku();
    const a = avain1(t);
    t = reducer(t, { type: 'setDebet', avain: a, snt: Euro.fromCents(8_640) });
    t = reducer(t, { type: 'setKredit', avain: a, snt: Euro.fromCents(5_000) });
    expect(t.rows[0]?.kreditSnt).toBe(5_000);
    expect(t.rows[0]?.debetSnt).toBe(0);
  });

  it('setDebet 0 ei nollaa kreditiä (vain ei-nolla sulkee pois)', () => {
    let t = alku();
    const a = avain1(t);
    t = reducer(t, { type: 'setKredit', avain: a, snt: Euro.fromCents(5_000) });
    t = reducer(t, { type: 'setDebet', avain: a, snt: Euro.fromCents(0) });
    expect(t.rows[0]?.kreditSnt).toBe(5_000);
  });
});

describe('reducer — addRow / removeRow', () => {
  it('addRow lisää tyhjän rivin loppuun', () => {
    const t = reducer(alku(), { type: 'addRow' });
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]?.tili).toBeUndefined();
  });

  it('addRow afterAvain lisää rivin annetun rivin jälkeen', () => {
    let t = reducer(alku(), { type: 'addRow' }); // 2 rows
    const ensimmainen = avainN(t, 0);
    t = reducer(t, { type: 'addRow', afterAvain: ensimmainen });
    expect(t.rows).toHaveLength(3);
    expect(t.rows[1]?.avain).not.toBe(ensimmainen); // inserted between
  });

  it('removeRow poistaa rivin', () => {
    let t = reducer(alku(), { type: 'addRow' });
    const poistettava = avainN(t, 1);
    t = reducer(t, { type: 'removeRow', avain: poistettava });
    expect(t.rows).toHaveLength(1);
  });

  it('removeRow ei pudota alle yhden rivin — viimeinen tyhjenee', () => {
    const t0 = alku();
    const a = reducer(t0, { type: 'setTili', avain: avain1(t0), tili: 7800 });
    const t = reducer(a, { type: 'removeRow', avain: avain1(a) });
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]?.tili).toBeUndefined(); // cleared, not removed
  });
});

describe('reducer — addBalancingRow', () => {
  it('debet-painotteinen: uusi rivi saa kreditin = erotus, tili undefined, ehdotettu', () => {
    let t = alku();
    t = reducer(t, { type: 'setTili', avain: avain1(t), tili: 7800 });
    t = reducer(t, { type: 'setDebet', avain: avain1(t), snt: Euro.fromCents(8_640) });
    t = reducer(t, { type: 'addBalancingRow' });
    expect(t.rows).toHaveLength(2);
    const uusi = t.rows[1];
    expect(uusi?.kreditSnt).toBe(8_640);
    expect(uusi?.debetSnt).toBe(0);
    expect(uusi?.tili).toBeUndefined();
    expect(uusi?.ehdotettu).toBe(true);
  });

  it('kredit-painotteinen: uusi rivi saa debetin = |erotus|', () => {
    let t = alku();
    t = reducer(t, { type: 'setKredit', avain: avain1(t), snt: Euro.fromCents(5_000) });
    t = reducer(t, { type: 'addBalancingRow' });
    const uusi = t.rows[1];
    expect(uusi?.debetSnt).toBe(5_000);
    expect(uusi?.kreditSnt).toBe(0);
  });

  it('jo tasapainossa: lisää tavallisen tyhjän rivin', () => {
    let t = alku();
    t = reducer(t, { type: 'setDebet', avain: avain1(t), snt: Euro.fromCents(1_000) });
    t = reducer(t, { type: 'addRow' });
    t = reducer(t, { type: 'setKredit', avain: avainN(t, 1), snt: Euro.fromCents(1_000) });
    t = reducer(t, { type: 'addBalancingRow' }); // erotus === 0
    expect(t.rows).toHaveLength(3);
    expect(t.rows[2]?.debetSnt).toBe(0);
    expect(t.rows[2]?.kreditSnt).toBe(0);
    expect(t.rows[2]?.ehdotettu).toBeUndefined();
  });
});

describe('reducer — addBalancingRow pankkitilillä (Kitsas-tapa)', () => {
  const tasaava = (tyyppi: number, pankkitili: number | undefined, ekaTili = 7800) => {
    let t = alku();
    t = reducer(t, { type: 'setTyyppi', tyyppi });
    t = reducer(t, { type: 'setTili', avain: avain1(t), tili: ekaTili });
    t = reducer(t, { type: 'setDebet', avain: avain1(t), snt: Euro.fromCents(1_000) });
    return reducer(t, {
      type: 'addBalancingRow',
      ...(pankkitili !== undefined ? { pankkitili } : {}),
    });
  };

  it('Meno ja Tulo: tasaava rivi saa kirjanpidon pankkitilin', () => {
    expect(tasaava(TositeTyyppi.MENO, 1900).rows[1]?.tili).toBe(1900);
    expect(tasaava(TositeTyyppi.TULO, 1900).rows[1]?.tili).toBe(1900);
  });

  it('Siirto ja Muistio: tili jää tyhjäksi', () => {
    expect(tasaava(TositeTyyppi.SIIRTO, 1900).rows[1]?.tili).toBeUndefined();
    expect(tasaava(TositeTyyppi.MUISTIO, 1900).rows[1]?.tili).toBeUndefined();
  });

  it('ei toista pankkitiliä, jos jokin rivi jo käyttää sitä', () => {
    expect(tasaava(TositeTyyppi.MENO, 1900, 1900).rows[1]?.tili).toBeUndefined();
  });
});

describe('reducer — reset (Tallenna ja uusi)', () => {
  it('säilyttää paivan/tyypin/sarjan, tyhjentää seliten/rivit yhteen tyhjään', () => {
    let t = alku();
    t = reducer(t, { type: 'setPaiva', pvm: '2026-08-20' });
    t = reducer(t, { type: 'setTyyppi', tyyppi: TositeTyyppi.TULO });
    t = reducer(t, { type: 'setSarja', sarja: 'B' });
    t = reducer(t, { type: 'setSelite', selite: 'pois' });
    t = reducer(t, { type: 'setTili', avain: avain1(t), tili: 3000 });
    t = reducer(t, { type: 'addRow' });
    t = reducer(t, { type: 'reset' });
    expect(t.paiva).toBe('2026-08-20');
    expect(t.tyyppi).toBe(TositeTyyppi.TULO);
    expect(t.sarja).toBe('B');
    expect(t.selite).toBe('');
    expect(t.draftId).toBeUndefined();
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]?.tili).toBeUndefined();
  });
});

describe('reducer — alv-koodi ja syöttöperuste', () => {
  it('käänteisen alv:n koodi (24/25/26/29) asettaa netto-syötön, tavallinen palauttaa brutton', () => {
    const t0 = alku();
    const a = avain1(t0);
    for (const koodi of [24, 25, 26, 29]) {
      const t = reducer(t0, { type: 'setAlvKoodi', avain: a, alvKoodi: koodi, alvProsentti: 25.5 });
      expect(t.rows[0]?.bruttoSyotto).toBe(false);
    }
    let t = reducer(t0, { type: 'setAlvKoodi', avain: a, alvKoodi: 24, alvProsentti: 25.5 });
    t = reducer(t, { type: 'setAlvKoodi', avain: a, alvKoodi: 21, alvProsentti: 25.5 });
    expect(t.rows[0]?.bruttoSyotto).toBe(true);
  });

  it('setTili esitäyttää tyhjän rivin alv-oletuksen ja vaihtaa sen tilin vaihtuessa', () => {
    const t0 = alku();
    const a = avain1(t0);
    let t = reducer(t0, {
      type: 'setTili',
      avain: a,
      tili: 3000,
      alv: { alvKoodi: 11, alvProsentti: 25.5 },
    });
    expect(t.rows[0]).toMatchObject({ alvKoodi: 11, alvProsentti: 25.5, alvTililta: true });
    // Toinen tili ilman alv-oletusta tyhjentää esitäytetyn koodin.
    t = reducer(t, {
      type: 'setTili',
      avain: a,
      tili: 1900,
      alv: { alvKoodi: 0, alvProsentti: 0 },
    });
    expect(t.rows[0]).toMatchObject({ tili: 1900, alvKoodi: 0, alvProsentti: 0 });
  });

  it('setTili ei korvaa käyttäjän valitsemaa alv-koodia', () => {
    const t0 = alku();
    const a = avain1(t0);
    let t = reducer(t0, { type: 'setAlvKoodi', avain: a, alvKoodi: 24, alvProsentti: 25.5 });
    t = reducer(t, {
      type: 'setTili',
      avain: a,
      tili: 3000,
      alv: { alvKoodi: 11, alvProsentti: 25.5 },
    });
    expect(t.rows[0]).toMatchObject({ tili: 3000, alvKoodi: 24, bruttoSyotto: false });
  });

  it('tilin käänteisen alv:n oletus asettaa myös netto-syötön', () => {
    const t0 = alku();
    const t = reducer(t0, {
      type: 'setTili',
      avain: avain1(t0),
      tili: 4100,
      alv: { alvKoodi: 25, alvProsentti: 25.5 },
    });
    expect(t.rows[0]).toMatchObject({ alvKoodi: 25, bruttoSyotto: false });
  });
});

describe('reducer — korvaa', () => {
  it('korvaa vaihtaa koko tilan (kuitin täyttö ja sen kumoaminen)', () => {
    const lahto = alustaTila({ paiva: '2026-06-01' });
    const uusi = { ...lahto, selite: 'Kahvila Aamu Oy' };
    expect(reducer(lahto, { type: 'korvaa', tila: uusi })).toBe(uusi);
  });
});

describe('reducer — kohdennus', () => {
  it('setKohdennus asettaa kohdennuksen ja merkkaukset; tyhjä valinta poistaa avaimet', () => {
    let t = alku();
    const a = avain1(t);
    t = reducer(t, { type: 'setKohdennus', avain: a, kohdennus: 1, merkkaukset: [4, 3] });
    expect(t.rows[0]).toMatchObject({ kohdennus: 1, merkkaukset: [3, 4] });
    t = reducer(t, { type: 'setKohdennus', avain: a });
    expect(t.rows[0]).not.toHaveProperty('kohdennus');
    expect(t.rows[0]).not.toHaveProperty('merkkaukset');
    t = reducer(t, { type: 'setKohdennus', avain: a, kohdennus: 0, merkkaukset: [] });
    expect(t.rows[0]).not.toHaveProperty('kohdennus');
    expect(t.rows[0]).not.toHaveProperty('merkkaukset');
  });

  it('tilin vaihto säilyttää rivin kohdennuksen ja merkkaukset (kuten Kitsas)', () => {
    let t = alku();
    const a = avain1(t);
    t = reducer(t, { type: 'setKohdennus', avain: a, kohdennus: 1, merkkaukset: [3] });
    t = reducer(t, { type: 'setTili', avain: a, tili: 1900 });
    expect(t.rows[0]).toMatchObject({ tili: 1900, kohdennus: 1, merkkaukset: [3] });
  });
});
