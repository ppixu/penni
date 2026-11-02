import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { AlvKoodi, TILITYS } from '../alv/koodit.js';
import { Maksutapa, TositeTila, TositeTyyppi, VientiTyyppi } from '../vouchers/enums.js';
import type { TositeRivi } from '../vouchers/types.js';
import { haeAlvLaskelma } from './alvLaskelma.js';
import { haeAvoimetEnnakot } from './ennakkoResource.js';
import { tallennaHyvityslasku } from './hyvityslaskuResource.js';
import { onMuistutettava } from './maksumuistutusResource.js';
import {
  listaaMyyntilaskut,
  tallennaMyyntilasku,
  tallennaSuoritus,
} from './myyntilaskuResource.js';
import type { Storage } from './storage.js';
import { listaaTulot } from './tulotResource.js';

const c = (n: number) => Euro.fromCents(n);
const env = { aika: '2026-06-01T00:00:00.000Z' };

const seed = (asetukset: Record<string, string> = {}) =>
  createMemoryStorage({
    tilit: [
      { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
      { numero: 1715, tyyppi: 'AO', nimi: { fi: 'Myyntisaamiset ennakkolaskuista' } },
      { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
      { numero: 2861, tyyppi: 'B', nimi: { fi: 'Saadut ennakot' } },
      { numero: 29392, tyyppi: 'B', nimi: { fi: 'Arvonlisäverovelka ennakkolaskuista' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
      { numero: 2949, tyyppi: 'BLM', nimi: { fi: 'Kohdentamaton alv-velka' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 9170, tyyppi: 'C', nimi: { fi: 'Muistutusmaksut' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: {
      AlvVelvollinen: 'true',
      LaskuSaatavaTili: '1701',
      LaskuMaksutili: '1910',
      OletusMyyntitili: '3000',
      AlvVelkaTili: '2939',
      LaskuEnnakkosaatavat: '1715',
      LaskuEnnakkotili: '2861',
      LaskuEnnakkoALV: '29392',
      ...asetukset,
    },
  });

const rivi = (aNetto: number, extra: Partial<TositeRivi> = {}): TositeRivi => ({
  myyntiKpl: 1,
  aNetto,
  alvKoodi: AlvKoodi.MYYNNIT_NETTO,
  alvProsentti: 25.5,
  ...extra,
});

const asiakas = (s: Storage, nimi = 'Asiakas Oy') => s.saveKumppani({ nimi });

/** 1000 € + alv 25,5 % ennakkolasku. */
const ennakko = (s: Storage, kumppani: number, extra = {}) =>
  tallennaMyyntilasku(
    s,
    {
      pvm: '2026-03-01',
      erapvm: '2026-03-15',
      kumppani,
      maksutapa: Maksutapa.ENNAKKOLASKU,
      rivit: [rivi(1000)],
      ...extra,
    },
    env,
  );

/** Ennakon vähennysrivi loppulaskulle (`aNetto` = −vähennettävä netto). */
const vahennys = (ennakkoTosite: number, aNetto = -1000): TositeRivi =>
  rivi(aNetto, { tili: 2861, ennakkoTosite, selite: 'Ennakkolaskun 1 hyvitys' });

describe('ennakkolaskun kirjaus', () => {
  it('saatava 1715 (erä), saadut ennakot 2861 koodilla 51 ja alv 29392 koodilla 451', async () => {
    const s = seed();
    const k = await asiakas(s);
    const l = await ennakko(s, k.id);
    expect(l.maksutapa).toBe(Maksutapa.ENNAKKOLASKU);
    expect(l.viennit).toHaveLength(3);
    expect(l.viennit.find((v) => v.tili === 1715)).toMatchObject({
      debet: 125500,
      kredit: 0,
      tyyppi: VientiTyyppi.MYYNTI + VientiTyyppi.VASTAKIRJAUS,
      era: l.id,
    });
    expect(l.viennit.find((v) => v.tili === 2861)).toMatchObject({
      debet: 0,
      kredit: 100000,
      alvKoodi: AlvKoodi.ENNAKKOLASKU_MYYNTI,
      alvProsentti: 25.5,
    });
    expect(l.viennit.find((v) => v.tili === 29392)).toMatchObject({
      debet: 0,
      kredit: 25500,
      alvKoodi: 451,
      alvProsentti: 25.5,
    });
    expect(l.viennit.some((v) => v.tili === 2939 || v.tili === 3000)).toBe(false);
    expect(l.viennit.filter((v) => v.era != null)).toHaveLength(1);
  });

  it('rivin oma tuloutustili ohitetaan ja laskutusjakso ei tule vienneille', async () => {
    const s = seed();
    const k = await asiakas(s);
    const l = await ennakko(s, k.id, {
      rivit: [rivi(1000, { tili: 3000 })],
      jakso: { alkaa: '2026-04-01', loppuu: '2026-04-30' },
    });
    expect(l.viennit.some((v) => v.tili === 3000)).toBe(false);
    expect(l.viennit.find((v) => v.tili === 2861)?.kredit).toBe(100000);
    expect(l.viennit.some((v) => v.jaksoalkaa !== undefined || v.jaksoloppuu !== undefined)).toBe(
      false,
    );
  });

  it('maksuperusteinen alv ei koske ennakkolaskua: alv aina 29392:lle koodilla 451', async () => {
    const s = seed({ MaksuAlvAlkaa: '2026-01-01' });
    const k = await asiakas(s);
    const l = await ennakko(s, k.id);
    expect(l.viennit.find((v) => v.tili === 29392)?.alvKoodi).toBe(451);
    expect(l.viennit.find((v) => v.tili === 2861)?.alvKoodi).toBe(AlvKoodi.ENNAKKOLASKU_MYYNTI);
    expect(l.viennit.some((v) => v.tili === 2949 || v.alvKoodi === 418)).toBe(false);
  });

  it('ilman asiakasta -> EIKUMPPANIA', async () => {
    const s = seed();
    await expect(
      tallennaMyyntilasku(
        s,
        { pvm: '2026-03-01', maksutapa: Maksutapa.ENNAKKOLASKU, rivit: [rivi(1000)] },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EIKUMPPANIA' });
  });

  it.each(['LaskuEnnakkosaatavat', 'LaskuEnnakkotili', 'LaskuEnnakkoALV'])(
    'puuttuva %s -> EILASKUTILIA',
    async (avain) => {
      const s = seed({ [avain]: '' });
      const k = await asiakas(s);
      await expect(ennakko(s, k.id)).rejects.toMatchObject({ code: 'EILASKUTILIA' });
    },
  );

  it('ennakkolaskusta ei voi tehdä hyvityslaskua -> ENNAKKOLASKU', async () => {
    const s = seed();
    const k = await asiakas(s);
    const l = await ennakko(s, k.id);
    await expect(
      tallennaHyvityslasku(s, { alkuperainenTosite: l.id, pvm: '2026-03-05' }, env),
    ).rejects.toMatchObject({ code: 'ENNAKKOLASKU' });
  });
});

describe('ennakkolaskun alv tunnistetaan maksettaessa (451 -> 151)', () => {
  it('täysi maksu siirtää 29392:n veron alv-velkaan koodilla 151; alv-laskelma 301', async () => {
    const s = seed();
    const k = await asiakas(s);
    const l = await ennakko(s, k.id);
    const kausi = { alkupvm: '2026-03-01', loppupvm: '2026-03-31' };
    // Pelkkä ennakkolasku ei kerrytä maksettavaa veroa.
    expect((await haeAlvLaskelma(s, kausi)).koodit.get(301)).toBeUndefined();

    const maksu = await tallennaSuoritus(
      s,
      { tosite: l.id, pvm: '2026-03-10', summa: c(125500) },
      env,
    );
    expect(maksu.viennit.find((v) => v.tili === 29392)).toMatchObject({
      debet: 25500,
      kredit: 0,
      alvKoodi: TILITYS,
      alvProsentti: 25.5,
    });
    expect(maksu.viennit.find((v) => v.tili === 2939)).toMatchObject({
      debet: 0,
      kredit: 25500,
      alvKoodi: 151,
      alvProsentti: 25.5,
    });
    expect(maksu.viennit.find((v) => v.tili === 1715)).toMatchObject({ kredit: 125500, era: l.id });

    const laskelma = await haeAlvLaskelma(s, kausi);
    expect(laskelma.koodit.get(301)).toBe(25500);
    expect(laskelma.maksettava).toBe(25500);
  });

  it('puolikas maksu tunnistaa puolet verosta (12 750)', async () => {
    const s = seed();
    const k = await asiakas(s);
    const l = await ennakko(s, k.id);
    const maksu = await tallennaSuoritus(
      s,
      { tosite: l.id, pvm: '2026-03-10', summa: c(62750) },
      env,
    );
    expect(maksu.viennit.find((v) => v.tili === 29392)?.debet).toBe(12750);
    expect(maksu.viennit.find((v) => v.tili === 2939)?.kredit).toBe(12750);
    const loput = await tallennaSuoritus(
      s,
      { tosite: l.id, pvm: '2026-03-20', summa: c(62750) },
      env,
    );
    expect(loput.viennit.find((v) => v.tili === 2939)?.kredit).toBe(12750);
  });

  it('tunnistus toimii myös maksuperusteisessa kirjanpidossa', async () => {
    const s = seed({ MaksuAlvAlkaa: '2026-01-01' });
    const k = await asiakas(s);
    const l = await ennakko(s, k.id);
    const maksu = await tallennaSuoritus(
      s,
      { tosite: l.id, pvm: '2026-03-10', summa: c(125500) },
      env,
    );
    expect(maksu.viennit.find((v) => v.tili === 2939)).toMatchObject({
      kredit: 25500,
      alvKoodi: 151,
    });
  });

  it('suoritus kohdistuu ensin pääomaan: muistutuskulut eivät pienennä tunnistettavaa veroa', async () => {
    const s = seed();
    const k = await asiakas(s);
    const l = await ennakko(s, k.id);
    // Kirjattu muistutus: 5 € maksu ennakkolaskun erälle.
    await s.saveTosite(
      {
        pvm: '2026-03-20',
        tyyppi: TositeTyyppi.MAKSUMUISTUTUS,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        alkuperainenTosite: l.id,
        erapvm: '2026-04-03',
        muistutus: {
          maksu: c(500),
          korko: c(0),
          viivkorko: 0,
          korkoalkaa: '2026-03-16',
          korkoloppuu: '2026-03-20',
          aiempiSaldo: c(125500),
          aiemmat: [l.id],
        },
        viennit: [
          {
            tili: 1715,
            debet: c(500),
            kredit: c(0),
            pvm: '2026-03-20',
            alvKoodi: 0,
            alvProsentti: 0,
            era: l.id,
            tyyppi: VientiTyyppi.MYYNTI + VientiTyyppi.VASTAKIRJAUS,
          },
          {
            tili: 9170,
            debet: c(0),
            kredit: c(500),
            pvm: '2026-03-20',
            alvKoodi: 0,
            alvProsentti: 0,
            tyyppi: VientiTyyppi.MYYNTI + VientiTyyppi.KIRJAUS,
          },
        ],
      },
      env,
    );
    const maksu = await tallennaSuoritus(
      s,
      { tosite: l.id, pvm: '2026-03-25', summa: c(125500) },
      env,
    );
    expect(maksu.viennit.find((v) => v.tili === 2939)?.kredit).toBe(25500);
  });
});

describe('ennakon hyvitys loppulaskulla', () => {
  it('vähennysrivi on 2861:n debet ja pienentää alv:ta; saatava = netto − vähennys', async () => {
    const s = seed();
    const k = await asiakas(s);
    const e = await ennakko(s, k.id);
    const l = await tallennaMyyntilasku(
      s,
      {
        pvm: '2026-05-01',
        erapvm: '2026-05-15',
        kumppani: k.id,
        rivit: [rivi(2000), vahennys(e.id)],
      },
      env,
    );
    expect(l.viennit).toHaveLength(4);
    expect(l.viennit.find((v) => v.tili === 2861)).toMatchObject({
      debet: 100000,
      kredit: 0,
      alvKoodi: AlvKoodi.MYYNNIT_NETTO,
      alvProsentti: 25.5,
    });
    expect(l.viennit.find((v) => v.tili === 3000)).toMatchObject({ debet: 0, kredit: 200000 });
    expect(l.viennit.find((v) => v.tili === 2939)).toMatchObject({ kredit: 25500, alvKoodi: 111 });
    expect(l.viennit.find((v) => v.tili === 1701)).toMatchObject({ debet: 125500, era: l.id });
    const debet = l.viennit.reduce((a, v) => a + v.debet, 0);
    const kredit = l.viennit.reduce((a, v) => a + v.kredit, 0);
    expect(debet).toBe(kredit);

    // Listoilla loppulaskun summa = saatava = avoin (ei "osittain maksettu" ennen maksua), ja
    // ennakon + loppulaskun netto = todellinen myynti 2000 € (ei 3000 €).
    const tulot = await listaaTulot(s, {});
    const loppuRivi = tulot.find((r) => r.tosite === l.id);
    expect(loppuRivi).toMatchObject({ netto: 100000, alv: 25500, summa: 125500, avoin: 125500 });
    expect(tulot.find((r) => r.tosite === e.id)).toMatchObject({ netto: 100000, summa: 125500 });
    expect(tulot.reduce((a, r) => a + r.netto, 0)).toBe(200000);
    const laskut = await listaaMyyntilaskut(s, {});
    expect(laskut.find((r) => r.tosite === l.id)).toMatchObject({
      summa: 125500,
      avoin: 125500,
      tili: 1701,
      era: l.id,
    });
  });

  it('vähennys suurempi kuin lasku -> EISUMMAA eikä numeroa kuluteta', async () => {
    const s = seed();
    const k = await asiakas(s);
    const e = await ennakko(s, k.id);
    await expect(
      tallennaMyyntilasku(
        s,
        { pvm: '2026-05-01', kumppani: k.id, rivit: [rivi(500), vahennys(e.id)] },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EISUMMAA' });
    const seuraava = await tallennaMyyntilasku(
      s,
      { pvm: '2026-05-01', kumppani: k.id, rivit: [rivi(500)] },
      env,
    );
    expect(seuraava.numero).toBe('2');
  });

  it('vähennys yhtä suuri kuin lasku (saatava 0) -> EISUMMAA', async () => {
    const s = seed();
    const k = await asiakas(s);
    const e = await ennakko(s, k.id);
    await expect(
      tallennaMyyntilasku(
        s,
        { pvm: '2026-05-01', kumppani: k.id, rivit: [rivi(1000), vahennys(e.id)] },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EISUMMAA' });
  });
});

describe('haeAvoimetEnnakot', () => {
  it('avoin = netto − loppulaskujen vähennykset; täysin vähennetty ennakko poistuu', async () => {
    const s = seed();
    const k = await asiakas(s);
    const e = await ennakko(s, k.id);
    expect(await haeAvoimetEnnakot(s, k.id)).toEqual([
      { tosite: e.id, numero: '1', alvProsentti: 25.5, netto: 100000, avoin: 100000 },
    ]);

    await tallennaMyyntilasku(
      s,
      { pvm: '2026-05-01', kumppani: k.id, rivit: [rivi(2000), vahennys(e.id, -400)] },
      env,
    );
    expect(await haeAvoimetEnnakot(s, k.id)).toEqual([
      { tosite: e.id, numero: '1', alvProsentti: 25.5, netto: 100000, avoin: 60000 },
    ]);

    await tallennaMyyntilasku(
      s,
      { pvm: '2026-05-02', kumppani: k.id, rivit: [rivi(2000), vahennys(e.id, -600)] },
      env,
    );
    expect(await haeAvoimetEnnakot(s, k.id)).toEqual([]);
  });

  it('vain asiakkaan omat ennakot; luonnoksen vähennysrivi ei vähennä', async () => {
    const s = seed();
    const k = await asiakas(s);
    const toinen = await asiakas(s, 'Toinen Oy');
    const e = await ennakko(s, k.id);
    await tallennaMyyntilasku(
      s,
      { pvm: '2026-05-01', kumppani: k.id, luonnos: true, rivit: [rivi(2000), vahennys(e.id)] },
      env,
    );
    expect(await haeAvoimetEnnakot(s, toinen.id)).toEqual([]);
    expect((await haeAvoimetEnnakot(s, k.id))[0]?.avoin).toBe(100000);
  });

  it('kannoittain: kaksi verokantaa = kaksi riviä', async () => {
    const s = seed();
    const k = await asiakas(s);
    const e = await ennakko(s, k.id, { rivit: [rivi(1000), rivi(200, { alvProsentti: 14 })] });
    expect(await haeAvoimetEnnakot(s, k.id)).toEqual([
      { tosite: e.id, numero: '1', alvProsentti: 14, netto: 20000, avoin: 20000 },
      { tosite: e.id, numero: '1', alvProsentti: 25.5, netto: 100000, avoin: 100000 },
    ]);
  });

  it('loppulaskun hyvityslasku palauttaa vähennyksen avoimeksi', async () => {
    const s = seed();
    const k = await asiakas(s);
    const e = await ennakko(s, k.id);
    const loppu = await tallennaMyyntilasku(
      s,
      { pvm: '2026-05-01', kumppani: k.id, rivit: [rivi(2000), vahennys(e.id)] },
      env,
    );
    expect(await haeAvoimetEnnakot(s, k.id)).toEqual([]);
    await tallennaHyvityslasku(s, { alkuperainenTosite: loppu.id, pvm: '2026-05-10' }, env);
    expect((await haeAvoimetEnnakot(s, k.id))[0]?.avoin).toBe(100000);
  });

  it('tuotu Kitsas-ennakko (kaksi erällistä vientiä) jätetään pois', async () => {
    const s = seed();
    const k = await asiakas(s);
    const e = await ennakko(s, k.id);
    await s.saveTosite(
      {
        ...e,
        viennit: e.viennit.map((v) => (v.tili === 2861 ? { ...v, era: -12 } : v)),
      },
      env,
    );
    expect(await haeAvoimetEnnakot(s, k.id)).toEqual([]);
  });
});

describe('ennakkolasku listoilla ja muistutuksessa', () => {
  it('näkyy myyntilaskuissa ja tuloissa avoimena', async () => {
    const s = seed();
    const k = await asiakas(s);
    const e = await ennakko(s, k.id);
    const [m] = await listaaMyyntilaskut(s, {});
    expect(m).toMatchObject({
      tosite: e.id,
      tyyppi: TositeTyyppi.MYYNTILASKU,
      maksutapa: Maksutapa.ENNAKKOLASKU,
      summa: 125500,
      avoin: 125500,
      era: e.id,
      tili: 1715,
    });
    const tulot = await listaaTulot(s, {});
    expect(tulot).toHaveLength(1);
    expect(tulot[0]).toMatchObject({
      tosite: e.id,
      netto: 100000,
      alv: 25500,
      summa: 125500,
      avoin: 125500,
      era: e.id,
    });
  });

  it('erääntynyt ennakkolasku on muistutettava', async () => {
    const s = seed();
    const k = await asiakas(s);
    const e = await ennakko(s, k.id);
    expect(onMuistutettava(e, c(125500), '2026-04-01')).toBe(true);
    expect(onMuistutettava(e, c(125500), '2026-03-10')).toBe(false);
  });
});
