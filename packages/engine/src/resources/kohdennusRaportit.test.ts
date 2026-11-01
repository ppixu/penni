import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { KohdennusTyyppi } from '../kohdennukset/kohdennus.js';
import type { TositeVienti } from '../vouchers/types.js';
import {
  type BudjettivertailuRivi,
  type KohdennusOsio,
  laadiBudjettivertailu,
  laadiKohdennusRaportti,
} from './kohdennusRaportit.js';
import { type RaporttiMaaritys, type RaporttiRivi, laadiRaportti } from './raportti.js';
import type { ResourceEnv, Storage } from './storage.js';
import { tallennaTosite } from './tositeResource.js';

const c = (n: number): Cents => n as Cents;
const env: ResourceEnv = { aika: '2026-06-01T00:00:00.000Z' };
const { KUSTANNUSPAIKKA, PROJEKTI, MERKKAUS } = KohdennusTyyppi;

const LAYOUT: RaporttiMaaritys = {
  nimi: { fi: 'Tuloslaskelma' },
  rivit: [
    { fi: 'Liikevaihto', L: '30..34' },
    { fi: 'Avustukset', L: '35..39' },
    { fi: 'Kulut', L: '4' },
    { fi: 'Rahoitus', L: '9' },
    { fi: 'Tulos', L: '3..9 S', M: 'bold', V: 1 },
  ],
};
const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 3500, tyyppi: 'CZ', nimi: { fi: 'Avustukset' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Kulut' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { 'tulos/yleinen': JSON.stringify(LAYOUT) },
};

async function kirjaa(
  s: Storage,
  tili: 3000 | 4000,
  maara: number,
  kohdennus?: number,
  merkkaukset?: number[],
  pvm = '2026-06-01',
): Promise<void> {
  const tulos: TositeVienti = {
    tili,
    debet: c(tili === 4000 ? maara : 0),
    kredit: c(tili === 3000 ? maara : 0),
    pvm,
    alvKoodi: 0,
    alvProsentti: 0,
    ...(kohdennus !== undefined ? { kohdennus } : {}),
    ...(merkkaukset !== undefined ? { merkkaukset } : {}),
  };
  const pankki: TositeVienti = {
    tili: 1900,
    debet: c(tili === 3000 ? maara : 0),
    kredit: c(tili === 4000 ? maara : 0),
    pvm,
    alvKoodi: 0,
    alvProsentti: 0,
  };
  await tallennaTosite(s, { pvm, tyyppi: 0, sarja: '', viennit: [pankki, tulos] }, env);
}

/**
 * Yhdistys: kustannuspaikat 1 Nuorisotoiminta (projekti 4 Kesäleiri alla), 2 Kerhotalo ja
 * 6 Tyhjä (ei kirjauksia), projekti 5 Arpajaiset Yleisen alla, merkkaus 3 Avustus. Kirjauksissa
 * myös tallentamaton kohdennus 99.
 */
