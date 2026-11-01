import { Maksutapa, nettoYhteensaCents } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { alustaLaskuTila, laskuReducer } from './laskuReducer.js';
import { rakennaLaskuSyote } from './rakennaLaskuSyote.js';

const pohja = () => alustaLaskuTila({ laskupvm: '2026-06-01', alvVelvollinen: true });

describe('rakennaLaskuSyote', () => {
  it('muuntaa à-hinnan senteistä euroiksi täsmälleen kerran (1210 snt → 12.1 €)', () => {
    let tila = pohja();
    const avain = tila.rivit[0]?.avain ?? 0;
    tila = laskuReducer(tila, {
      type: 'setRivi',
      avain,
      muutos: { aNettoSnt: Euro.fromCents(1210) },
    });
    const syote = rakennaLaskuSyote(tila);
    expect(syote.rivit).toHaveLength(1);
    expect(syote.rivit[0]?.aNetto).toBe(12.1);
    // Float-ansa: moottorin senttiraja pyöristää takaisin täsmälleen samaan senttimäärään.
    expect(syote.rivit.map(nettoYhteensaCents)).toEqual([1210]);
  });

  it('kestää binäärifloatin epätarkkuuden (0.1-tyyliset eurot, kpl-kerroin)', () => {
    let tila = pohja();
    const avain = tila.rivit[0]?.avain ?? 0;
    tila = laskuReducer(tila, {
      type: 'setRivi',
      avain,
      muutos: { aNettoSnt: Euro.fromCents(10), myyntiKpl: 3 },
    });
    const syote = rakennaLaskuSyote(tila);
    // 0.1 € × 3 = 30 snt — summat tulevat engine-helpereistä, ei omasta laskennasta.
    expect(syote.rivit.map(nettoYhteensaCents)).toEqual([30]);
  });

  it('pudottaa nollahintaiset rivit ja jättää tyhjän selitteen pois', () => {
    let tila = laskuReducer(pohja(), { type: 'lisaaRivi' });
    const eka = tila.rivit[0]?.avain ?? 0;
    tila = laskuReducer(tila, {
      type: 'setRivi',
      avain: eka,
      muutos: { aNettoSnt: Euro.fromCents(1000) },
    });
    // Toinen rivi jää nollahintaiseksi (tyhjä häntärivi) → pudotetaan.
    const syote = rakennaLaskuSyote(tila);
    expect(syote.rivit).toHaveLength(1);
    const rivi = syote.rivit[0];
    expect(rivi !== undefined && 'selite' in rivi).toBe(false);
  });

  it('mappaa päivät, kumppanin, maksutavan ja otsikon', () => {
    let tila = pohja();
    const avain = tila.rivit[0]?.avain ?? 0;
    tila = laskuReducer(tila, {
      type: 'setRivi',
      avain,
      muutos: { aNettoSnt: Euro.fromCents(1000), selite: 'Työ' },
    });
    tila = laskuReducer(tila, { type: 'setKumppani', kumppani: 5 });
    tila = laskuReducer(tila, { type: 'setOtsikko', otsikko: 'Kesäkuun työt' });
    const syote = rakennaLaskuSyote(tila);
    expect(syote.pvm).toBe('2026-06-01');
    expect(syote.laskupvm).toBe('2026-06-01');
    expect(syote.erapvm).toBe('2026-06-15');
    expect(syote.kumppani).toBe(5);
    expect(syote.maksutapa).toBe(Maksutapa.LASKU);
    expect(syote.otsikko).toBe('Kesäkuun työt');
    expect(syote.rivit[0]?.selite).toBe('Työ');
  });

  it('ilman kumppania ja otsikkoa avaimet puuttuvat syötteestä kokonaan', () => {
    let tila = pohja();
    const avain = tila.rivit[0]?.avain ?? 0;
    tila = laskuReducer(tila, {
      type: 'setRivi',
      avain,
      muutos: { aNettoSnt: Euro.fromCents(1000) },
    });
    const syote = rakennaLaskuSyote(tila);
    expect('kumppani' in syote).toBe(false);
    expect('otsikko' in syote).toBe(false);
  });

  it('tyhjäksi tyhjennetty eräpäivä (erapvm: "") ei päädy syötteeseen', () => {
    let tila = pohja();
    const avain = tila.rivit[0]?.avain ?? 0;
    tila = laskuReducer(tila, {
      type: 'setRivi',
      avain,
      muutos: { aNettoSnt: Euro.fromCents(1000) },
    });
    // Käyttäjä tyhjentää <input type="date">:n → tila.erapvm === ''.
    tila = laskuReducer(tila, { type: 'setErapvm', pvm: '' });
    const syote = rakennaLaskuSyote(tila);
    expect('erapvm' in syote).toBe(false);
  });

  it('vie rivin kohdennuksen ja normalisoidut merkkaukset syötteeseen', () => {
    let tila = pohja();
    const avain = tila.rivit[0]?.avain ?? 0;
    tila = laskuReducer(tila, {
      type: 'setRivi',
      avain,
      muutos: { aNettoSnt: Euro.fromCents(1000), kohdennus: 4, merkkaukset: [7, 5, 7] },
    });
    expect(rakennaLaskuSyote(tila).rivit[0]).toMatchObject({ kohdennus: 4, merkkaukset: [5, 7] });
  });

  it('jättää Yleisen (0), tyhjän merkkauslistan ja undefined-arvot pois avaimina', () => {
    let tila = pohja();
    const avain = tila.rivit[0]?.avain ?? 0;
    tila = laskuReducer(tila, {
      type: 'setRivi',
      avain,
      muutos: {
        aNettoSnt: Euro.fromCents(1000),
        kohdennus: 0,
        merkkaukset: [],
      },
    });
    const rivi = rakennaLaskuSyote(tila).rivit[0] ?? {};
    expect('kohdennus' in rivi).toBe(false);
    expect('merkkaukset' in rivi).toBe(false);
  });
});
