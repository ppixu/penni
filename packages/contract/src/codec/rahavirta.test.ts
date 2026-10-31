import type { RahavirtaRivi } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { decodeRahavirtaRivi, encodeRahavirtaRivi } from './rahavirta.js';

const rivi: RahavirtaRivi = {
  tosite: 7,
  pvm: '2026-03-01',
  tunniste: 3,
  sarja: '',
  tyyppi: 200,
  tila: 100,
  netto: Euro.fromCents(10000),
  alv: Euro.fromCents(2550),
  summa: Euro.fromCents(12550),
  avoin: Euro.fromCents(0),
  liitteita: 0,
  otsikko: 'Revontuli',
};

// Same shape as `rivi`, but every optional field carries a value — proves the era/kumppani
// side of the codec, not just otsikko. Distinct field values so a copy-paste slip in one of
// the `if` blocks (e.g. reading the wrong wire key) shows up as a mismatch, not a coincidence.
const riviKaikkiKentat: RahavirtaRivi = {
  tosite: 8,
  pvm: '2026-03-02',
  tunniste: 4,
  sarja: 'A',
  tyyppi: 201,
  tila: 100,
  netto: Euro.fromCents(20000),
  alv: Euro.fromCents(4500),
  summa: Euro.fromCents(24500),
  avoin: Euro.fromCents(24500),
  liitteita: 2,
  alkupera: 'eu',
  otsikko: 'Vuokra',
  kumppani: 42,
  kumppaniNimi: 'Kuuvuokraus Oy',
  era: 99,
  erapvm: '2026-04-01',
  numero: '2026-014',
  viite: '10099',
  // false, not true: an `if (r.eraKredit)` truthy-check bug (instead of `!== undefined`)
  // would silently drop this value on encode — the round-trip below catches that.
  eraKredit: false,
};

describe('rahavirta-koodekki', () => {
  it('sarjallistaa rahat kanonisiksi merkkijonoiksi', () => {
    const w = encodeRahavirtaRivi(rivi);
    expect(w.netto).toBe('100.00');
    expect(w.alv).toBe('25.50');
    expect(w.summa).toBe('125.50');
    expect(w.avoin).toBe('0.00');
  });

  it('pyörii ympäri muuttumattomana', () => {
    expect(decodeRahavirtaRivi(encodeRahavirtaRivi(rivi))).toEqual(rivi);
  });

  it('pyörii ympäri muuttumattomana kun kaikki valinnaiset kentät on asetettu', () => {
    const w = encodeRahavirtaRivi(riviKaikkiKentat);
    expect(w.kumppani).toBe(42);
    expect(w.kumppaniNimi).toBe('Kuuvuokraus Oy');
    expect(w.era).toBe(99);
    expect(w.erapvm).toBe('2026-04-01');
    expect(w.numero).toBe('2026-014');
    expect(w.viite).toBe('10099');
    expect(w.eraKredit).toBe(false);
    expect('eraKredit' in w).toBe(true); // present-but-false, not silently dropped
    expect(decodeRahavirtaRivi(w)).toEqual(riviKaikkiKentat);
  });

  it('ei lisää valinnaisia avaimia joita ei ollut', () => {
    const w = encodeRahavirtaRivi(rivi);
    expect('era' in w).toBe(false);
    expect('erapvm' in w).toBe(false);
    expect('kumppani' in w).toBe(false);
    expect('kumppaniNimi' in w).toBe(false);
    expect('numero' in w).toBe(false);
    expect('viite' in w).toBe(false);
    expect('eraKredit' in w).toBe(false);
    expect('alkupera' in w).toBe(false);
  });

  it('kuljettaa liitemäärän ja luonnoksen tilan', () => {
    const luonnos: RahavirtaRivi = { ...rivi, tila: 50, liitteita: 0 };
    const w = encodeRahavirtaRivi(luonnos);
    expect(w.liitteita).toBe(0); // 0 lähetetään, ei pudoteta
    expect(w.tila).toBe(50);
    expect(decodeRahavirtaRivi(encodeRahavirtaRivi(riviKaikkiKentat)).liitteita).toBe(2);
  });

  it('kuljettaa alkuperän ja pudottaa tuntemattoman', () => {
    expect(encodeRahavirtaRivi(riviKaikkiKentat).alkupera).toBe('eu');
    const w = { ...encodeRahavirtaRivi(riviKaikkiKentat), alkupera: 'mars' };
    expect('alkupera' in decodeRahavirtaRivi(w)).toBe(false);
  });

  it('tulkitsee puuttuvan liitemäärän nollaksi', () => {
    const { liitteita: _pois, ...w } = encodeRahavirtaRivi(riviKaikkiKentat);
    expect(decodeRahavirtaRivi(w).liitteita).toBe(0);
  });
});
