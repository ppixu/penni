import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import type { Kuitti } from '../kuitti/kuitti.js';
import type { Tilitapahtuma } from './poimiTiliote.js';
import { tasmaytaTiliote } from './tasmaytaTiliote.js';

function kuitti(osa: Partial<Kuitti>): Kuitti {
  return { valuutta: 'EUR', alv: [], ...osa };
}

describe('tasmaytaTiliote', () => {
  const tapahtumat: Tilitapahtuma[] = [
    {
      pvm: '2026-04-07',
      nimi: 'PILVIPALVELU',
      viite: '260403100258',
      maara: Euro.fromString('-20.00'),
    },
    { pvm: '2026-04-30', nimi: 'MEIKÄLÄINEN MATTI', maara: Euro.fromString('-4000.00') },
    {
      pvm: '2026-04-16',
      nimi: 'GITHUB, INC.',
      viite: '260413100164',
      maara: Euro.fromString('-6.03'),
    },
  ];
  const kuitit = [
    {
      tiedosto: 'pilvipalvelu.pdf',
      kuitti: kuitti({
        bruttoSumma: Euro.fromString('20.00'),
        pvm: '2026-04-04',
        myyja: 'Pilvipalvelu, Ltd',
      }),
    },
    {
      tiedosto: 'orpo.pdf',
      kuitti: kuitti({ bruttoSumma: Euro.fromString('99.00'), pvm: '2026-04-01', myyja: 'X' }),
    },
  ];

  it('täsmää tapahtuman kuittiin summan ja päiväyksen perusteella', () => {
    const r = tasmaytaTiliote(tapahtumat, kuitit, { omistajanNimet: ['meikalainen'] });
    expect(r.tapahtumat[0]?.luokka).toBe('tasmays');
    expect(r.tapahtumat[0]?.kuitti?.tiedosto).toBe('pilvipalvelu.pdf');
  });

  it('luokittelee omistajan nimen oman pääoman liikkeeksi', () => {
    const r = tasmaytaTiliote(tapahtumat, kuitit, { omistajanNimet: ['meikalainen'] });
    expect(r.tapahtumat[1]?.luokka).toBe('omaPaaoma');
  });

  it('ei luokittele omistajaksi osamerkkijonon perusteella', () => {
    // 'SALOMON' ja 'SALORANTA' sisältävät merkkijonon 'salo' — kumpikaan ei ole omistaja.
    const tap: Tilitapahtuma[] = [
      { pvm: '2026-04-07', nimi: 'SALOMON SPORTS', maara: Euro.fromString('-12.00') },
      { pvm: '2026-04-08', nimi: 'SALORANTA JA POJAT', maara: Euro.fromString('-13.00') },
      { pvm: '2026-04-09', nimi: 'AINO SALO', maara: Euro.fromString('-14.00') },
    ];
    const r = tasmaytaTiliote(tap, [], { omistajanNimet: ['aino', 'salo'] });
    expect(r.tapahtumat.map((t) => t.luokka)).toEqual([
      'kuittiPuuttuu',
      'kuittiPuuttuu',
      'omaPaaoma',
    ]);
  });

  it('ei luokittele omistajaksi yritysmuodon perusteella', () => {
    // Kirjan nimestä siemennetty 'oy' ei saa napata jokaista osakeyhtiötä omaksi pääomaksi.
    const tap: Tilitapahtuma[] = [
      { pvm: '2026-04-07', nimi: 'ELISA OYJ', maara: Euro.fromString('-32.00') },
    ];
    const r = tasmaytaTiliote(tap, [], { omistajanNimet: ['oy', 'oyj', 'pilvipalvelu'] });
    expect(r.tapahtumat[0]?.luokka).toBe('kuittiPuuttuu');
  });

  it('täsmää omistajan koko nimen kokonaisina sanoina kummassakin järjestyksessä', () => {
    const tap: Tilitapahtuma[] = [
      { pvm: '2026-04-07', nimi: 'SALO AINO', maara: Euro.fromString('-15.00') },
    ];
    const r = tasmaytaTiliote(tap, [], { omistajanNimet: ['Aino Salo'] });
    expect(r.tapahtumat[0]?.luokka).toBe('omaPaaoma');
  });

  it('vaatii monisanaisesta omistajanimestä kaikki sanat, ei yhtä', () => {
    // Etunimen jakava sivullinen ei ole omistajan liike: 'Aino Salo' ei täsmää 'AINO VIRTANEN'.
    // Väärä osuma olisi kallis — omaPaaoma-ryhmä on kasassa eikä rivejä esivalita.
    const tap: Tilitapahtuma[] = [
      { pvm: '2026-04-07', nimi: 'AINO VIRTANEN', maara: Euro.fromString('-16.00') },
      { pvm: '2026-04-08', nimi: 'SALO REMONTIT', maara: Euro.fromString('-17.00') },
      { pvm: '2026-04-09', nimi: 'AINO SALO', maara: Euro.fromString('-18.00') },
    ];
    const r = tasmaytaTiliote(tap, [], { omistajanNimet: ['Aino Salo'] });
    expect(r.tapahtumat.map((t) => t.luokka)).toEqual([
      'kuittiPuuttuu',
      'kuittiPuuttuu',
      'omaPaaoma',
    ]);
  });

  it('ei täsmää jokaiseen riviin vaikka omistajanimestä ei jää yhtään merkitsevää sanaa', () => {
    // 'Oy Ab' kutistuu yleissanoina tyhjäksi; tyhjä sanalista ei saa olla tosi kaikille.
    const tap: Tilitapahtuma[] = [
      { pvm: '2026-04-07', nimi: 'TUNTEMATON KAHVILA', maara: Euro.fromString('-19.00') },
    ];
    const r = tasmaytaTiliote(tap, [], { omistajanNimet: ['Oy Ab'] });
    expect(r.tapahtumat[0]?.luokka).toBe('kuittiPuuttuu');
  });

  it('merkitsee kuitin puuttuvaksi kun vastinetta ei löydy', () => {
    const r = tasmaytaTiliote(tapahtumat, kuitit, { omistajanNimet: ['meikalainen'] });
    expect(r.tapahtumat[2]?.luokka).toBe('kuittiPuuttuu');
  });

  it('listaa kuitit joille ei löydy tapahtumaa', () => {
    const r = tasmaytaTiliote(tapahtumat, kuitit, { omistajanNimet: ['meikalainen'] });
    expect(r.kuititIlmanTapahtumaa.map((k) => k.tiedosto)).toEqual(['orpo.pdf']);
  });

  it('täsmää nimen ja päiväyksen perusteella kun summa ei täsmää (valuuttamuunnos)', () => {
    const tap: Tilitapahtuma[] = [
      {
        pvm: '2026-05-07',
        nimi: 'MALLISIVU SYSTEMS OU',
        viite: '260504100391',
        maara: Euro.fromString('-23.47'),
      },
    ];
    const ks = [
      {
        tiedosto: 'esimerkkibot.pdf',
        kuitti: kuitti({
          bruttoSumma: Euro.fromString('25.00'),
          pvm: '2026-05-05',
          myyja: 'Mallisivu Systems OÜ',
        }),
      },
    ];
    const r = tasmaytaTiliote(tap, ks, { omistajanNimet: [] });
    expect(r.tapahtumat[0]?.luokka).toBe('nimitasmays');
    expect(r.tapahtumat[0]?.kuitti?.tiedosto).toBe('esimerkkibot.pdf');
    expect(r.kuititIlmanTapahtumaa).toHaveLength(0);
  });

  it('suosii tarkkaa summatäsmäystä nimitäsmäyksen sijaan', () => {
    const tap: Tilitapahtuma[] = [
      { pvm: '2026-05-07', nimi: 'MALLISIVU SYSTEMS OU', maara: Euro.fromString('-23.47') },
    ];
    const ks = [
      {
        tiedosto: 'nimi.pdf',
        kuitti: kuitti({
          bruttoSumma: Euro.fromString('25.00'),
          pvm: '2026-05-05',
          myyja: 'Mallisivu Systems OÜ',
        }),
      },
      {
        tiedosto: 'summa.pdf',
        kuitti: kuitti({
          bruttoSumma: Euro.fromString('23.47'),
          pvm: '2026-05-06',
          myyja: 'Muu Oy',
        }),
      },
    ];
    const r = tasmaytaTiliote(tap, ks, { omistajanNimet: [] });
    expect(r.tapahtumat[0]?.luokka).toBe('tasmays');
    expect(r.tapahtumat[0]?.kuitti?.tiedosto).toBe('summa.pdf');
  });

  it('ei nimitäsmää kun myyjänimi ei jaa merkitsevää sanaa', () => {
    const tap: Tilitapahtuma[] = [
      { pvm: '2026-05-07', nimi: 'ESIMERKKI.AI SUBSCRIPTION', maara: Euro.fromString('-18.00') },
    ];
    const ks = [
      {
        tiedosto: 'pilvipalvelu.pdf',
        kuitti: kuitti({
          bruttoSumma: Euro.fromString('20.00'),
          pvm: '2026-05-06',
          myyja: 'Pilvipalvelu, Ltd',
        }),
      },
    ];
    const r = tasmaytaTiliote(tap, ks, { omistajanNimet: [] });
    expect(r.tapahtumat[0]?.luokka).toBe('kuittiPuuttuu');
    expect(r.kuititIlmanTapahtumaa).toHaveLength(1);
  });

  it('nimitäsmää aliasryhmän kautta (juridinen nimi ≠ pankin brändi)', () => {
    const tap: Tilitapahtuma[] = [
      { pvm: '2026-05-29', nimi: 'CURSOR, AI POWERED IDE', maara: Euro.fromString('-17.43') },
    ];
    const ks = [
      {
        tiedosto: 'cursor.pdf',
        kuitti: kuitti({
          bruttoSumma: Euro.fromString('20.00'),
          pvm: '2026-05-27',
          myyja: 'Anysphere, Inc.',
        }),
      },
    ];
    // Ilman aliasta ei täsmää.
    expect(tasmaytaTiliote(tap, ks, { omistajanNimet: [] }).tapahtumat[0]?.luokka).toBe(
      'kuittiPuuttuu',
    );
    // Aliaksella täsmää.
    const r = tasmaytaTiliote(tap, ks, {
      omistajanNimet: [],
      vendorAliakset: [['cursor', 'anysphere']],
    });
    expect(r.tapahtumat[0]?.luokka).toBe('nimitasmays');
    expect(r.tapahtumat[0]?.kuitti?.tiedosto).toBe('cursor.pdf');
  });

  it('ei nimitäsmää päiväysikkunan ulkopuolella', () => {
    const tap: Tilitapahtuma[] = [
      { pvm: '2026-05-07', nimi: 'MALLISIVU SYSTEMS OU', maara: Euro.fromString('-23.47') },
    ];
    const ks = [
      {
        tiedosto: 'esimerkkibot.pdf',
        kuitti: kuitti({
          bruttoSumma: Euro.fromString('25.00'),
          pvm: '2026-01-01',
          myyja: 'Mallisivu Systems OÜ',
        }),
      },
    ];
    const r = tasmaytaTiliote(tap, ks, { omistajanNimet: [] });
    expect(r.tapahtumat[0]?.luokka).toBe('kuittiPuuttuu');
  });

  it('ei käytä samaa kuittia kahdesti; valitsee lähimmän päiväyksen', () => {
    const kaksi: Tilitapahtuma[] = [
      { pvm: '2026-04-07', nimi: 'A', maara: Euro.fromString('-18.00') },
      { pvm: '2026-05-07', nimi: 'A', maara: Euro.fromString('-18.00') },
    ];
    const kuititKaksi = [
      {
        tiedosto: 'huhti.pdf',
        kuitti: kuitti({ bruttoSumma: Euro.fromString('18.00'), pvm: '2026-04-05' }),
      },
      {
        tiedosto: 'touko.pdf',
        kuitti: kuitti({ bruttoSumma: Euro.fromString('18.00'), pvm: '2026-05-05' }),
      },
    ];
    const r = tasmaytaTiliote(kaksi, kuititKaksi, { omistajanNimet: [] });
    expect(r.tapahtumat[0]?.kuitti?.tiedosto).toBe('huhti.pdf');
    expect(r.tapahtumat[1]?.kuitti?.tiedosto).toBe('touko.pdf');
    expect(r.kuititIlmanTapahtumaa).toHaveLength(0);
  });
});
