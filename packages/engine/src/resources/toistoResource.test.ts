import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { AlvKoodi } from '../alv/koodit.js';
import {
  type ToistoPohja,
  paivitaRivienAlv,
  pohjaLaskusta,
  siirraJaksoa,
} from '../laskutus/toisto.js';
import { Maksutapa, TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import type { IsoDate, TositeRivi } from '../vouchers/types.js';
import { kirjaaLaskuluonnos } from './laskuluonnosResource.js';
import { tallennaMyyntilasku } from './myyntilaskuResource.js';
import type { Storage, StoredTosite } from './storage.js';
import { luoErantyneetToistot, luoToistoLaskusta } from './toistoResource.js';
import { poistaTosite } from './tositeResource.js';

const env = { aika: '2026-06-01T00:00:00.000Z' };

const seed = (asetukset: Record<string, string> = {}) =>
  createMemoryStorage({
    tilit: [
      { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Suoritettava alv' } },
    ],
    tilikaudet: [
      { alkaa: '2024-01-01', loppuu: '2024-12-31' },
      { alkaa: '2025-01-01', loppuu: '2025-12-31' },
      { alkaa: '2026-01-01', loppuu: '2026-12-31' },
    ],
    asetukset: {
      AlvVelvollinen: 'true',
      LaskuSaatavaTili: '1701',
      OletusMyyntitili: '3000',
      AlvVelkaTili: '2939',
      ...asetukset,
    },
  });

const rivi: TositeRivi = {
  myyntiKpl: 1,
  aNetto: 100,
  alvKoodi: AlvKoodi.MYYNNIT_NETTO,
  alvProsentti: 25.5,
};

const pohja = (extra: Partial<ToistoPohja> = {}): ToistoPohja => ({
  otsikko: 'Ylläpito',
  maksutapa: Maksutapa.LASKU,
  rivit: [rivi],
  maksuaikaPaivia: 14,
  ...extra,
});

const toisto = (
  s: Storage,
  extra: { seuraava?: IsoDate; loppuu?: IsoDate; pohja?: ToistoPohja; kumppani?: number } = {},
) =>
  s.saveToisto({
    kuukausia: 1,
    seuraava: '2026-01-31',
    aktiivinen: true,
    pohja: pohja(),
    ...extra,
  });

/** Toistosta luodut (poistamattomat) luonnokset päivän mukaan. */
async function toistonLuonnokset(s: Storage, id: number): Promise<StoredTosite[]> {
  const luonnokset = await s.listTositteet({ bucket: 'luonnos' });
  return luonnokset
    .filter((t) => t.toisto === id)
    .sort((a, b) => (a.pvm < b.pvm ? -1 : a.pvm > b.pvm ? 1 : 0));
}

async function haeToisto(s: Storage, id: number) {
  const t = (await s.getToistot()).find((x) => x.id === id);
  if (!t) throw new Error(`toisto ${id} puuttuu`);
  return t;
}

describe('toisto: puhtaat apurit', () => {
  it('siirraJaksoa: alkaa = loppuu + 1, loppuu siirtyy kuukausilla ja pysyy kuun lopussa', () => {
    expect(siirraJaksoa({ alkaa: '2026-11-01', loppuu: '2026-11-30' }, 1)).toEqual({
      alkaa: '2026-12-01',
      loppuu: '2026-12-31',
    });
    expect(siirraJaksoa({ alkaa: '2026-01-01', loppuu: '2026-03-31' }, 3)).toEqual({
      alkaa: '2026-04-01',
      loppuu: '2026-06-30',
    });
  });

  it('pohjaLaskusta: maksuaika eräpäivästä ja jakso siirrettynä kerran', () => {
    const p = pohjaLaskusta(
      {
        pvm: '2026-01-15',
        laskupvm: '2026-01-15',
        erapvm: '2026-01-29',
        tyyppi: TositeTyyppi.MYYNTILASKU,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 1,
        sarja: '',
        otsikko: 'Tammikuu',
        maksutapa: Maksutapa.LASKU,
        info: 'Lisätieto',
        rivit: [rivi],
        jakso: { alkaa: '2026-01-01', loppuu: '2026-01-31' },
        viennit: [],
      },
      1,
    );
    expect(p).toEqual({
      otsikko: 'Tammikuu',
      maksutapa: Maksutapa.LASKU,
      info: 'Lisätieto',
      rivit: [rivi],
      maksuaikaPaivia: 14,
      jakso: { alkaa: '2026-02-01', loppuu: '2026-02-28' },
    });
  });

  it('paivitaRivienAlv: vain vanhentunut yleinen kanta myyntiriveillä vaihtuu', () => {
    const rivit: TositeRivi[] = [
      { ...rivi, alvProsentti: 24 },
      { ...rivi, alvProsentti: 14 },
      { ...rivi, alvProsentti: 25.5 },
      { ...rivi, alvKoodi: AlvKoodi.EIALV, alvProsentti: 24 },
    ];
    expect(paivitaRivienAlv(rivit, '2024-10-01').map((r) => r.alvProsentti)).toEqual([
      25.5, 14, 25.5, 24,
    ]);
    expect(paivitaRivienAlv(rivit, '2024-08-31').map((r) => r.alvProsentti)).toEqual([
      24, 14, 24, 24,
    ]);
  });
});

describe('luoErantyneetToistot', () => {
  it('kuukausittainen toisto luo jokaiselle erääntyneelle kuulle luonnoksen', async () => {
    const s = seed();
    const t = await toisto(s);
    const tulos = await luoErantyneetToistot(s, '2026-03-05', env);
    expect(tulos.ohitettu).toBeUndefined();
    expect(tulos.luodut).toHaveLength(2);

    const luonnokset = await toistonLuonnokset(s, t.id);
    expect(luonnokset.map((l) => l.id)).toEqual(tulos.luodut);
    expect(luonnokset.map((l) => [l.pvm, l.laskupvm, l.toistoPvm, l.erapvm])).toEqual([
      ['2026-01-31', '2026-01-31', '2026-01-31', '2026-02-16'], // 14.2. on la -> ma 16.2.
      ['2026-02-28', '2026-02-28', '2026-02-28', '2026-03-16'], // 14.3. on la -> ma 16.3.
    ]);
    for (const l of luonnokset) {
      expect(l.tila).toBe(TositeTila.VALMISLASKU);
      expect(l.tyyppi).toBe(TositeTyyppi.MYYNTILASKU);
      expect(l.numero).toBeUndefined();
      expect(l.viennit).toEqual([]);
      expect(l.otsikko).toBe('Ylläpito');
      expect(l.rivit).toEqual([rivi]);
    }
    expect(await haeToisto(s, t.id)).toMatchObject({ seuraava: '2026-03-31', aktiivinen: true });
  });

  it('laskutusjakso kulkee luonnoksille ja pohja siirtyy eteenpäin', async () => {
    const s = seed();
    const t = await toisto(s, {
      pohja: pohja({ jakso: { alkaa: '2026-01-01', loppuu: '2026-01-31' } }),
    });
    await luoErantyneetToistot(s, '2026-03-05', env);
    const luonnokset = await toistonLuonnokset(s, t.id);
    expect(luonnokset.map((l) => l.jakso)).toEqual([
      { alkaa: '2026-01-01', loppuu: '2026-01-31' },
      { alkaa: '2026-02-01', loppuu: '2026-02-28' },
    ]);
    expect((await haeToisto(s, t.id)).pohja.jakso).toEqual({
      alkaa: '2026-03-01',
      loppuu: '2026-03-31',
    });
  });

  it('kumppani tulee toistolta', async () => {
    const s = seed();
    const asiakas = await s.saveKumppani({ nimi: 'Toistoasiakas Oy' });
    const t = await toisto(s, { kumppani: asiakas.id, seuraava: '2026-03-01' });
    await luoErantyneetToistot(s, '2026-03-05', env);
    expect((await toistonLuonnokset(s, t.id))[0]?.kumppani).toBe(asiakas.id);
  });

  it('toinen ajo samalla päivällä ei luo mitään', async () => {
    const s = seed();
    const t = await toisto(s);
    await luoErantyneetToistot(s, '2026-03-05', env);
    expect(await luoErantyneetToistot(s, '2026-03-05', env)).toEqual({ luodut: [] });
    expect(await toistonLuonnokset(s, t.id)).toHaveLength(2);
  });

  it('poistettua luonnosta ei luoda uudelleen', async () => {
    const s = seed();
    const t = await toisto(s);
    const { luodut } = await luoErantyneetToistot(s, '2026-03-05', env);
    await poistaTosite(s, luodut[0] as number, env);
    expect(await luoErantyneetToistot(s, '2026-03-05', env)).toEqual({ luodut: [] });
    expect(await toistonLuonnokset(s, t.id)).toHaveLength(1);
  });

  it('kaatumisen jälkeen olemassa oleva luonnos ohitetaan ja seuraava siirtyy', async () => {
    const s = seed();
    const t = await toisto(s);
    // Luonnos tallentui, mutta toiston päivitys (seuraava -> 2026-02-28) jäi tekemättä.
    const jaanyt = await tallennaMyyntilasku(
      s,
      {
        pvm: '2026-01-31',
        rivit: [rivi],
        luonnos: true,
        toisto: t.id,
        toistoPvm: '2026-01-31',
      },
      env,
    );
    const { luodut } = await luoErantyneetToistot(s, '2026-03-05', env);
    expect(luodut).toHaveLength(1);
    const luonnokset = await toistonLuonnokset(s, t.id);
    expect(luonnokset.map((l) => [l.id, l.toistoPvm])).toEqual([
      [jaanyt.id, '2026-01-31'],
      [luodut[0], '2026-02-28'],
    ]);
    expect((await haeToisto(s, t.id)).seuraava).toBe('2026-03-31');
  });

  it('kirjattu toiston lasku estää saman päivän luonnoksen', async () => {
    const s = seed();
    const t = await toisto(s, { seuraava: '2026-03-01' });
    await tallennaMyyntilasku(
      s,
      { pvm: '2026-03-01', rivit: [rivi], toisto: t.id, toistoPvm: '2026-03-01' },
      env,
    );
    expect(await luoErantyneetToistot(s, '2026-03-05', env)).toEqual({ luodut: [] });
    expect((await haeToisto(s, t.id)).seuraava).toBe('2026-04-01');
  });

  it('päättymispäivän jälkeen toisto lakkaa', async () => {
    const s = seed();
    const t = await toisto(s, { loppuu: '2026-02-15' });
    const { luodut } = await luoErantyneetToistot(s, '2026-03-05', env);
    expect(luodut).toHaveLength(1);
    expect((await toistonLuonnokset(s, t.id)).map((l) => l.pvm)).toEqual(['2026-01-31']);
    expect(await haeToisto(s, t.id)).toMatchObject({ seuraava: '2026-02-28', aktiivinen: false });
  });

  it('pysäytetty ja tulevaisuuden toisto ohitetaan', async () => {
    const s = seed();
    await s.saveToisto({
      kuukausia: 1,
      seuraava: '2026-01-31',
      aktiivinen: false,
      pohja: pohja(),
    });
    await toisto(s, { seuraava: '2026-04-01' });
    expect(await luoErantyneetToistot(s, '2026-03-05', env)).toEqual({ luodut: [] });
  });

  it('vanhentunut yleinen alv-kanta päivittyy laskutusjakson lopun mukaan', async () => {
    const s = seed();
    const vanha = pohja({ rivit: [{ ...rivi, alvProsentti: 24 }] });
    const a = await toisto(s, { seuraava: '2024-10-01', pohja: vanha });
    const b = await toisto(s, {
      seuraava: '2024-10-01',
      pohja: { ...vanha, jakso: { alkaa: '2024-08-01', loppuu: '2024-08-31' } },
    });
    await luoErantyneetToistot(s, '2024-10-05', env);
    expect((await toistonLuonnokset(s, a.id))[0]?.rivit?.[0]?.alvProsentti).toBe(25.5);
    expect((await toistonLuonnokset(s, b.id))[0]?.rivit?.[0]?.alvProsentti).toBe(24);
  });

  it('tuoterivin hinta päivittyy tuoterekisteristä', async () => {
    const s = seed();
    const tuote = await s.saveTuote({
      nimike: 'Ylläpito',
      aNetto: 100,
      alvKoodi: AlvKoodi.MYYNNIT_NETTO,
      alvProsentti: 25.5,
    });
    const poistettu = await s.saveTuote({
      nimike: 'Vanha',
      aNetto: 5,
      alvKoodi: AlvKoodi.MYYNNIT_NETTO,
      alvProsentti: 25.5,
    });
    await s.deleteTuote(poistettu.id);
    const t = await toisto(s, {
      seuraava: '2026-03-01',
      pohja: pohja({
        rivit: [
          { ...rivi, tuote: tuote.id },
          { ...rivi, aNetto: 7, tuote: poistettu.id },
        ],
      }),
    });
    await s.saveTuote({ ...tuote, aNetto: 120 });
    await luoErantyneetToistot(s, '2026-03-05', env);
    const [l] = await toistonLuonnokset(s, t.id);
    expect(l?.rivit?.map((r) => r.aNetto)).toEqual([120, 7]);
  });

  it('lukittu tai tilikaudeton päivä ohittaa kaiken', async () => {
    const lukittu = seed({ TilitPaatetty: '2026-03-31' });
    // Ilman erääntyneitä toistoja ohitusta ei ilmoiteta.
    expect(await luoErantyneetToistot(lukittu, '2026-03-05', env)).toEqual({ luodut: [] });
    await toisto(lukittu);
    expect(await luoErantyneetToistot(lukittu, '2026-03-05', env)).toEqual({
      luodut: [],
      ohitettu: 'LUKITTU',
    });
    expect(await lukittu.listTositteet({ bucket: 'luonnos' })).toEqual([]);

    const s = seed();
    await toisto(s);
    expect(await luoErantyneetToistot(s, '2027-03-05', env)).toEqual({
      luodut: [],
      ohitettu: 'EITILIKAUTTA',
    });
    expect(await s.listTositteet({ bucket: 'luonnos' })).toEqual([]);
  });

  it('lukittuun kauteen osuva ajastettu päivä saa luonnoksen tälle päivälle', async () => {
    const s = seed({ TilitPaatetty: '2026-01-31' });
    const t = await toisto(s);
    await luoErantyneetToistot(s, '2026-03-05', env);
    const luonnokset = await toistonLuonnokset(s, t.id);
    expect(luonnokset.map((l) => [l.pvm, l.toistoPvm])).toEqual([
      ['2026-02-28', '2026-02-28'],
      ['2026-03-05', '2026-01-31'],
    ]);
  });
});

describe('luoToistoLaskusta', () => {
  it('luo toiston kirjatusta laskusta oletuspäivällä', async () => {
    const s = seed();
    const asiakas = await s.saveKumppani({ nimi: 'Asiakas Oy' });
    const lasku = await tallennaMyyntilasku(
      s,
      {
        pvm: '2026-01-31',
        erapvm: '2026-02-14',
        kumppani: asiakas.id,
        otsikko: 'Tammikuu',
        rivit: [rivi],
        jakso: { alkaa: '2026-01-01', loppuu: '2026-01-31' },
      },
      env,
    );
    const t = await luoToistoLaskusta(s, { tosite: lasku.id, kuukausia: 1, nimi: 'Ylläpito' }, env);
    expect(t).toMatchObject({
      nimi: 'Ylläpito',
      kumppani: asiakas.id,
      kuukausia: 1,
      seuraava: '2026-02-28',
      lahdeTosite: lasku.id,
      aktiivinen: true,
      pohja: {
        otsikko: 'Tammikuu',
        maksutapa: Maksutapa.LASKU,
        rivit: [rivi],
        maksuaikaPaivia: 14,
        jakso: { alkaa: '2026-02-01', loppuu: '2026-02-28' },
      },
    });
    expect(t.loppuu).toBeUndefined();
    expect(await s.getToistot()).toEqual([t]);

    const annettu = await luoToistoLaskusta(
      s,
      { tosite: lasku.id, kuukausia: 3, seuraava: '2026-05-01', loppuu: '2026-12-31' },
      env,
    );
    expect(annettu).toMatchObject({ kuukausia: 3, seuraava: '2026-05-01', loppuu: '2026-12-31' });
    expect(annettu.pohja.jakso).toEqual({ alkaa: '2026-02-01', loppuu: '2026-04-30' });
  });

  it('virheet: puuttuva tosite, luonnos ja virheellinen väli', async () => {
    const s = seed();
    await expect(luoToistoLaskusta(s, { tosite: 999, kuukausia: 1 }, env)).rejects.toMatchObject({
      code: 'EITOSITETTA',
    });
    const luonnos = await tallennaMyyntilasku(
      s,
      { pvm: '2026-01-31', rivit: [rivi], luonnos: true },
      env,
    );
    await expect(
      luoToistoLaskusta(s, { tosite: luonnos.id, kuukausia: 1 }, env),
    ).rejects.toMatchObject({ code: 'EIKELPAA' });
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-01-31', rivit: [rivi] }, env);
    for (const kuukausia of [0, -1, 1.5]) {
      await expect(
        luoToistoLaskusta(s, { tosite: lasku.id, kuukausia }, env),
      ).rejects.toMatchObject({ code: 'EIKUUKAUSIA' });
    }
  });
});

describe('toiston luonnoksen kirjaus päivittää pohjan', () => {
  it('muuttamaton, viikonlopulta siirretty eräpäivä ei kasvata maksuaikaa', async () => {
    const s = seed();
    const t = await toisto(s);
    const { luodut } = await luoErantyneetToistot(s, '2026-02-05', env);
    const kirjattu = await kirjaaLaskuluonnos(s, luodut[0] as number, env);
    expect(kirjattu.erapvm).toBe('2026-02-16'); // 14.2. on la -> ma 16.2.
    expect((await haeToisto(s, t.id)).pohja.maksuaikaPaivia).toBe(14);
  });

  it('muokatut rivit, otsikko ja maksuaika siirtyvät pohjaan; aikataulu ei muutu', async () => {
    const s = seed();
    const t = await toisto(s, {
      pohja: pohja({ jakso: { alkaa: '2026-01-01', loppuu: '2026-01-31' } }),
    });
    const { luodut } = await luoErantyneetToistot(s, '2026-03-05', env);
    const muokattu = { ...rivi, aNetto: 150, selite: 'Korotettu' };
    await kirjaaLaskuluonnos(s, luodut[0] as number, env, {
      rivit: [muokattu],
      otsikko: 'Uusi otsikko',
      erapvm: '2026-03-02',
    });
    expect(await haeToisto(s, t.id)).toMatchObject({
      seuraava: '2026-03-31',
      pohja: {
        otsikko: 'Uusi otsikko',
        maksutapa: Maksutapa.LASKU,
        rivit: [muokattu],
        maksuaikaPaivia: 30,
        jakso: { alkaa: '2026-03-01', loppuu: '2026-03-31' },
      },
    });
  });

  it('poistetun toiston luonnos kirjautuu normaalisti', async () => {
    const s = seed();
    const t = await toisto(s);
    const { luodut } = await luoErantyneetToistot(s, '2026-02-05', env);
    await s.deleteToisto(t.id);
    const kirjattu = await kirjaaLaskuluonnos(s, luodut[0] as number, env);
    expect(kirjattu.tila).toBe(TositeTila.KIRJANPIDOSSA);
    expect(await s.getToistot()).toEqual([]);
  });
});