async function kirja(): Promise<Storage> {
  const s = createMemoryStorage(SEED);
  await s.saveKohdennus({ id: 1, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Nuorisotoiminta' } });
  await s.saveKohdennus({ id: 2, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Kerhotalo' } });
  await s.saveKohdennus({ id: 3, tyyppi: MERKKAUS, nimi: { fi: 'Avustus' } });
  await s.saveKohdennus({ id: 4, tyyppi: PROJEKTI, kuuluu: 1, nimi: { fi: 'Kesäleiri' } });
  await s.saveKohdennus({ id: 5, tyyppi: PROJEKTI, nimi: { fi: 'Arpajaiset' } });
  await s.saveKohdennus({ id: 6, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Tyhjä' } });
  await kirjaa(s, 3000, 1000, 1);
  await kirjaa(s, 4000, 300, 4, [3]);
  await kirjaa(s, 3000, 500);
  await kirjaa(s, 4000, 200, 5);
  await kirjaa(s, 3000, 70, 99);
  await kirjaa(s, 4000, 40, 2, [3]);
  await kirjaa(s, 3000, 400, 1, undefined, '2026-09-01');
  return s;
}

const VUOSI = { muoto: 'tulos/yleinen', alkupvm: '2026-01-01', pvm: '2026-12-31' } as const;
const arvo = (rivit: readonly RaporttiRivi[], teksti: string) =>
  rivit.find((r) => r.teksti === teksti)?.arvo;
const tulos = (rivit: readonly RaporttiRivi[]) => arvo(rivit, 'Tulos');
const otsikot = (osiot: readonly KohdennusOsio[]) => osiot.map((o) => o.kohdennus.nimi);

describe('laadiRaportti: kohdennus', () => {
  it('ilman kohdennusta koko tuloslaskelma', async () => {
    const s = await kirja();
    expect(tulos(await laadiRaportti(s, env, VUOSI))).toBe(1430);
  });

  it('kustannuspaikka sisältää projektinsa rivit', async () => {
    const s = await kirja();
    const rivit = await laadiRaportti(s, env, { ...VUOSI, kohdennus: 1 });
    expect(arvo(rivit, 'Liikevaihto')).toBe(1400);
    expect(arvo(rivit, 'Kulut')).toBe(-300); // projekti 4
    expect(tulos(rivit)).toBe(1100);
  });

  it('Yleinen: kohdentamattomat ja Yleisen alla olevat projektit; projekti vain itse', async () => {
    const s = await kirja();
    expect(tulos(await laadiRaportti(s, env, { ...VUOSI, kohdennus: 0 }))).toBe(300);
    expect(tulos(await laadiRaportti(s, env, { ...VUOSI, kohdennus: 4 }))).toBe(-300);
  });

  it('merkkaus suodattaa merkatut viennit kohdennuksesta riippumatta', async () => {
    const s = await kirja();
    const rivit = await laadiRaportti(s, env, { ...VUOSI, kohdennus: 3 });
    expect(arvo(rivit, 'Kulut')).toBe(-340);
    expect(arvo(rivit, 'Liikevaihto')).toBeUndefined(); // ei tilejä -> rivi pois
  });

  it('taseella kohdennus ei vaikuta', async () => {
    const s = createMemoryStorage({
      ...SEED,
      asetukset: { 'tase/yleinen': JSON.stringify({ rivit: [{ fi: 'Pankki', L: '19 S' }] }) },
    });
    await s.saveKohdennus({ id: 1, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'K' } });
    await kirjaa(s, 3000, 100, 1);
    await kirjaa(s, 3000, 50);
    const p = { muoto: 'tase/yleinen', pvm: '2026-12-31' };
    expect(await laadiRaportti(s, env, { ...p, kohdennus: 1 })).toEqual(
      await laadiRaportti(s, env, p),
    );
    expect(arvo(await laadiRaportti(s, env, { ...p, kohdennus: 1 }), 'Pankki')).toBe(150);
  });
});

describe('laadiKohdennusRaportti: kustannuspaikat', () => {
  it('osio per kustannuspaikka + Yleinen + tuntematon; tyhjät pois; Yleinen ensin, tuntematon viimeisenä', async () => {
    const s = await kirja();
    const osiot = await laadiKohdennusRaportti(s, env, { ...VUOSI, laji: 'kustannuspaikat' });
    expect(otsikot(osiot)).toEqual([
      'Yleinen',
      'Kerhotalo',
      'Nuorisotoiminta',
      'Tuntematon kohdennus (99)',
    ]);
    expect(osiot.map((o) => o.kohdennus)).toEqual([
      { id: 0, nimi: 'Yleinen', polku: 'Yleinen' },
      { id: 2, nimi: 'Kerhotalo', polku: 'Kerhotalo' },
      { id: 1, nimi: 'Nuorisotoiminta', polku: 'Nuorisotoiminta' },
      {
        id: 99,
        nimi: 'Tuntematon kohdennus (99)',
        polku: 'Tuntematon kohdennus (99)',
        tuntematon: true,
      },
    ]);
    expect(osiot.map((o) => tulos(o.rivit))).toEqual([300, -40, 1100, 70]);
  });

  it('osioiden tulosrivit summautuvat suodattamattomaan tulokseen', async () => {
    const s = await kirja();
    const osiot = await laadiKohdennusRaportti(s, env, { ...VUOSI, laji: 'kustannuspaikat' });
    const kaikki = await laadiRaportti(s, env, VUOSI);
    for (const teksti of ['Liikevaihto', 'Kulut', 'Tulos']) {
      const summa = osiot.reduce((a, o) => a + (arvo(o.rivit, teksti) ?? 0), 0);
      expect(summa).toBe(arvo(kaikki, teksti));
    }
  });

  it('jakso rajaa kirjaukset; osio renderöidään raporttikaavalla', async () => {
    const s = await kirja();
    const osiot = await laadiKohdennusRaportti(s, env, {
      ...VUOSI,
      pvm: '2026-06-30',
      laji: 'kustannuspaikat',
    });
    const nuoriso = osiot.find((o) => o.kohdennus.id === 1);
    expect(nuoriso?.rivit).toEqual([
      { teksti: 'Liikevaihto', sisennys: 0, lihava: false, arvo: 1000, kaavarivi: 0 },
      { teksti: 'Kulut', sisennys: 0, lihava: false, arvo: -300, kaavarivi: 2 },
      { teksti: '', sisennys: 0, lihava: false, arvo: null, tyhja: true },
      { teksti: 'Tulos', sisennys: 0, lihava: true, arvo: 700, kaavarivi: 4 },
    ]);
  });
});

describe('laadiKohdennusRaportti: projektit', () => {
  it('osio per projekti polun mukaan järjestettynä', async () => {
    const s = await kirja();
    const osiot = await laadiKohdennusRaportti(s, env, { ...VUOSI, laji: 'projektit' });
    expect(osiot.map((o) => o.kohdennus)).toEqual([
      { id: 5, nimi: 'Arpajaiset', polku: 'Arpajaiset' },
      { id: 4, nimi: 'Kesäleiri', polku: 'Nuorisotoiminta/Kesäleiri' },
    ]);
    expect(osiot.map((o) => tulos(o.rivit))).toEqual([-200, -300]);
  });

  it('kustannuspaikka rajaa sen projekteihin; 0 = Yleisen alla olevat', async () => {
    const s = await kirja();
    const p = { ...VUOSI, laji: 'projektit' } as const;
    expect(otsikot(await laadiKohdennusRaportti(s, env, { ...p, kustannuspaikka: 1 }))).toEqual([
      'Kesäleiri',
    ]);
    expect(otsikot(await laadiKohdennusRaportti(s, env, { ...p, kustannuspaikka: 0 }))).toEqual([
      'Arpajaiset',
    ]);
    expect(await laadiKohdennusRaportti(s, env, { ...p, kustannuspaikka: 2 })).toEqual([]);
  });
});

describe('laadiBudjettivertailu', () => {
  async function budjetoitu(): Promise<Storage> {
    const s = await kirja();
    await s.putBudjetti('2026-01-01', [
      { kohdennus: 0, tili: 3000, sentit: c(2000) },
      { kohdennus: 0, tili: 3500, sentit: c(500) },
      { kohdennus: 1, tili: 3000, sentit: c(1200) },
      { kohdennus: 1, tili: 4000, sentit: c(-150) },
      { kohdennus: 4, tili: 4000, sentit: c(-50) },
    ]);
    return s;
  }
  const rivi = (rivit: readonly BudjettivertailuRivi[], teksti: string) =>
    rivit.find((r) => r.teksti === teksti);

  it('tulorivi ja kulurivi: ero = toteutunut − budjetti, ylittynyt kulu negatiivinen', async () => {
    const s = await budjetoitu();
    const rivit = await laadiBudjettivertailu(s, env, {
      muoto: 'tulos/yleinen',
      tilikausi: '2026-01-01',
      pvm: '2026-06-30',
      kohdennus: 1,
    });
    expect(rivit).toEqual([
      {
        teksti: 'Liikevaihto',
        sisennys: 0,
        lihava: false,
        kaavarivi: 0,
        budjetti: 1200,
        toteutunut: 1000,
        ero: -200,
        prosentti: 8333,
      },
      // Avustukset ja Rahoitus: ei budjettia eikä toteumaa -> pois.
      {
        teksti: 'Kulut',
        sisennys: 0,
        lihava: false,
        kaavarivi: 2,
        budjetti: -200, // kustannuspaikka 1 + projekti 4
        toteutunut: -300,
        ero: -100,
        prosentti: 15000,
      },
      {
        teksti: '',
        sisennys: 0,
        lihava: false,
        tyhja: true,
        budjetti: null,
        toteutunut: null,
        ero: null,
      },
      {
        teksti: 'Tulos',
        sisennys: 0,
        lihava: true,
        kaavarivi: 4,
        budjetti: 1000,
        toteutunut: 700,
        ero: -300,
        prosentti: 7000,
      },
    ]);
  });

  it('pvm rajaa vain toteutuman; oletuksena koko tilikausi', async () => {
    const s = await budjetoitu();
    const p = { muoto: 'tulos/yleinen', tilikausi: '2026-01-01', kohdennus: 1 } as const;
    const vuosi = rivi(await laadiBudjettivertailu(s, env, p), 'Liikevaihto');
    expect(vuosi).toMatchObject({ budjetti: 1200, toteutunut: 1400, ero: 200, prosentti: 11667 });
    const puoli = rivi(
      await laadiBudjettivertailu(s, env, { ...p, pvm: '2026-06-30' }),
      'Liikevaihto',
    );
    expect(puoli).toMatchObject({ budjetti: 1200, toteutunut: 1000 });
  });

  it('ilman kohdennusta koko budjetti; pelkkä budjetti näkyy, toteutuma 0; budjetti 0 => ei prosenttia', async () => {
    const s = await budjetoitu();
    const rivit = await laadiBudjettivertailu(s, env, {
      muoto: 'tulos/yleinen',
      tilikausi: '2026-01-01',
    });
    expect(rivi(rivit, 'Liikevaihto')).toMatchObject({ budjetti: 3200, toteutunut: 1970 });
    expect(rivi(rivit, 'Avustukset')).toMatchObject({
      budjetti: 500,
      toteutunut: 0,
      ero: -500,
      prosentti: 0,
    });
    expect(rivi(rivit, 'Rahoitus')).toBeUndefined();
    expect(rivi(rivit, 'Tulos')).toMatchObject({ budjetti: 3500, toteutunut: 1430 });

    const ilman = await laadiBudjettivertailu(s, env, {
      muoto: 'tulos/yleinen',
      tilikausi: '2026-01-01',
      kohdennus: 2,
    });
    expect(rivi(ilman, 'Kulut')).toEqual({
      teksti: 'Kulut',
      sisennys: 0,
      lihava: false,
      kaavarivi: 2,
      budjetti: 0,
      toteutunut: -40,
      ero: -40,
    });
  });

  it('tuntematon tilikausi => EITILIKAUTTA', async () => {
    const s = await budjetoitu();
    await expect(
      laadiBudjettivertailu(s, env, { muoto: 'tulos/yleinen', tilikausi: '2025-01-01' }),
    ).rejects.toMatchObject({ code: 'EITILIKAUTTA' });
  });
});
