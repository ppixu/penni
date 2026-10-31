import { alustaTila, reducer } from '@/editori/reducer';
import { alustaLaskuTila, laskuReducer } from '@/laskutus/laskuReducer';
import { alustaOstolaskuTila, ostolaskuReducer } from '@/ostolaskut/ostolaskuReducer';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { laskuVertailuun, ostolaskuVertailuun, samatArvot, tositeVertailuun } from './vertailu.js';

describe('samatArvot', () => {
  it('vertaa arvoja syvästi avainjärjestyksestä välittämättä', () => {
    expect(samatArvot({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBe(true);
    expect(samatArvot({ a: 1 }, { a: 2 })).toBe(false);
    expect(samatArvot([1, 2], [1, 2, 3])).toBe(false);
    expect(samatArvot({ a: [] }, { a: {} })).toBe(false);
  });

  it('pitää undefined-arvoista avainta samana kuin puuttuvaa', () => {
    expect(samatArvot({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(samatArvot({ a: 1 }, { a: 1, b: 0 })).toBe(false);
  });
});

describe('tositeVertailuun', () => {
  const pohja = alustaTila({ paiva: '2026-06-01' });
  const rivi1 = () => pohja.rows[0]?.avain ?? '';

  it('muokkaus likaa, muokkauksen peruminen käsin palauttaa puhtaaksi', () => {
    const muokattu = reducer(pohja, { type: 'setSelite', selite: 'Kahvit' });
    expect(samatArvot(tositeVertailuun(pohja), tositeVertailuun(muokattu))).toBe(false);
    const takaisin = reducer(muokattu, { type: 'setSelite', selite: '' });
    expect(samatArvot(tositeVertailuun(pohja), tositeVertailuun(takaisin))).toBe(true);
  });

  it('rivin summa likaa; nollattu summa on taas puhdas', () => {
    const debet = reducer(pohja, { type: 'setDebet', avain: rivi1(), snt: Euro.fromCents(100) });
    expect(samatArvot(tositeVertailuun(pohja), tositeVertailuun(debet))).toBe(false);
    const nolla = reducer(debet, { type: 'setDebet', avain: rivi1(), snt: Euro.fromCents(0) });
    expect(samatArvot(tositeVertailuun(pohja), tositeVertailuun(nolla))).toBe(true);
  });

  it('nollaus (Tallenna ja uusi) on puhdas, vaikka riviavaimet vaihtuvat', () => {
    const nollattu = reducer(pohja, { type: 'reset' });
    expect(nollattu.rows[0]?.avain).not.toBe(pohja.rows[0]?.avain);
    expect(samatArvot(tositeVertailuun(pohja), tositeVertailuun(nollattu))).toBe(true);
  });

  it('tyhjä lisärivi ei liaa lomaketta', () => {
    const lisatty = reducer(pohja, { type: 'addRow' });
    expect(samatArvot(tositeVertailuun(pohja), tositeVertailuun(lisatty))).toBe(true);
  });
});

describe('laskuVertailuun / ostolaskuVertailuun', () => {
  it('myyntilasku: muokkaus likaa, peruminen ja rivin lisäys+poisto ovat puhtaita', () => {
    const pohja = alustaLaskuTila({ laskupvm: '2026-06-01', alvVelvollinen: true });
    const muokattu = laskuReducer(pohja, { type: 'setOtsikko', otsikko: 'Konsultointi' });
    expect(samatArvot(laskuVertailuun(pohja), laskuVertailuun(muokattu))).toBe(false);
    const takaisin = laskuReducer(muokattu, { type: 'setOtsikko', otsikko: '' });
    expect(samatArvot(laskuVertailuun(pohja), laskuVertailuun(takaisin))).toBe(true);

    const lisatty = laskuReducer(pohja, { type: 'lisaaRivi' });
    const uusi = lisatty.rivit[1]?.avain ?? 0;
    const poistettu = laskuReducer(lisatty, { type: 'poistaRivi', avain: uusi });
    expect(samatArvot(laskuVertailuun(pohja), laskuVertailuun(poistettu))).toBe(true);
  });

  it('myyntilasku: kumppanin valinta likaa, sen poisto palauttaa puhtaaksi', () => {
    const pohja = alustaLaskuTila({ laskupvm: '2026-06-01', alvVelvollinen: false });
    const valittu = laskuReducer(pohja, { type: 'setKumppani', kumppani: 3 });
    expect(samatArvot(laskuVertailuun(pohja), laskuVertailuun(valittu))).toBe(false);
    const poistettu = laskuReducer(valittu, { type: 'setKumppani', kumppani: undefined });
    expect(samatArvot(laskuVertailuun(pohja), laskuVertailuun(poistettu))).toBe(true);
  });

  it('ostolasku: rivin hinta likaa, nollaus palauttaa puhtaaksi', () => {
    const pohja = alustaOstolaskuTila({ laskupvm: '2026-06-01', alvVelvollinen: true });
    const avain = pohja.rivit[0]?.avain ?? 0;
    const muokattu = ostolaskuReducer(pohja, {
      type: 'setRivi',
      avain,
      muutos: { aNettoSnt: Euro.fromCents(5_000) },
    });
    expect(samatArvot(ostolaskuVertailuun(pohja), ostolaskuVertailuun(muokattu))).toBe(false);
    const takaisin = ostolaskuReducer(muokattu, {
      type: 'setRivi',
      avain,
      muutos: { aNettoSnt: Euro.fromCents(0) },
    });
    expect(samatArvot(ostolaskuVertailuun(pohja), ostolaskuVertailuun(takaisin))).toBe(true);
  });
});
