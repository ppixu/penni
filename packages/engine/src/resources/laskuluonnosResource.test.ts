import type { Cents } from '@penni/euro';
import { ViiteTyyppi, viiteEralle } from '@penni/validator';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { AlvKoodi } from '../alv/koodit.js';
import { laskuSummat } from '../laskutus/laskuSummat.js';
import { TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import {
  kirjaaLaskuluonnos,
  listaaLaskuluonnokset,
  onLaskuluonnos,
  tallennaRyhmalasku,
} from './laskuluonnosResource.js';
import { tallennaMyyntilasku } from './myyntilaskuResource.js';
import type { Storage } from './storage.js';
import { poistaTosite } from './tositeResource.js';

const env = { aika: '2026-06-01T00:00:00.000Z' };

const seed = (asetukset: Record<string, string> = {}) =>
  createMemoryStorage({
    tilit: [
      { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Suoritettava alv' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: {
      AlvVelvollinen: 'true',
      LaskuSaatavaTili: '1701',
      OletusMyyntitili: '3000',
      AlvVelkaTili: '2939',
      ...asetukset,
    },
  });

const rivi = {
  myyntiKpl: 1,
  aNetto: 100,
  alvKoodi: AlvKoodi.MYYNNIT_NETTO,
  alvProsentti: 25.5,
};

const luonnos = (s: Storage, extra = {}) =>
  tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [rivi], luonnos: true, ...extra }, env);

describe('laskuluonnos: tallennus', () => {
  it('luonnos tallentuu ilman numeroa, viitettä ja vientejä', async () => {
    const s = seed();
    const l = await luonnos(s);
    expect(l.tila).toBe(80);
    expect(l.tunniste).toBe(0);
    expect(l.numero).toBeUndefined();
    expect(l.viite).toBeUndefined();
    expect(l.viennit).toEqual([]);
    expect(l.rivit).toHaveLength(1);
    expect((await s.getAsetukset()).LaskuSeuraavaId).toBeUndefined();
  });

  it('luonnos validoi tilit', async () => {
    const s = createMemoryStorage({
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: { LaskuSaatavaTili: '1701' },
    });
    await expect(
      tallennaMyyntilasku(
        s,
        { pvm: '2026-06-01', rivit: [{ ...rivi, alvKoodi: 0, alvProsentti: 0 }], luonnos: true },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EILASKUTILIA' });
  });

  it('luonnos validoi rivit ja jakson', async () => {
    const s = seed();
    await expect(
      tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [], luonnos: true }, env),
    ).rejects.toMatchObject({ code: 'EIRIVEJA' });
    await expect(
      luonnos(s, { jakso: { alkaa: '2026-06-10', loppuu: '2026-06-01' } }),
    ).rejects.toMatchObject({ code: 'EIJAKSO' });
  });

  it('luonnoksen päivitys', async () => {
    const s = seed();
    const a = await luonnos(s);
    const p = await luonnos(s, { id: a.id, otsikko: 'Muutettu' });
    expect(p.id).toBe(a.id);
    expect(p.otsikko).toBe('Muutettu');
    expect(p.tila).toBe(80);
    expect(await s.listTositteet({ bucket: 'luonnos' })).toHaveLength(1);

    const kirjattu = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [rivi] }, env);
    await expect(luonnos(s, { id: kirjattu.id })).rejects.toMatchObject({ code: 'EILUONNOS' });
    await expect(luonnos(s, { id: 9999 })).rejects.toMatchObject({ code: 'EILUONNOS' });
    await poistaTosite(s, a.id, env);
    await expect(luonnos(s, { id: a.id })).rejects.toMatchObject({ code: 'EILUONNOS' });
  });

  it('uusilla kentillä (toisto, ryhmä, viivkorko, jakso) on kulkua luonnoksesta kirjaukseen', async () => {
    const s = seed();
    const l = await luonnos(s, {
      toisto: 3,
      toistoPvm: '2026-06-01',
      ryhma: 'r-1',
      viivkorko: 11.5,
      jakso: { alkaa: '2026-05-01', loppuu: '2026-05-31' },
    });
    const k = await kirjaaLaskuluonnos(s, l.id, env);
    expect(k).toMatchObject({
      toisto: 3,
      toistoPvm: '2026-06-01',
      ryhma: 'r-1',
      viivkorko: 11.5,
      jakso: { alkaa: '2026-05-01', loppuu: '2026-05-31' },
    });
  });
});

