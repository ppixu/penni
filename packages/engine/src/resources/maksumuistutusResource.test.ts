import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { oikaiseErapaiva } from '../laskutus/paivat.js';
import { Maksutapa, TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import {
  luoMaksumuistutukset,
  muistutettavanTiedot,
  onMuistutettava,
} from './maksumuistutusResource.js';
import { tallennaMyyntilasku, tallennaSuoritus } from './myyntilaskuResource.js';
import type { Storage } from './storage.js';

const env = { aika: '2026-06-01T00:00:00.000Z' };

const seed = () =>
  createMemoryStorage({
    tilit: [
      { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
      { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: {
      LaskuSaatavaTili: '1701',
      LaskuKateistili: '1910',
      LaskuMaksutili: '1910',
      OletusMyyntitili: '3000',
      LaskuMaksuaika: '14',
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
      { tositteet: [l.id], pvm: '2026-05-30', erapvm: '2026-06-20', maksu: 0, korko: false },
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
          maksu: 500,
          korko: 100,
          viivkorko: 11.5,
          korkoalkaa: '2026-05-01',
          korkoloppuu: '2026-05-30',
          aiempiSaldo: 100000,
          aiemmat: [l.id],
        },
        viennit: [
          {
            tili: 1701,
            debet: 600,
            kredit: 0,
            pvm: '2026-05-30',
            alvKoodi: 0,
            alvProsentti: 0,
            era: l.id,
          },
          { tili: 3000, debet: 0, kredit: 600, pvm: '2026-05-30', alvKoodi: 0, alvProsentti: 0 },
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
            maksu: 500,
            korko: 0,
            viivkorko: 11.5,
            korkoalkaa: '2026-05-01',
            korkoloppuu: '2026-05-30',
            aiempiSaldo: 100000,
            aiemmat: [l.id],
          },
          viennit:
            tila >= TositeTila.KIRJANPIDOSSA
              ? [
                  {
                    tili: 1701,
                    debet: 500,
                    kredit: 0,
                    pvm: '2026-05-30',
                    alvKoodi: 0,
                    alvProsentti: 0,
                    era: l.id,
                  },
                  {
                    tili: 3000,
                    debet: 0,
                    kredit: 500,
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
          { tili: 1701, debet: 100, kredit: 0, pvm: '2026-04-01', alvKoodi: 0, alvProsentti: 0 },
          { tili: 3000, debet: 0, kredit: 100, pvm: '2026-04-01', alvKoodi: 0, alvProsentti: 0 },
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
