import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TositeTyyppi } from '@penni/engine';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  laskutusSisakkaiset,
  lueRivit,
  lueTuotteet,
  lueVakioviitteet,
  taydennaLaskutiedot,
} from './laskutus.js';
import { lueKitsas } from './lueKitsas.js';
import { LASKUTUS_TESTI, lisaaLaskutusKitsas } from './testi/lisaaLaskutusKitsas.js';
import { luoTestiKitsas } from './testi/luoTestiKitsas.js';
import type { KitsasTosite } from './tyypit.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-laskutus-'));
const polku = join(hakemisto, 'laskutus.kitsas');
const pelkka = join(hakemisto, 'pelkka.kitsas');
let db: Database.Database;

beforeAll(() => {
  luoTestiKitsas(polku);
  lisaaLaskutusKitsas(polku);
  luoTestiKitsas(pelkka);
  db = new Database(polku, { readonly: true });
});
afterAll(() => {
  db.close();
  rmSync(hakemisto, { recursive: true, force: true });
});

function tosite(id: number, tyyppi: number, lisa: Partial<KitsasTosite> = {}): KitsasTosite {
  return { id, pvm: '2026-12-15', tyyppi, tila: 50, tunniste: 0, sarja: '', viennit: [], ...lisa };
}

describe('lueTuotteet', () => {
  it('muuntaa Kitsaksen avaimet, säilyttää id:n ja tuntemattomat avaimet', () => {
    const [tuote] = lueTuotteet(db);
    expect(tuote).toEqual({
      id: LASKUTUS_TESTI.tuote,
      nimike: 'Konsultointi',
      unKoodi: 'HUR',
      aNetto: 45.5,
      alvKoodi: 11,
      alvProsentti: 25.5,
      tili: 3000,
      koodi: 'K1',
      nimi: { fi: 'Konsultointi', sv: 'Konsultering' },
    });
  });

  it('palauttaa tyhjän listan, kun taulua ei ole', () => {
    const vanha = new Database(pelkka, { readonly: true });
    try {
      expect(lueTuotteet(vanha)).toEqual([]);
      expect(lueVakioviitteet(vanha)).toEqual([]);
      expect(lueRivit(vanha).rivit.size).toBe(0);
    } finally {
      vanha.close();
    }
  });
});

describe('lueVakioviitteet', () => {
  it('ottaa viitteen sellaisenaan merkkijonona ja säilyttää jsonin', () => {
    expect(lueVakioviitteet(db)).toEqual([
      { viite: '1009', tili: 3000, otsikko: 'Vuokrat', huom: 'säilyy' },
    ]);
  });
});

describe('lueRivit', () => {
  it('järjestää rivit, yhdistää nimikkeen ja kuvauksen ja laskee pudotetut', () => {
    const { rivit, pudotetut } = lueRivit(db);
    expect(rivit.get(LASKUTUS_TESTI.lasku)).toEqual([
      {
        myyntiKpl: 2,
        aNetto: 45.5,
        alvKoodi: 11,
        alvProsentti: 25.5,
        unKoodi: 'HUR',
        selite: 'Työ – marraskuu',
        tili: 3000,
        tuote: LASKUTUS_TESTI.tuote,
      },
      {
        myyntiKpl: 1,
        aNetto: 10,
        alvKoodi: 11,
        alvProsentti: 25.5,
        yksikko: 'krt',
        selite: 'Matka',
      },
    ]);
    expect(pudotetut).toEqual({ 'Rivi.json.ennakkoera': 1, 'Rivi.json.laskutetaan': 1 });
  });
});