describe('laskuluonnos: kirjaus', () => {
  it('luonnoksen kirjaus antaa numeron ja erän samalla id:llä', async () => {
    const s = seed();
    const l = await luonnos(s);
    const k = await kirjaaLaskuluonnos(s, l.id, env);
    expect(k.id).toBe(l.id);
    expect(k.tila).toBe(100);
    expect(k.numero).toBe('1');
    expect(k.viite).toBe(viiteEralle(ViiteTyyppi.LASKU, 1));
    expect(k.tunniste).toBeGreaterThanOrEqual(1);
    expect(k.viennit.find((v) => v.tili === 1701)?.era).toBe(l.id);
    expect((await s.getAsetukset()).LaskuSeuraavaId).toBe('2');
    // Kirjattua ei voi kirjata uudelleen.
    await expect(kirjaaLaskuluonnos(s, l.id, env)).rejects.toMatchObject({ code: 'EILUONNOS' });
  });

  it('muutokset yhdistyvät luonnoksen päälle ja pvm tulee yhdistetyistä tiedoista', async () => {
    const s = seed();
    const l = await luonnos(s, { otsikko: 'Vanha' });
    const k = await kirjaaLaskuluonnos(s, l.id, env, { pvm: '2026-07-15', otsikko: 'Uusi' });
    expect(k.pvm).toBe('2026-07-15');
    expect(k.otsikko).toBe('Uusi');
    expect(k.rivit).toHaveLength(1);
  });

  it('poistettu luonnos ei kuluta numeroa', async () => {
    const s = seed();
    const a = await luonnos(s);
    const b = await luonnos(s);
    await poistaTosite(s, a.id, env);
    const k = await kirjaaLaskuluonnos(s, b.id, env);
    expect(k.numero).toBe('1');
    await expect(kirjaaLaskuluonnos(s, a.id, env)).rejects.toMatchObject({ code: 'EILUONNOS' });
  });

  it('hylätty kirjaus ei polta numeroa ja jättää luonnoksen luonnokseksi', async () => {
    const s = seed({ TilitPaatetty: '2026-06-30' });
    const l = await luonnos(s, { pvm: '2026-07-01' });
    await expect(kirjaaLaskuluonnos(s, l.id, env, { pvm: '2026-06-01' })).rejects.toMatchObject({
      code: 'PVMLUKITTU',
    });
    expect((await s.getAsetukset()).LaskuSeuraavaId).toBeUndefined();
    expect((await s.getTosite(l.id))?.tila).toBe(80);
    const k = await kirjaaLaskuluonnos(s, l.id, env);
    expect(k.numero).toBe('1');
  });

  const tuoKitsasLuonnos = (s: Storage) =>
    s.saveTosite(
      {
        pvm: '2026-06-01',
        tyyppi: TositeTyyppi.MYYNTILASKU,
        tila: TositeTila.LUONNOS,
        tunniste: 0,
        sarja: '',
        viennit: [
          { tili: 3000, debet: 0, kredit: 99999, pvm: '2026-06-01', alvKoodi: 0, alvProsentti: 0 },
          { tili: 1701, debet: 99999, kredit: 0, pvm: '2026-06-01', alvKoodi: 0, alvProsentti: 0 },
        ] as never,
        rivit: [rivi],
      },
      env,
    );

  it('tuotu Kitsas-luonnos (tila 50, vanhat viennit) kirjataan riveistä', async () => {
    const s = seed();
    const tuotu = await tuoKitsasLuonnos(s);
    expect(onLaskuluonnos(tuotu)).toBe(true);
    // Vanhat viennit ovat tallessa juuri ennen kirjausta.
    expect((await s.getTosite(tuotu.id))?.viennit).toHaveLength(2);
    const k = await kirjaaLaskuluonnos(s, tuotu.id, env);
    expect(k.tila).toBe(100);
    expect(k.viennit.some((v) => v.debet === 99999 || v.kredit === 99999)).toBe(false);
    expect(k.viennit.find((v) => v.tili === 1701)?.debet).toBe(12550);
    expect(k.viennit.find((v) => v.tili === 3000)?.kredit).toBe(10000);
  });

  it('tuodun luonnoksen päivitys säilyttää tilan 50', async () => {
    const s = seed();
    const tuotu = await tuoKitsasLuonnos(s);
    const paivitetty = await luonnos(s, { id: tuotu.id });
    expect(paivitetty.tila).toBe(50);
  });

  it('muistutusluonnos ilman muistutustietoja ei kirjaudu', async () => {
    const s = seed();
    const m = await s.saveTosite(
      {
        pvm: '2026-06-01',
        tyyppi: TositeTyyppi.MAKSUMUISTUTUS,
        tila: TositeTila.VALMISLASKU,
        tunniste: 0,
        sarja: '',
        viennit: [],
      },
      env,
    );
    await expect(kirjaaLaskuluonnos(s, m.id, env)).rejects.toMatchObject({
      code: 'EIMUISTUTUSTIETOJA',
    });
    expect((await s.getAsetukset()).LaskuSeuraavaId).toBeUndefined();
  });
});

