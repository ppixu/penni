import { type Tili, TositeTila, TositeTyyppi, lataaKartta } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { alustaTila } from './reducer.js';
import { rakennaSyote } from './syote.js';
import type { TositeEditoriTila, VientiRivi } from './types.js';

// Plain (EIALV) rows pass through unchanged, so a chart without VAT accounts suffices here.
const CHART: Tili[] = lataaKartta([
  { numero: 7800, tyyppi: 'D', nimi: { fi: 'Kulut' } },
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
]);

const rivi = (over: Partial<VientiRivi>): VientiRivi => ({
  avain: 'r',
  debetSnt: Euro.fromCents(0),
  kreditSnt: Euro.fromCents(0),
  alvKoodi: 0,
  alvProsentti: 0,
  bruttoSyotto: true,
  ...over,
});

const tila = (rows: VientiRivi[]): TositeEditoriTila => ({
  ...alustaTila({ paiva: '2026-06-01', tyyppi: TositeTyyppi.MENO }),
  rows,
});

describe('rakennaSyote', () => {
  it("kohde='kirjattu' asettaa tilaksi KIRJANPIDOSSA", () => {
    const s = rakennaSyote(
      tila([
        rivi({ avain: 'a', tili: 7800, debetSnt: Euro.fromCents(8_640) }),
        rivi({ avain: 'b', tili: 1900, kreditSnt: Euro.fromCents(8_640) }),
      ]),
      'kirjattu',
      CHART,
    );
    expect(s.tila).toBe(TositeTila.KIRJANPIDOSSA);
    expect(s.tyyppi).toBe(TositeTyyppi.MENO);
    expect(s.pvm).toBe('2026-06-01');
    expect(s.sarja).toBe('');
  });

  it('asettaa joka viennille tositteen yhteisen pvm:n', () => {
    const s = rakennaSyote(
      tila([
        rivi({ avain: 'a', tili: 7800, debetSnt: Euro.fromCents(100) }),
        rivi({ avain: 'b', tili: 1900, kreditSnt: Euro.fromCents(100) }),
      ]),
      'kirjattu',
      CHART,
    );
    expect(s.viennit.every((v) => v.pvm === '2026-06-01')).toBe(true);
  });

  it('rakentaa viennit oikein sentein (debet/kredit/tili/alv passthrough)', () => {
    const s = rakennaSyote(
      tila([
        rivi({ avain: 'a', tili: 7800, debetSnt: Euro.fromCents(8_640), selite: 'Kahvit' }),
        rivi({ avain: 'b', tili: 1900, kreditSnt: Euro.fromCents(8_640) }),
      ]),
      'kirjattu',
      CHART,
    );
    expect(s.viennit).toEqual([
      {
        tili: 7800,
        debet: 8_640,
        kredit: 0,
        pvm: '2026-06-01',
        alvKoodi: 0,
        alvProsentti: 0,
        selite: 'Kahvit',
      },
      { tili: 1900, debet: 0, kredit: 8_640, pvm: '2026-06-01', alvKoodi: 0, alvProsentti: 0 },
    ]);
  });

  it('suodattaa pois rivit joilta puuttuu tili tai summa', () => {
    const s = rakennaSyote(
      tila([
        rivi({ avain: 'a', tili: 7800, debetSnt: Euro.fromCents(100) }),
        rivi({ avain: 'b' }), // no tili, no amount (trailing blank)
        rivi({ avain: 'c', tili: 1900 }), // tili but zero amount
        rivi({ avain: 'd', debetSnt: Euro.fromCents(50) }), // amount but no tili
        rivi({ avain: 'e', tili: 1900, kreditSnt: Euro.fromCents(100) }),
      ]),
      'kirjattu',
      CHART,
    );
    expect(s.viennit).toHaveLength(2);
    expect(s.viennit.map((v) => v.tili)).toEqual([7800, 1900]);
  });

  it('lisää otsikon vain kun selite on annettu', () => {
    const ilman = rakennaSyote(
      tila([rivi({ tili: 7800, debetSnt: Euro.fromCents(1) })]),
      'kirjattu',
      CHART,
    );
    expect('otsikko' in ilman).toBe(false);
    const kanssa = rakennaSyote(
      { ...tila([rivi({ tili: 7800, debetSnt: Euro.fromCents(1) })]), selite: 'Otsikko' },
      'kirjattu',
      CHART,
    );
    expect(kanssa.otsikko).toBe('Otsikko');
  });

  it("kohde='luonnos' asettaa tilaksi LUONNOS", () => {
    const s = rakennaSyote(
      tila([rivi({ tili: 7800, debetSnt: Euro.fromCents(1) })]),
      'luonnos',
      CHART,
    );
    expect(s.tila).toBe(TositeTila.LUONNOS);
  });
});
