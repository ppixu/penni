import { type Tili, lataaKartta } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { johdaViennit } from './johdaViennit.js';
import { alustaTila, reducer } from './reducer.js';
import { laskeSummat } from './summat.js';
import type { VientiRivi } from './types.js';

// Plain (EIALV) rows pass through unchanged, so a chart without VAT accounts suffices here.
const CHART: Tili[] = lataaKartta([{ numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } }]);
const PVM = '2026-06-01';

const rivi = (debet: number, kredit: number): VientiRivi => ({
  avain: `r${debet}-${kredit}`,
  tili: 1900,
  debetSnt: Euro.fromCents(debet),
  kreditSnt: Euro.fromCents(kredit),
  alvKoodi: 0,
  alvProsentti: 0,
  bruttoSyotto: true,
});

describe('laskeSummat', () => {
  it('summaa debetit ja kreditit erikseen sentteinä', () => {
    const s = laskeSummat([rivi(8640, 0), rivi(0, 8640)], CHART, PVM);
    expect(s.debetYht).toBe(8640);
    expect(s.kreditYht).toBe(8640);
    expect(s.erotus).toBe(0);
    expect(s.tasmaa).toBe(true);
  });

  it('laskee erotuksen debet − kredit kun ei täsmää', () => {
    const s = laskeSummat([rivi(10_000, 0), rivi(0, 9_000)], CHART, PVM);
    expect(s.erotus).toBe(1_000);
    expect(s.tasmaa).toBe(false);
  });

  it('negatiivinen erotus kun kredit on suurempi', () => {
    const s = laskeSummat([rivi(0, 5_000), rivi(2_000, 0)], CHART, PVM);
    expect(s.erotus).toBe(-3_000);
    expect(s.tasmaa).toBe(false);
  });

  it('tyhjä lista täsmää (0 − 0 = 0)', () => {
    const s = laskeSummat([], CHART, PVM);
    expect(s.debetYht).toBe(0);
    expect(s.kreditYht).toBe(0);
    expect(s.tasmaa).toBe(true);
  });

  it('summaa monta riviä ilman liukulukuvirhettä', () => {
    // 0,10 + 0,20 in cents = 30 exactly (the classic 0.1+0.2 float trap).
    const s = laskeSummat([rivi(10, 0), rivi(20, 0), rivi(0, 30)], CHART, PVM);
    expect(s.debetYht).toBe(30);
    expect(s.tasmaa).toBe(true);
  });

  it('käänteinen alv (yhteisöhankinta 24) täsmää vastatiliin reducerin syöttöperusteella', () => {
    // Todellinen tapaus: 1161 D 1 282,31 koodilla 24 @ 25,5 % + 2361 K 1 282,31 näytti
    // "Erotus −260,55 €", koska summa tulkittiin verolliseksi (bruttoSyotto oletus true).
    const alvChart = lataaKartta([
      { numero: 1161, tyyppi: 'A', nimi: { fi: 'Ennakkomaksut' } },
      { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Arvonlisäverosaatava' } },
      { numero: 2361, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
    ]);
    let t = alustaTila({ paiva: PVM });
    const a = t.rows[0]?.avain ?? '';
    t = reducer(t, { type: 'setTili', avain: a, tili: 1161 });
    t = reducer(t, { type: 'setDebet', avain: a, snt: Euro.fromCents(128231) });
    t = reducer(t, { type: 'setAlvKoodi', avain: a, alvKoodi: 24, alvProsentti: 25.5 });
    t = reducer(t, { type: 'addBalancingRow' });
    const b = t.rows[1]?.avain ?? '';
    t = reducer(t, { type: 'setTili', avain: b, tili: 2361 });

    const viennit = johdaViennit(t.rows, alvChart, PVM);
    expect(viennit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tili: 1161, debet: 128231, alvKoodi: 24 }),
        expect.objectContaining({ tili: 1763, debet: 32699, alvKoodi: 224 }),
        expect.objectContaining({ tili: 2939, kredit: 32699, alvKoodi: 124 }),
        expect.objectContaining({ tili: 2361, kredit: 128231 }),
      ]),
    );
    expect(laskeSummat(t.rows, alvChart, PVM).tasmaa).toBe(true);
  });
});
