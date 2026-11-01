import { type Cents, Euro } from '@penni/euro';
import { ViiteTyyppi, viiteEralle } from '@penni/validator';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { AlvKoodi } from '../alv/koodit.js';
import { oikaiseErapaiva } from '../laskutus/paivat.js';
import { Maksutapa, TositeTila, TositeTyyppi, VientiTyyppi } from '../vouchers/enums.js';
import { tallennaHyvityslasku } from './hyvityslaskuResource.js';
import { kirjaaLaskuluonnos } from './laskuluonnosResource.js';
import {
  kirjaaMaksumuistutus,
  luoMaksumuistutukset,
  muistutettavanTiedot,
  onMuistutettava,
} from './maksumuistutusResource.js';
import { muistutusKulut, tallennaMyyntilasku, tallennaSuoritus } from './myyntilaskuResource.js';
import type { Storage } from './storage.js';

const c = (n: number) => Euro.fromCents(n);

const env = { aika: '2026-06-01T00:00:00.000Z' };

const seed = () =>
  createMemoryStorage({
    tilit: [
      { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
      { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 9170, tyyppi: 'C', nimi: { fi: 'Korkotuotot myyntisaamisista' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: {
      LaskuSaatavaTili: '1701',
      LaskuKateistili: '1910',
      LaskuMaksutili: '1910',
      OletusMyyntitili: '3000',
      LaskuMaksuaika: '14',
      LaskuMaksumuistutustili: '9170',
      LaskuViivastyskorkotili: '9170',
    },
  });

/** 1000,00 € alv 0 -laskun rivi. */
const tonni = { myyntiKpl: 1, aNetto: 1000, alvKoodi: 0, alvProsentti: 0 };

const lasku = (s: Storage, extra = {}) =>
  tallennaMyyntilasku(
    s,
    { pvm: '2026-04-01', erapvm: '2026-04-30', rivit: [tonni], ...extra },
    env,
  );

describe('luoMaksumuistutukset', () => {
  it('luo luonnoksen erääntyneestä laskusta', async () => {
    const s = seed();
    const k = await s.saveKumppani({ nimi: 'Asiakas Oy' });
    const l = await lasku(s, { kumppani: k.id });
    const [m, ...muut] = await luoMaksumuistutukset(
      s,
      { tositteet: [l.id], pvm: '2026-05-30', korko: true, viivkorko: 11.5 },
      env,
    );
    expect(muut).toEqual([]);
    expect(m).toMatchObject({
      tyyppi: TositeTyyppi.MAKSUMUISTUTUS,
      tila: TositeTila.VALMISLASKU,
      tunniste: 0,
      maksutapa: Maksutapa.LASKU,
      alkuperainenTosite: l.id,
      otsikko: 'Maksumuistutus laskusta 1',
      kumppani: k.id,
      pvm: '2026-05-30',
      viennit: [],
      muistutus: {
        maksu: 500,
        korko: 945,
        viivkorko: 11.5,
        korkoalkaa: '2026-05-01',
        korkoloppuu: '2026-05-30',
        aiempiSaldo: 100000,
        aiemmat: [l.id],
      },
    });
    expect(m?.rivit).toBeUndefined();
    expect(m?.numero).toBeUndefined();
    expect(m?.viite).toBeUndefined();
    expect(m?.erapvm).toBe(oikaiseErapaiva('2026-06-13'));
    // Luonnos löytyy tallennettuna eikä alkuperäiseen lasku ole koskettu.
    expect((await s.getTosite(m?.id as number))?.muistutus?.korko).toBe(945);
    expect(await s.getTosite(l.id)).toEqual(l);
  });

  it('syotteen erapvm, maksu ja korko voittavat oletukset', async () => {
    const s = seed();
    const l = await lasku(s);
    const [m] = await luoMaksumuistutukset(
      s,
      { tositteet: [l.id], pvm: '2026-05-30', erapvm: '2026-06-20', maksu: c(0), korko: false },
      env,
    );
    expect(m?.erapvm).toBe('2026-06-20');
    expect(m?.muistutus).toMatchObject({ maksu: 0, korko: 0 });
  });

  it('osittain maksetulla laskulla korko lasketaan jäljellä olevasta saldosta', async () => {
    const s = seed();
    const l = await lasku(s);
    await tallennaSuoritus(
      s,
      { tosite: l.id, pvm: '2026-05-10', summa: Euro.fromCents(60000) },
      env,
    );
    const [m] = await luoMaksumuistutukset(
      s,
      { tositteet: [l.id], pvm: '2026-05-30', korko: true, viivkorko: 11.5 },
      env,
    );
    expect(m?.muistutus).toMatchObject({ aiempiSaldo: 40000, korko: 378 });
  });

  it('kaksi laskua antaa kaksi luonnosta', async () => {
    const s = seed();
    const a = await lasku(s);
    const b = await lasku(s);
    const luodut = await luoMaksumuistutukset(
      s,
      { tositteet: [a.id, b.id], pvm: '2026-05-30', korko: false },
      env,
    );
    expect(luodut.map((m) => m.alkuperainenTosite)).toEqual([a.id, b.id]);
    expect(await s.listTositteet({ bucket: 'luonnos' })).toHaveLength(2);
  });

  it('ennakkolaskua voi muistuttaa', async () => {
    const s = seed();
    // Ennakkolaskun kirjaus tulee myöhemmästä tehtävästä; tässä riittää kirjattu erällinen tosite.
    const avaus = await lasku(s);
    const l = await s.saveTosite({ ...avaus, maksutapa: Maksutapa.ENNAKKOLASKU }, env);
    const [m] = await luoMaksumuistutukset(
      s,
      { tositteet: [l.id], pvm: '2026-05-30', korko: false },
      env,
    );
    expect(m?.alkuperainenTosite).toBe(l.id);
  });

  it('toinen muistutus viittaa edelleen alkuperäiseen laskuun ja ketjuun kuuluu aiempi muistutus', async () => {
    const s = seed();
    const l = await lasku(s);
    // Kirjattu aiempi muistutus: maksu 500 + korko 100, velkoo erän.
    const edellinen = await s.saveTosite(
      {
        pvm: '2026-05-30',
        tyyppi: TositeTyyppi.MAKSUMUISTUTUS,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        alkuperainenTosite: l.id,
        erapvm: '2026-06-13',
        muistutus: {
          maksu: c(500),
          korko: c(100),
          viivkorko: 11.5,
          korkoalkaa: '2026-05-01',
          korkoloppuu: '2026-05-30',
          aiempiSaldo: c(100000),
          aiemmat: [l.id],
        },
        viennit: [
          {
            tili: 1701,
            debet: c(600),
            kredit: c(0),
            pvm: '2026-05-30',
            alvKoodi: 0,
            alvProsentti: 0,
            era: l.id,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(600),
            pvm: '2026-05-30',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const [m] = await luoMaksumuistutukset(
      s,
      { tositteet: [l.id], pvm: '2026-06-30', korko: true, viivkorko: 10 },
      env,
    );
    expect(m?.alkuperainenTosite).toBe(l.id);
    expect(m?.muistutus?.aiemmat).toEqual([l.id, edellinen.id]);
    // Korkoalkaa = edellisen muistutuksen pvm + 1; saldo sisältää aiemman muistutuksen kulut.
    expect(m?.muistutus).toMatchObject({ korkoalkaa: '2026-05-31', aiempiSaldo: 100600 });
    // peruste = 100600 - 600 = 100000; 10 % * 31 pv / 365 = 849,3
    expect(m?.muistutus?.korko).toBe(849);
  });

  describe('muistutusketjun kelpoisuus', () => {
    /** Alkuperäinen lasku + sen muistutus annetulla tilalla ja eräpäivällä. */
    const ketju = async (tila: number, erapvm: string) => {
      const s = seed();
      const l = await lasku(s);
      const m = await s.saveTosite(
        {
          pvm: '2026-05-30',
          tyyppi: TositeTyyppi.MAKSUMUISTUTUS,
          tila,
          tunniste: 0,
          sarja: '',
          alkuperainenTosite: l.id,
          erapvm,
          muistutus: {
            maksu: c(500),
            korko: c(0),
            viivkorko: 11.5,
            korkoalkaa: '2026-05-01',
            korkoloppuu: '2026-05-30',
            aiempiSaldo: c(100000),
            aiemmat: [l.id],
          },
          viennit:
            tila >= TositeTila.KIRJANPIDOSSA
              ? [
                  {
                    tili: 1701,
                    debet: c(500),
                    kredit: c(0),
                    pvm: '2026-05-30',
                    alvKoodi: 0,
                    alvProsentti: 0,
                    era: l.id,
                  },
                  {
                    tili: 3000,
                    debet: c(0),
                    kredit: c(500),
                    pvm: '2026-05-30',
                    alvKoodi: 0,
                    alvProsentti: 0,
                  },
                ]
              : [],
        },
        env,
      );
      return { s, l, m };
    };
    const syote = (id: number) => ({ tositteet: [id], pvm: '2026-06-30', korko: false });

    it('muistutuksen oma eräpäivä on vielä tulevaisuudessa → EIMUISTUTETTAVA', async () => {
      const { s, m } = await ketju(TositeTila.KIRJANPIDOSSA, '2026-07-15');
      await expect(luoMaksumuistutukset(s, syote(m.id), env)).rejects.toMatchObject({
        code: 'EIMUISTUTETTAVA',
      });
    });

    it('muistutusluonnosta ei voi muistuttaa', async () => {
      const { s, m } = await ketju(TositeTila.VALMISLASKU, '2026-06-13');
      await expect(luoMaksumuistutukset(s, syote(m.id), env)).rejects.toMatchObject({
        code: 'EIMUISTUTETTAVA',
      });
    });

    it('laskun id: kirjattu muistutus, jonka eräpäivä on tulevaisuudessa, estää → EIMUISTUTETTAVA', async () => {
      const { s, l } = await ketju(TositeTila.KIRJANPIDOSSA, '2026-07-15');
      await expect(luoMaksumuistutukset(s, syote(l.id), env)).rejects.toMatchObject({
        code: 'EIMUISTUTETTAVA',
      });
    });

    it('muistutuksen id, kun sen eräpäivä on ohi → uusi muistutus viittaa alkuperäiseen laskuun', async () => {
      const { s, l, m } = await ketju(TositeTila.KIRJANPIDOSSA, '2026-06-13');
      const [uusi] = await luoMaksumuistutukset(s, syote(m.id), env);
      expect(uusi?.alkuperainenTosite).toBe(l.id);
      expect(uusi?.muistutus?.aiemmat).toEqual([l.id, m.id]);
    });
  });

  it('erääntymätön, maksettu, käteinen tai erätön lasku → EIMUISTUTETTAVA', async () => {
    const s = seed();
    const eraantymaton = await lasku(s, { erapvm: '2026-06-30' });
    await expect(
      luoMaksumuistutukset(
        s,
        { tositteet: [eraantymaton.id], pvm: '2026-05-30', korko: true },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EIMUISTUTETTAVA' });
    // Eräpäivänä itsenään ei vielä ole myöhässä.
    const eraPaiva = await lasku(s, { erapvm: '2026-05-30' });
    await expect(
      luoMaksumuistutukset(s, { tositteet: [eraPaiva.id], pvm: '2026-05-30', korko: true }, env),
    ).rejects.toMatchObject({ code: 'EIMUISTUTETTAVA' });

    const maksettu = await lasku(s);
    await tallennaSuoritus(
      s,
      { tosite: maksettu.id, pvm: '2026-05-10', summa: Euro.fromCents(100000) },
      env,
    );
    await expect(
      luoMaksumuistutukset(s, { tositteet: [maksettu.id], pvm: '2026-05-30', korko: true }, env),
    ).rejects.toMatchObject({ code: 'EIMUISTUTETTAVA' });

    const kateinen = await lasku(s, { maksutapa: Maksutapa.KATEINEN });
    await expect(
      luoMaksumuistutukset(s, { tositteet: [kateinen.id], pvm: '2026-05-30', korko: true }, env),
    ).rejects.toMatchObject({ code: 'EIMUISTUTETTAVA' });

    const erata = await s.saveTosite(
      {
        pvm: '2026-04-01',
        tyyppi: TositeTyyppi.MYYNTILASKU,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        erapvm: '2026-04-30',
        viennit: [
          {
            tili: 1701,
            debet: c(100),
            kredit: c(0),
            pvm: '2026-04-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(100),
            pvm: '2026-04-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    await expect(
      luoMaksumuistutukset(s, { tositteet: [erata.id], pvm: '2026-05-30', korko: true }, env),
    ).rejects.toMatchObject({ code: 'EIMUISTUTETTAVA' });
  });

  it('luonnosta ja puuttuvaa tositetta ei voi muistuttaa', async () => {
    const s = seed();
    const l = await lasku(s, { luonnos: true });
    await expect(
      luoMaksumuistutukset(s, { tositteet: [l.id], pvm: '2026-05-30', korko: true }, env),
    ).rejects.toMatchObject({ code: 'EIMUISTUTETTAVA' });
    await expect(
      luoMaksumuistutukset(s, { tositteet: [9999], pvm: '2026-05-30', korko: true }, env),
    ).rejects.toMatchObject({ code: 'EITOSITETTA' });
  });

  it('maksuperusteinen alv kieltää muistutuksen', async () => {
    const s = seed();
    const l = await lasku(s);
    await s.patchAsetukset({ AlvVelvollinen: 'true', MaksuAlvAlkaa: '2026-01-01' });
    await expect(
      luoMaksumuistutukset(s, { tositteet: [l.id], pvm: '2026-05-30', korko: true }, env),
    ).rejects.toMatchObject({ code: 'MAKSUPERUSTEINEN' });
  });

  it('huono id erässä ei luo mitään luonnosta', async () => {
    const s = seed();
    const hyva = await lasku(s);
    const huono = await lasku(s, { erapvm: '2026-06-30' });
    await expect(
      luoMaksumuistutukset(
        s,
        { tositteet: [hyva.id, huono.id], pvm: '2026-05-30', korko: true },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EIMUISTUTETTAVA' });
    expect(await s.listTositteet({ bucket: 'luonnos' })).toEqual([]);
  });

  it('yritysasiakkaan oletuskorko on peruskorko + 8, kuluttajan + 7', async () => {
    const s = seed();
    await s.patchAsetukset({ LaskuPeruskorko: '2.5' });
    const yritys = await s.saveKumppani({ nimi: 'Yritys Oy', alvtunnus: 'FI12345678' });
    const kuluttaja = await s.saveKumppani({ nimi: 'Matti' });
    const a = await lasku(s, { kumppani: yritys.id });
    const b = await lasku(s, { kumppani: kuluttaja.id });
    const [ma, mb] = await luoMaksumuistutukset(
      s,
      { tositteet: [a.id, b.id], pvm: '2026-05-30', korko: true },
      env,
    );
    expect(ma?.muistutus?.viivkorko).toBe(10.5);
    expect(mb?.muistutus?.viivkorko).toBe(9.5);
  });
});

describe('luoMaksumuistutukset: syötteen arvot', () => {
  it('negatiivinen tai epäkokonainen maksu ja negatiivinen viivkorko → EIMUISTUTUSARVO', async () => {
    const s = seed();
    const l = await lasku(s);
    for (const extra of [{ maksu: -100 as Cents }, { maksu: 2.5 as Cents }, { viivkorko: -1 }]) {
      await expect(
        luoMaksumuistutukset(
          s,
          { tositteet: [l.id], pvm: '2026-05-30', korko: true, ...extra },
          env,
        ),
      ).rejects.toMatchObject({ code: 'EIMUISTUTUSARVO' });
    }
    expect(await s.listTositteet({ bucket: 'luonnos' })).toHaveLength(0);
  });

  it('erapvm ennen pvm:ää → EIERAPVM', async () => {
    const s = seed();
    const l = await lasku(s);
    await expect(
      luoMaksumuistutukset(
        s,
        { tositteet: [l.id], pvm: '2026-05-30', erapvm: '2026-05-29', korko: false },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EIERAPVM' });
  });
});

describe('muistutettavanTiedot ja onMuistutettava', () => {
  it('palauttaa laskun, aiemmat muistutukset ja saldon annettuna päivänä', async () => {
    const s = seed();
    const l = await lasku(s);
    await tallennaSuoritus(
      s,
      { tosite: l.id, pvm: '2026-05-10', summa: Euro.fromCents(60000) },
      env,
    );
    const t = await muistutettavanTiedot(s, l.id, '2026-05-05');
    expect(t.lasku.id).toBe(l.id);
    expect(t.aiemmat).toEqual([]);
    expect(t.saldo).toBe(100000);
    expect((await muistutettavanTiedot(s, l.id, '2026-05-30')).saldo).toBe(40000);
    expect(onMuistutettava(t.lasku, t.saldo, '2026-05-30')).toBe(true);
    expect(onMuistutettava(t.lasku, 0 as never, '2026-05-30')).toBe(false);
    expect(onMuistutettava(t.lasku, t.saldo, '2026-04-30')).toBe(false);
  });
});

/** Erääntyneen 1000 € laskun muistutusluonnos 30.5.2026 (oletus: 5,00 € + korko 11,5 %). */
const muistutusluonnos = async (
  s: Storage,
  laskuId: number,
  extra: Partial<{ maksu: Cents; korko: boolean; viivkorko: number; erapvm: string }> = {},
) => {
  const [m] = await luoMaksumuistutukset(
    s,
    { tositteet: [laskuId], pvm: '2026-05-30', korko: true, viivkorko: 11.5, ...extra },
    env,
  );
  return m as NonNullable<typeof m>;
};

describe('kirjaaMaksumuistutus', () => {
  it('kirjaa luonnoksen: numero, viite ja kolme vientiä erälle', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await muistutusluonnos(s, l.id);
    const kirjattu = await kirjaaLaskuluonnos(s, m.id, env);

    expect(kirjattu).toMatchObject({
      id: m.id,
      tila: TositeTila.KIRJANPIDOSSA,
      tyyppi: TositeTyyppi.MAKSUMUISTUTUS,
      numero: '2',
      viite: viiteEralle(ViiteTyyppi.LASKU, 2),
      alkuperainenTosite: l.id,
      muistutus: { maksu: 500, korko: 945, aiempiSaldo: 100000, aiemmat: [l.id] },
    });
    expect(kirjattu.tunniste).toBeGreaterThan(0);
    expect(kirjattu.viennit).toEqual([
      {
        tili: 1701,
        debet: c(1445),
        kredit: c(0),
        pvm: '2026-05-30',
        alvKoodi: 0,
        alvProsentti: 0,
        era: l.id,
        tyyppi: VientiTyyppi.MYYNTI + VientiTyyppi.VASTAKIRJAUS,
        selite: 'Maksumuistutus laskusta 1',
      },
      {
        tili: 9170,
        debet: c(0),
        kredit: c(500),
        pvm: '2026-05-30',
        alvKoodi: 0,
        alvProsentti: 0,
        tyyppi: VientiTyyppi.MYYNTI + VientiTyyppi.KIRJAUS,
        selite: 'Huomautuskulut',
      },
      {
        tili: 9170,
        debet: c(0),
        kredit: c(945),
        pvm: '2026-05-30',
        alvKoodi: 0,
        alvProsentti: 0,
        tyyppi: VientiTyyppi.MYYNTI + VientiTyyppi.KIRJAUS,
        selite: 'Viivästyskorko 1.5.2026–30.5.2026',
      },
    ]);
    expect((await s.getAsetukset()).LaskuSeuraavaId).toBe('3');
    expect((await s.queryErat({})).get(l.id)).toBe(101445);
    // Alkuperäinen lasku pysyy koskemattomana.
    expect(await s.getTosite(l.id)).toEqual(l);
  });

  it('laskee uudelleen kirjaushetken erän saldolla', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await muistutusluonnos(s, l.id);
    // Luonnoksen jälkeen kirjattu osasuoritus ennen muistutuspäivää pienentää korkoa.
    await tallennaSuoritus(
      s,
      { tosite: l.id, pvm: '2026-05-10', summa: Euro.fromCents(60000) },
      env,
    );
    const kirjattu = await kirjaaLaskuluonnos(s, m.id, env);
    expect(kirjattu.muistutus).toMatchObject({ aiempiSaldo: 40000, korko: 378 });
    expect(kirjattu.viennit[0]?.debet).toBe(878);
  });

  it('muutokset: pvm, eräpäivä, otsikko, maksu ja korkoprosentti', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await muistutusluonnos(s, l.id);
    const kirjattu = await kirjaaMaksumuistutus(s, m, env, {
      pvm: '2026-06-09',
      erapvm: '2026-06-30',
      otsikko: 'Muistutus',
      muistutus: { maksu: 700 as Cents, viivkorko: 10 },
    });
    // 1.5.–9.6. = 40 päivää; 100000 × 10 % × 40 / 365 = 1095,9
    expect(kirjattu).toMatchObject({
      pvm: '2026-06-09',
      erapvm: '2026-06-30',
      otsikko: 'Muistutus',
      muistutus: { maksu: 700, korko: 1096, viivkorko: 10, korkoloppuu: '2026-06-09' },
    });
    expect(kirjattu.viennit.map((v) => [v.tili, v.debet, v.kredit])).toEqual([
      [1701, 1796, 0],
      [9170, 0, 700],
      [9170, 0, 1096],
    ]);
  });

  it('nollamuistutus saa numeron ja viitteen mutta ei vientejä', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await muistutusluonnos(s, l.id, { maksu: 0 as Cents, korko: false });
    const kirjattu = await kirjaaLaskuluonnos(s, m.id, env);
    expect(kirjattu).toMatchObject({
      tila: TositeTila.KIRJANPIDOSSA,
      numero: '2',
      viite: viiteEralle(ViiteTyyppi.LASKU, 2),
      viennit: [],
    });
    expect((await s.getAsetukset()).LaskuSeuraavaId).toBe('3');
  });

  it('puuttuva tiliasetus → EILASKUTILIA eikä numero kulu', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await muistutusluonnos(s, l.id);
    await s.patchAsetukset({ LaskuViivastyskorkotili: '' });
    await expect(kirjaaLaskuluonnos(s, m.id, env)).rejects.toMatchObject({
      code: 'EILASKUTILIA',
    });
    expect((await s.getAsetukset()).LaskuSeuraavaId).toBe('2');
    expect((await s.getTosite(m.id))?.tila).toBe(TositeTila.VALMISLASKU);
  });

  it('maksettua laskua ei voi enää muistuttaa kirjattaessa → EIMUISTUTETTAVA', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await muistutusluonnos(s, l.id);
    await tallennaSuoritus(
      s,
      { tosite: l.id, pvm: '2026-05-10', summa: Euro.fromCents(100000) },
      env,
    );
    await expect(kirjaaLaskuluonnos(s, m.id, env)).rejects.toMatchObject({
      code: 'EIMUISTUTETTAVA',
    });
  });
});

describe('kirjaaMaksumuistutus: suojaukset', () => {
  it('muu kuin muistutusluonnos → EILUONNOS eikä kirjattua tositetta kosketa', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await muistutusluonnos(s, l.id);
    const kirjattu = await kirjaaLaskuluonnos(s, m.id, env);
    // Kirjattu muistutus ei saa saada uutta numeroa eikä kirjoittua uudelleen.
    await expect(kirjaaMaksumuistutus(s, kirjattu, env)).rejects.toMatchObject({
      code: 'EILUONNOS',
    });
    // Kirjattu myyntilasku ja myyntilaskuluonnos eivät ole muistutusluonnoksia.
    await expect(kirjaaMaksumuistutus(s, l, env)).rejects.toMatchObject({ code: 'EILUONNOS' });
    const myyntiluonnos = await lasku(s, { luonnos: true });
    await expect(kirjaaMaksumuistutus(s, myyntiluonnos, env)).rejects.toMatchObject({
      code: 'EILUONNOS',
    });
    expect(await s.getTosite(kirjattu.id)).toEqual(kirjattu);
    expect((await s.getAsetukset()).LaskuSeuraavaId).toBe('3');
  });

  it('virheellinen maksu tai viivkorko kirjauksessa → EIMUISTUTUSARVO', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await muistutusluonnos(s, l.id);
    for (const muistutus of [{ maksu: -1 as Cents }, { maksu: 5.5 as Cents }, { viivkorko: -2 }]) {
      await expect(kirjaaMaksumuistutus(s, m, env, { muistutus })).rejects.toMatchObject({
        code: 'EIMUISTUTUSARVO',
      });
    }
    expect((await s.getTosite(m.id))?.tila).toBe(TositeTila.VALMISLASKU);
    expect((await s.getAsetukset()).LaskuSeuraavaId).toBe('2');
  });

  it('pvm-ylikirjoitus ilman erapvm:ia laskee oletuseräpäivän uudelleen', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await muistutusluonnos(s, l.id);
    const kirjattu = await kirjaaMaksumuistutus(s, m, env, { pvm: '2026-06-09' });
    // 9.6. + 14 pv = 23.6. (tiistai)
    expect(kirjattu.erapvm).toBe(oikaiseErapaiva('2026-06-23'));
    expect(kirjattu.erapvm).not.toBe(m.erapvm);
  });

  it('pvm-ylikirjoitus ja eksplisiittinen erapvm: erapvm säilyy', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await muistutusluonnos(s, l.id);
    const kirjattu = await kirjaaMaksumuistutus(s, m, env, {
      pvm: '2026-06-09',
      erapvm: '2026-07-15',
    });
    expect(kirjattu.erapvm).toBe('2026-07-15');
  });

  it('ilman pvm-ylikirjoitusta luonnoksen erapvm säilyy', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await muistutusluonnos(s, l.id, { erapvm: '2026-07-15' });
    const kirjattu = await kirjaaMaksumuistutus(s, m, env);
    expect(kirjattu.erapvm).toBe('2026-07-15');
  });

  it('erapvm ennen pvm:ää → EIERAPVM', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await muistutusluonnos(s, l.id);
    await expect(
      kirjaaMaksumuistutus(s, m, env, { pvm: '2026-06-09', erapvm: '2026-06-08' }),
    ).rejects.toMatchObject({ code: 'EIERAPVM' });
    await expect(kirjaaMaksumuistutus(s, m, env, { erapvm: '2026-05-29' })).rejects.toMatchObject({
      code: 'EIERAPVM',
    });
    expect((await s.getAsetukset()).LaskuSeuraavaId).toBe('2');
  });
});

describe('maksumuistutuksen maksu', () => {
  it('muistutuksen loppusumman maksu nollaa laskun erän', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await kirjaaLaskuluonnos(s, (await muistutusluonnos(s, l.id)).id, env);
    const maksu = await tallennaSuoritus(
      s,
      { tosite: m.id, pvm: '2026-06-10', summa: Euro.fromCents(101445) },
      env,
    );
    expect(maksu.viennit.find((v) => v.tili === 1701)).toMatchObject({ kredit: 101445, era: l.id });
    expect((await s.queryErat({})).get(l.id)).toBe(0);
  });

  it('nollamuistutuksen maksu kohdistuu laskun erään', async () => {
    const s = seed();
    const l = await lasku(s);
    const m = await kirjaaLaskuluonnos(
      s,
      (await muistutusluonnos(s, l.id, { maksu: 0 as Cents, korko: false })).id,
      env,
    );
    const maksu = await tallennaSuoritus(
      s,
      { tosite: m.id, pvm: '2026-06-10', summa: Euro.fromCents(100000) },
      env,
    );
    expect(maksu.viennit.find((v) => v.tili === 1701)).toMatchObject({ kredit: 100000, era: l.id });
    expect((await s.queryErat({})).get(l.id)).toBe(0);
  });

  it('muistutusKulut summaa vain kirjattujen muistutusten maksut ja korot', async () => {
    const s = seed();
    const l = await lasku(s);
    expect(await muistutusKulut(s, l.id)).toBe(0);
    await kirjaaLaskuluonnos(s, (await muistutusluonnos(s, l.id)).id, env);
    // Luonnos ja hyvityslasku samalla alkuperäisellä tositteella eivät ole muistutuskuluja.
    await luoMaksumuistutukset(
      s,
      { tositteet: [l.id], pvm: '2026-06-30', korko: false, maksu: 900 as Cents },
      env,
    );
    await tallennaHyvityslasku(s, { alkuperainenTosite: l.id, pvm: '2026-06-12' }, env);
    expect(await muistutusKulut(s, l.id)).toBe(1445);
  });
});

describe('maksuperusteinen alv: suoritus kohdistuu ensin pääomaan', () => {
  // Maksuperusteinen alv 1.1.–30.4.2026; muistutus 30.5. on jo ikkunan ulkopuolella.
  const alvSeed = () =>
    createMemoryStorage({
      tilit: [
        { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
        { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
        { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Suoritettava alv' } },
        { numero: 2949, tyyppi: 'BLM', nimi: { fi: 'Kohdentamaton alv-velka' } },
        { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
        { numero: 9170, tyyppi: 'C', nimi: { fi: 'Korkotuotot myyntisaamisista' } },
      ],
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: {
        AlvVelvollinen: 'true',
        MaksuAlvAlkaa: '2026-01-01',
        MaksuAlvLoppuu: '2026-05-01',
        AlvVelkaTili: '2939',
        LaskuSaatavaTili: '1701',
        LaskuMaksutili: '1910',
        OletusMyyntitili: '3000',
        LaskuMaksumuistutustili: '9170',
        LaskuViivastyskorkotili: '9170',
      },
    });

  /** 1240 € sis. alv 24 % maksuperusteisena (alv 240 € lykättynä 2949:lle) + 15 € muistutus. */
  const valmistele = async () => {
    const s = alvSeed();
    const l = await tallennaMyyntilasku(
      s,
      {
        pvm: '2026-04-01',
        erapvm: '2026-04-30',
        rivit: [{ myyntiKpl: 1, aNetto: 1000, alvKoodi: AlvKoodi.MYYNNIT_NETTO, alvProsentti: 24 }],
      },
      env,
    );
    expect(l.viennit.find((v) => v.tili === 2949)).toMatchObject({ kredit: 24000, alvKoodi: 418 });
    const [luonnos] = await luoMaksumuistutukset(
      s,
      { tositteet: [l.id], pvm: '2026-05-30', korko: false, maksu: 1500 as Cents },
      env,
    );
    const m = await kirjaaLaskuluonnos(s, luonnos?.id as number, env);
    expect((await s.queryErat({})).get(l.id)).toBe(125500);
    return { s, l, m };
  };
  const tunnistettu = (t: { viennit: { tili: number; alvKoodi: number; kredit: number }[] }) =>
    t.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118)?.kredit ?? 0;
  const maksa = (s: Storage, tosite: number, pvm: string, senttia: number) =>
    tallennaSuoritus(s, { tosite, pvm, summa: Euro.fromCents(senttia) }, env);

  it('620 € suoritus tunnistaa 120,00 € (62000 / (125500 − 1500) × 24000)', async () => {
    const { s, l } = await valmistele();
    expect(tunnistettu(await maksa(s, l.id, '2026-06-10', 62000))).toBe(12000);
  });

  it('pääoman täyttävä suoritus tunnistaa loput eikä muistutuskulujen maksu tunnista enempää', async () => {
    const { s, l } = await valmistele();
    const p1 = await maksa(s, l.id, '2026-06-10', 62000);
    const p2 = await maksa(s, l.id, '2026-06-20', 62000);
    const p3 = await maksa(s, l.id, '2026-06-25', 1500);
    expect([tunnistettu(p1), tunnistettu(p2), tunnistettu(p3)]).toEqual([12000, 12000, 0]);
    expect((await s.queryErat({})).get(l.id)).toBe(0);
  });

  it('muistutukselle kirjattu suoritus tunnistaa alkuperäisen laskun lykätyn alv:n', async () => {
    const { s, m } = await valmistele();
    expect(tunnistettu(await maksa(s, m.id, '2026-06-10', 62000))).toBe(12000);
  });
});