describe('listaaLaskuluonnokset', () => {
  it('palauttaa molempien tyyppien luonnokset summineen, ja jättää kirjatut ja poistetut pois', async () => {
    const s = seed();
    const k = await s.saveKumppani({ nimi: 'Asiakas Oy' } as never);
    const a = await luonnos(s, { kumppani: k.id, toisto: 7, ryhma: 'r-2', erapvm: '2026-06-15' });
    await luonnos(s, { pvm: '2026-05-01' }); // poistetaan
    const poistettava = (await s.listTositteet({ bucket: 'luonnos' })).find(
      (t) => t.pvm === '2026-05-01',
    );
    if (!poistettava) throw new Error('puuttuu');
    await poistaTosite(s, poistettava.id, env);
    await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [rivi] }, env); // kirjattu
    const muistutus = await s.saveTosite(
      {
        pvm: '2026-06-20',
        tyyppi: TositeTyyppi.MAKSUMUISTUTUS,
        tila: TositeTila.VALMISLASKU,
        tunniste: 0,
        sarja: '',
        viennit: [],
        alkuperainenTosite: a.id,
        muistutus: {
          maksu: 500 as Cents,
          korko: 945 as Cents,
          viivkorko: 11.5,
          korkoalkaa: '2026-06-15',
          korkoloppuu: '2026-06-20',
          aiempiSaldo: 12550 as Cents,
          aiemmat: [a.id],
        },
      },
      env,
    );
    await s.saveTosite(
      {
        pvm: '2026-06-01',
        tyyppi: TositeTyyppi.MENO,
        tila: TositeTila.LUONNOS,
        tunniste: 0,
        sarja: '',
        viennit: [],
      },
      env,
    ); // muu tyyppi

    const lista = await listaaLaskuluonnokset(s);
    expect(lista).toHaveLength(2);
    expect(lista[0]).toEqual({
      tosite: a.id,
      tyyppi: TositeTyyppi.MYYNTILASKU,
      tila: 80,
      pvm: '2026-06-01',
      erapvm: '2026-06-15',
      kumppani: k.id,
      asiakas: 'Asiakas Oy',
      summa: laskuSummat([rivi]).brutto,
      toisto: 7,
      ryhma: 'r-2',
    });
    expect(lista[0]?.summa).toBe(12550);
    expect(lista[1]).toMatchObject({
      tosite: muistutus.id,
      tyyppi: TositeTyyppi.MAKSUMUISTUTUS,
      summa: 1445,
      alkuperainenTosite: a.id,
    });
  });
});

describe('ryhmälasku', () => {
  const jakso = { alkaa: '2026-05-01', loppuu: '2026-05-31' };

  it('luo yhden luonnoksen per asiakas samasta pohjasta ja ohittaa kaksoiskappaleet', async () => {
    const s = seed();
    const a = await s.saveKumppani({ nimi: 'Asiakas A' });
    const b = await s.saveKumppani({ nimi: 'Asiakas B' });
    const luotu = await tallennaRyhmalasku(
      s,
      {
        pvm: '2026-06-01',
        erapvm: '2026-06-15',
        otsikko: 'Jäsenmaksu',
        jakso,
        rivit: [rivi],
        kumppanit: [b.id, a.id, b.id],
        ryhma: 'ryhma-1',
      },
      env,
    );
    expect(luotu.map((t) => t.kumppani)).toEqual([b.id, a.id]);
    for (const t of luotu) {
      expect(t.tila).toBe(80);
      expect(t.numero).toBeUndefined();
      expect(t.viite).toBeUndefined();
      expect(t.viennit).toEqual([]);
      expect(t.ryhma).toBe('ryhma-1');
      expect(t.jakso).toEqual(jakso);
      expect(t.otsikko).toBe('Jäsenmaksu');
      expect(t.rivit).toHaveLength(1);
    }
    expect(new Set(luotu.map((t) => t.id)).size).toBe(2);
    const lista = await listaaLaskuluonnokset(s);
    expect(lista).toHaveLength(2);
    expect(lista.every((r) => r.ryhma === 'ryhma-1')).toBe(true);
  });

  it('tyhjä vastaanottajalista → EIVASTAANOTTAJIA', async () => {
    const s = seed();
    await expect(
      tallennaRyhmalasku(s, { pvm: '2026-06-01', rivit: [rivi], kumppanit: [], ryhma: 'r' }, env),
    ).rejects.toMatchObject({ code: 'EIVASTAANOTTAJIA' });
  });

  it('virheellinen pohja hylätään eikä jätä luonnoksia', async () => {
    const s = seed();
    const a = await s.saveKumppani({ nimi: 'Asiakas A' });
    await expect(
      tallennaRyhmalasku(s, { pvm: '2026-06-01', rivit: [], kumppanit: [a.id], ryhma: 'r' }, env),
    ).rejects.toMatchObject({ code: 'EIRIVEJA' });
    expect(await listaaLaskuluonnokset(s)).toEqual([]);
  });

  it('luonnokset kirjataan erikseen omilla numeroillaan', async () => {
    const s = seed();
    const a = await s.saveKumppani({ nimi: 'Asiakas A' });
    const b = await s.saveKumppani({ nimi: 'Asiakas B' });
    const [x, y] = await tallennaRyhmalasku(
      s,
      { pvm: '2026-06-01', rivit: [rivi], kumppanit: [a.id, b.id], ryhma: 'r' },
      env,
    );
    const kx = await kirjaaLaskuluonnos(s, x?.id as number, env);
    const ky = await kirjaaLaskuluonnos(s, y?.id as number, env);
    expect([kx.numero, ky.numero]).toEqual(['1', '2']);
    expect(kx.ryhma).toBe('r');
  });
});
