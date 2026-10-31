import { type Tosite, lataaKartta } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import type { Totuus } from './totuus.js';
import { vertaa } from './vertaa.js';

const chart = lataaKartta([
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
  { numero: 4010, tyyppi: 'D', nimi: { fi: 'Ostot' } },
]);

const totuus: Totuus = {
  tositeId: 5,
  pvm: '2025-01-03',
  myyja: 'Patreon',
  brutto: 1244,
  alvYhteensa: 244,
  menot: [{ tili: 4010, netto: 1000, alvKoodi: 21, alvProsentti: 25.5 }],
};

const tosite = (yli: Partial<Tosite> = {}): Tosite => ({
  pvm: '2025-01-03',
  tyyppi: 100,
  tila: 50,
  tunniste: 0,
  sarja: '',
  otsikko: 'Patreon',
  viennit: [
    {
      tili: 4010,
      debet: Euro.fromCents(1000),
      kredit: Euro.fromCents(0),
      pvm: '2025-01-03',
      alvKoodi: 21,
      alvProsentti: 25.5,
    },
    {
      tili: 1763,
      debet: Euro.fromCents(244),
      kredit: Euro.fromCents(0),
      pvm: '2025-01-03',
      alvKoodi: 0,
      alvProsentti: 0,
    },
    {
      tili: 1910,
      debet: Euro.fromCents(0),
      kredit: Euro.fromCents(1244),
      pvm: '2025-01-03',
      alvKoodi: 0,
      alvProsentti: 0,
    },
  ],
  ...yli,
});

const kentta = (r: ReturnType<typeof vertaa>, nimi: string) =>
  r.kentat.find((k) => k.nimi === nimi);

describe('vertaa', () => {
  it('täsmää täysin identtiselle tositteelle', () => {
    const r = vertaa(totuus, tosite(), chart);
    expect(r.taysinTasmaa).toBe(true);
    expect(r.kentat.every((k) => k.ok)).toBe(true);
  });

  it('havaitsee väärän menotilin', () => {
    const vaara = tosite({
      viennit: [
        {
          tili: 7000,
          debet: Euro.fromCents(1000),
          kredit: Euro.fromCents(0),
          pvm: '2025-01-03',
          alvKoodi: 21,
          alvProsentti: 25.5,
        },
        {
          tili: 1763,
          debet: Euro.fromCents(244),
          kredit: Euro.fromCents(0),
          pvm: '2025-01-03',
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 1910,
          debet: Euro.fromCents(0),
          kredit: Euro.fromCents(1244),
          pvm: '2025-01-03',
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });
    const r = vertaa(totuus, vaara, chart);
    expect(kentta(r, 'menotili 4010@25.5')?.ok).toBe(false);
    expect(r.taysinTasmaa).toBe(false);
  });

  it('havaitsee väärän bruttosumman', () => {
    const vaara = tosite({
      viennit: [
        {
          tili: 4010,
          debet: Euro.fromCents(900),
          kredit: Euro.fromCents(0),
          pvm: '2025-01-03',
          alvKoodi: 21,
          alvProsentti: 25.5,
        },
        {
          tili: 1763,
          debet: Euro.fromCents(244),
          kredit: Euro.fromCents(0),
          pvm: '2025-01-03',
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 1910,
          debet: Euro.fromCents(0),
          kredit: Euro.fromCents(1144),
          pvm: '2025-01-03',
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });
    const r = vertaa(totuus, vaara, chart);
    expect(kentta(r, 'brutto')?.ok).toBe(false);
  });

  it('täsmää myyjän aliaksen kautta', () => {
    const r = vertaa({ ...totuus, myyja: 'Anysphere' }, tosite({ otsikko: 'Cursor' }), chart, [
      ['anysphere', 'cursor'],
    ]);
    expect(kentta(r, 'myyja')?.ok).toBe(true);
  });

  it('erottaa saman tilin eri alv-kannat omiksi, erillisiksi kentikseen', () => {
    const totuusMonikanta: Totuus = {
      tositeId: 9,
      pvm: '2025-02-01',
      myyja: 'Moniverokanta Oy',
      brutto: 3535,
      alvYhteensa: 535,
      menot: [
        { tili: 4010, netto: 1000, alvKoodi: 21, alvProsentti: 25.5 },
        { tili: 4010, netto: 2000, alvKoodi: 21, alvProsentti: 14 },
      ],
    };
    const tositeMonikanta = tosite({
      pvm: '2025-02-01',
      otsikko: 'Moniverokanta Oy',
      viennit: [
        {
          tili: 4010,
          debet: Euro.fromCents(1000),
          kredit: Euro.fromCents(0),
          pvm: '2025-02-01',
          alvKoodi: 21,
          alvProsentti: 25.5,
        },
        {
          tili: 1763,
          debet: Euro.fromCents(255),
          kredit: Euro.fromCents(0),
          pvm: '2025-02-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 4010,
          debet: Euro.fromCents(2000),
          kredit: Euro.fromCents(0),
          pvm: '2025-02-01',
          alvKoodi: 21,
          alvProsentti: 14,
        },
        {
          tili: 1763,
          debet: Euro.fromCents(280),
          kredit: Euro.fromCents(0),
          pvm: '2025-02-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 1910,
          debet: Euro.fromCents(0),
          kredit: Euro.fromCents(3535),
          pvm: '2025-02-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });
    const r = vertaa(totuusMonikanta, tositeMonikanta, chart);
    const k1 = kentta(r, 'menotili 4010@25.5');
    const k2 = kentta(r, 'menotili 4010@14');
    expect(k1).toBeDefined();
    expect(k2).toBeDefined();
    expect(k1?.nimi).not.toBe(k2?.nimi);
    expect(k1?.ok).toBe(true);
    expect(k2?.ok).toBe(true);
    expect(r.taysinTasmaa).toBe(true);
  });
});