describe('taydennaLaskutiedot', () => {
  it('asettaa laskutusjakson toimituspäivästä jaksopäivään', () => {
    const lasku = tosite(1, TositeTyyppi.MYYNTILASKU, { numero: '17', laskupvm: '2026-10-30' });
    taydennaLaskutiedot(
      [lasku],
      new Map([[1, { viivkorko: 8, toimituspvm: '2026-11-01', jaksopvm: '2026-11-30' }]]),
    );
    expect(lasku.jakso).toEqual({ alkaa: '2026-11-01', loppuu: '2026-11-30' });
    expect(lasku.viivkorko).toBe(8);
  });

  it('käyttää laskupäivää jakson alkuna, kun toimituspäivä puuttuu; virheellinen jaksopvm ohitetaan', () => {
    const ilman = tosite(1, TositeTyyppi.MYYNTILASKU, { laskupvm: '2026-10-30' });
    const virheellinen = tosite(2, TositeTyyppi.MYYNTILASKU);
    taydennaLaskutiedot(
      [ilman, virheellinen],
      new Map([
        [1, { jaksopvm: '2026-11-30' }],
        [2, { toimituspvm: '2026-11-01', jaksopvm: '2026-02-30' }],
      ]),
    );
    expect(ilman.jakso).toEqual({ alkaa: '2026-10-30', loppuu: '2026-11-30' });
    expect(virheellinen.jakso).toBeUndefined();
  });

  it('muuntaa muistutuksen tiedot senteiksi ja liittää alkuperäisen laskun numerolla', () => {
    const lasku = tosite(1, TositeTyyppi.MYYNTILASKU, { tila: 100, numero: '17' });
    const muistutus = tosite(2, TositeTyyppi.MAKSUMUISTUTUS);
    taydennaLaskutiedot(
      [lasku, muistutus],
      new Map([
        [
          2,
          {
            alkupNro: 17,
            viivkorko: 8,
            muistutusmaksu: '5.00',
            korko: 0.31,
            korkoalkaa: '2026-11-16',
            korkoloppuu: '2026-12-15',
            aiempisaldo: '126.76',
          },
        ],
      ]),
    );
    expect(muistutus.alkuperainenTosite).toBe(1);
    expect(muistutus.muistutus).toEqual({
      maksu: 500,
      korko: 31,
      viivkorko: 8,
      korkoalkaa: '2026-11-16',
      korkoloppuu: '2026-12-15',
      aiempiSaldo: 12676,
      aiemmat: [1],
    });
    expect(lasku.muistutus).toBeUndefined();
  });

  it('jättää viittaukset asettamatta, kun numerolla ei löydy laskua', () => {
    const muistutus = tosite(2, TositeTyyppi.MAKSUMUISTUTUS);
    taydennaLaskutiedot([muistutus], new Map([[2, { alkupNro: 999, muistutusmaksu: 5 }]]));
    expect(muistutus.alkuperainenTosite).toBeUndefined();
    expect(muistutus.muistutus).toEqual({
      maksu: 500,
      korko: 0,
      viivkorko: 0,
      korkoalkaa: '2026-12-15',
      korkoloppuu: '2026-12-15',
      aiempiSaldo: 0,
      aiemmat: [],
    });
  });
});

describe('laskutusSisakkaiset', () => {
  it('kattaa toimituspäivän vain kelvollisen jaksopäivän kanssa', () => {
    const jaksolla = laskutusSisakkaiset({
      tyyppi: TositeTyyppi.MYYNTILASKU,
      json: JSON.stringify({ lasku: { jaksopvm: '2026-11-30', toimituspvm: '2026-11-01' } }),
    });
    expect(jaksolla.lasku?.has('toimituspvm')).toBe(true);
    expect(jaksolla.lasku?.has('numero')).toBe(true);
    const ilman = laskutusSisakkaiset({
      tyyppi: TositeTyyppi.MYYNTILASKU,
      json: JSON.stringify({ lasku: { toimituspvm: '2026-11-01' } }),
    });
    expect(ilman.lasku?.has('toimituspvm')).toBe(false);
    expect(ilman.lasku?.has('muistutusmaksu')).toBe(false);
  });
});

describe('lueKitsas laskutustiedoilla', () => {
  it('lukee tuotteet, vakioviitteet, rivit ja laskujen lisätiedot', () => {
    const kirja = lueKitsas(polku);
    expect(kirja.tuotteet.map((t) => t.id)).toEqual([LASKUTUS_TESTI.tuote]);
    expect(kirja.vakioviitteet.map((v) => v.viite)).toEqual(['1009']);
    expect(kirja.ohitetut).not.toHaveProperty('Tuote');
    expect(kirja.ohitetut).not.toHaveProperty('Rivi');
    expect(kirja.ohitetut).not.toHaveProperty('Vakioviite');

    const lasku = kirja.tositteet.find((t) => t.id === LASKUTUS_TESTI.lasku);
    expect(lasku?.rivit?.map((r) => r.selite)).toEqual(['Työ – marraskuu', 'Matka']);
    expect(lasku?.jakso).toEqual({ alkaa: '2026-11-01', loppuu: '2026-11-30' });
    expect(lasku?.viivkorko).toBe(8);

    const muistutus = kirja.tositteet.find((t) => t.id === LASKUTUS_TESTI.muistutus);
    expect(muistutus?.alkuperainenTosite).toBe(LASKUTUS_TESTI.lasku);
    expect(muistutus?.muistutus?.aiemmat).toEqual([LASKUTUS_TESTI.lasku]);
    const orpo = kirja.tositteet.find((t) => t.id === LASKUTUS_TESTI.orpoMuistutus);
    expect(orpo?.alkuperainenTosite).toBeUndefined();

    expect(kirja.kattamattomat['Rivi.json.ennakkoera']).toBe(1);
    expect(kirja.kattamattomat['Rivi.json.laskutetaan']).toBe(1);
    // Jaksoon käytetty toimituspvm on katettu; muistutuksen pelkkä toimituspvm ei.
    expect(kirja.kattamattomat['Tosite.json.lasku.toimituspvm']).toBe(1);
    expect(kirja.kattamattomat['Tosite.json.lasku.jaksopvm']).toBeUndefined();
    expect(kirja.kattamattomat['Tosite.json.lasku.viivkorko']).toBeUndefined();
    expect(kirja.kattamattomat['Tosite.json.lasku.muistutusmaksu']).toBeUndefined();
  });
});
