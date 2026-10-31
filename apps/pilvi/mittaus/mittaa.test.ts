import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSIONS } from '@penni/storage-sqlite';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kehitysPyynto, luoClient, luoTyhjaKirja, rekisteroi } from './asiakas.js';
import { selvitaKirja, tallennaAvaten, testiTosite } from './kirjaTiedot.js';
import { type MittausAsetukset, OLETUS_ASETUKSET, mittaa, parsi } from './mittaa.js';
import type { Q2Tulos } from './q2.js';
import type { Q3Tulos } from './q3.js';
import { OLETUS_Q6, type Q6Tulos } from './q6.js';
import { luoSynteettinenKirja } from './synteettinen.js';
import { jakauma, persentiili } from './tilasto.js';
import { tuoKirja } from './tuonti.js';
import { type WranglerIstunto, cputimeMs, kaynnistaWrangler } from './wrangler.js';

// Koko mittausketju synteettistä kirjaa vasten (ei oikeaa dataa): oikea `wrangler dev` -prosessi,
// tuonti, Q2/Q3/Q6 ja tulostiedostot. Pienet määrät, jotta testi on nopea; p95-rajaa ei vaadita
// (kone- ja kuormariippuvainen), vain että luvut ovat olemassa ja järkeviä.

const tyo = mkdtempSync(join(tmpdir(), 'penni-mittaus-testi-'));
afterAll(() => rmSync(tyo, { recursive: true, force: true }));

describe('tilasto ja valitsimet', () => {
  it('persentiili on lähimmän sijan menetelmä', () => {
    const x = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(persentiili(x, 50)).toBe(50);
    expect(persentiili(x, 95)).toBe(95);
    expect(persentiili([5], 95)).toBe(5);
    expect(persentiili([], 50)).toBeNaN();
    expect(jakauma([1, 2, 3, 4]).keskiarvoMs).toBe(2.5);
  });

  it('cputimeMs lukee ps:n ajat', () => {
    expect(cputimeMs('0:00.91')).toBe(910);
    expect(cputimeMs('1:02:03.50')).toBe(3_723_500);
    expect(cputimeMs('1-00:00:01.00')).toBe(86_401_000);
  });

  it('parsi: -- ohitetaan, kirja tai synteettinen vaaditaan, virheelliset hylätään', () => {
    const a = parsi(['--', '--kirja', '/tmp/x.penni', '--vain', 'q2,q6', '--toistot', '7']);
    expect(a).not.toBe('apua');
    if (a === 'apua') return;
    expect(a.kirja).toBe('/tmp/x.penni');
    expect(a.vain).toEqual(['q2', 'q6']);
    expect(a.q2.toistot).toBe(7);
    expect(() => parsi([])).toThrow(/--kirja/);
    expect(() => parsi(['--synteettinen', '--vain', 'q9'])).toThrow(/--vain/);
    expect(() => parsi(['--synteettinen', '--toistot', '0'])).toThrow(/positiivista/);
    expect(parsi(['--apua'])).toBe('apua');
  });
});

describe('kirjan tuonti', () => {
  let wrangler: WranglerIstunto;
  beforeAll(async () => {
    wrangler = await kaynnistaWrangler({ persistHakemisto: join(tyo, 'tuonti-tila') });
  });
  afterAll(async () => {
    await wrangler?.pysayta();
  });

  it('tuo synteettisen kirjan rivit ja liitteet (R2) eikä muuta lähdetiedostoa', async () => {
    const tiedosto = join(tyo, 'lahde.penni');
    const gen = await luoSynteettinenKirja(tiedosto, {
      tositteita: 80,
      liitteita: 5,
      liiteKoko: [10_000, 30_000],
    });
    const sha = (): string => createHash('sha256').update(readFileSync(tiedosto)).digest('hex');
    const ennen = sha();
    const istunto = await rekisteroi(wrangler.pohja);
    const kirjaId = await luoTyhjaKirja(istunto);
    const tuonti = await tuoKirja(istunto, kirjaId, tiedosto);
    expect(tuonti.rivit).toMatchObject({ tosite: 80, liite: 5 });
    expect(tuonti.liiteTavut).toBe(gen.liiteTavut);
    expect(tuonti.skeemaEnnen).toBe(SCHEMA_VERSIONS.length);
    expect(sha()).toBe(ennen);

    // Kirja toimii HttpClientilla tuonnin jälkeen ja liitteen tavut tulevat R2:sta.
    const client = luoClient(istunto, kirjaId);
    const kaudet = await client.haeTilikaudet();
    expect(kaudet.map((k) => k.alkaa)).toEqual(['2025-01-01', '2026-01-01']);
    const tiedot = await selvitaKirja(client);
    expect(tiedot.kausi.alkaa).toBe('2026-01-01');
    const yhteenveto = await kehitysPyynto<{ rivit: Record<string, number>; kantaTavua: number }>(
      istunto,
      kirjaId,
      'GET',
      'yhteenveto',
    );
    expect(yhteenveto.rivit.tosite).toBe(80);
    const tositteet = await client.listaaTositteet({
      alkupvm: '2025-01-01',
      loppupvm: '2026-12-31',
    });
    expect(tositteet).toHaveLength(80);
    const liitteita = (await Promise.all(tositteet.map((t) => client.haeLiitteet(t.id)))).flat();
    expect(liitteita).toHaveLength(5);
    const liite = await client.haeLiite((liitteita[0] as { id: number }).id);
    expect(liite?.data.byteLength).toBeGreaterThan(9_999);
  });

  it('lukitun kauden tallennus avaa lukituksen mittauskopiossa (PVMLUKITTU → avaaTilikausi)', async () => {
    const tiedosto = join(tyo, 'lukittu.penni');
    await luoSynteettinenKirja(tiedosto, { tositteita: 20, liitteita: 0, liiteKoko: [1, 2] });
    const istunto = await rekisteroi(wrangler.pohja);
    const kirjaId = await luoTyhjaKirja(istunto);
    await tuoKirja(istunto, kirjaId, tiedosto);
    const client = luoClient(istunto, kirjaId);
    const tiedot = await selvitaKirja(client);
    await client.paataTilikausi('2025-01-01');
    await client.paataTilikausi(tiedot.kausi.alkaa);
    await expect(
      client.luoTosite(testiTosite(tiedot, tiedot.neljannes.loppupvm, 100)),
    ).rejects.toMatchObject({ code: 'PVMLUKITTU' });
    const r = await tallennaAvaten(
      client,
      tiedot,
      testiTosite(tiedot, tiedot.neljannes.loppupvm, 100),
    );
    expect(r.avasiLukituksen).toBe(true);
    expect(r.tosite.tunniste).toBeGreaterThan(0);
  });

  it('migroi vanhan skeemaversion temp-kopiossa ennen tuontia', async () => {
    const tiedosto = join(tyo, 'vanha.penni');
    const db = new Database(tiedosto);
    db.exec(
      'CREATE TABLE migraatio (versio INTEGER PRIMARY KEY NOT NULL, ajettu TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    for (let i = 0; i < 3; i++) {
      db.exec(SCHEMA_VERSIONS[i] as string);
      db.prepare('INSERT INTO migraatio (versio) VALUES (?)').run(i);
    }
    db.prepare(
      "INSERT INTO tosite (id, pvm, tila, tunniste, json) VALUES (1, '2025-03-01', 100, 1, ?)",
    ).run(
      JSON.stringify({
        id: 1,
        pvm: '2025-03-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [],
      }),
    );
    db.prepare(
      "INSERT INTO liite (tosite, nimi, tyyppi, luotu, data, json) VALUES (1, 'a.pdf', 'application/pdf', '2025-03-01T00:00:00.000Z', ?, '{}')",
    ).run(Buffer.from('%PDF-1.7 vanha'));
    db.close();
    const istunto = await rekisteroi(wrangler.pohja);
    const kirjaId = await luoTyhjaKirja(istunto);
    const tuonti = await tuoKirja(istunto, kirjaId, tiedosto);
    expect(tuonti.skeemaEnnen).toBe(3);
    expect(tuonti.skeemaJalkeen).toBe(SCHEMA_VERSIONS.length);
    expect(tuonti.rivit).toMatchObject({ tosite: 1, liite: 1 });
  });

  it('hylkää tiedoston, joka ei ole Penni-kirja', async () => {
    const tiedosto = join(tyo, 'muu.db');
    const db = new Database(tiedosto);
    db.exec('CREATE TABLE x (a)');
    db.close();
    const istunto = await rekisteroi(wrangler.pohja);
    const kirjaId = await luoTyhjaKirja(istunto);
    await expect(tuoKirja(istunto, kirjaId, tiedosto)).rejects.toThrow(/migraatio/);
  });
});

describe('mittaa: Q2 + Q3 + Q6 synteettistä kirjaa vasten', () => {
  const tulokset = join(tyo, 'tulokset');
  const asetukset: MittausAsetukset = {
    kirja: 'synteettinen',
    ...OLETUS_ASETUKSET,
    tulokset,
    q2: { toistot: 5, lamitys: 1 },
    q3Maara: 50,
    q6: {
      ...OLETUS_Q6,
      istunnot: 2,
      tositteita: 6,
      kuittiKoko: [20_000, 40_000],
      tiliotteita: 2,
      tapahtumiaTiliotteessa: 6,
    },
    synteettinen: { tositteita: 150, liitteita: 8, liiteKoko: [10_000, 40_000] },
    puhu: false,
  };

  it('tuottaa kaikki tulokset: numerointi 1…50, Q2-luvut ja täsmäävät Q6-laskurit', async () => {
    const t = await mittaa(asetukset);

    const q3 = t.q3 as Q3Tulos;
    expect(q3.lapaisee).toBe(true);
    for (const v of q3.vaiheet) {
      expect(v.onnistui).toBe(50);
      expect(v.kaksoiskappaleita).toBe(0);
      expect(v.aukkoja).toBe(0);
      expect(v.saadutNumerot).toEqual(Array.from({ length: 50 }, (_, i) => v.odotettuAlue[0] + i));
      expect(v.lokiRivejaKirjattu).toBe(50);
    }
    // Tyhjässä kirjassa numerot ovat täsmälleen 1…50 (kirjaus) ja 51…100 (viimeistely).
    const tyhja = q3.tyhjaKirja as Q3Tulos;
    expect(tyhja.vaiheet[0]?.saadutNumerot).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(tyhja.vaiheet[1]?.saadutNumerot).toEqual(Array.from({ length: 50 }, (_, i) => i + 51));

    const q2 = t.q2 as Q2Tulos;
    expect(Object.keys(q2.kutsut)).toEqual([
      'tositteet',
      'saldot',
      'alv',
      'raportti-tulos',
      'raportti-tase',
      'tositteen-tallennus',
    ]);
    for (const k of Object.values(q2.kutsut)) {
      expect(k.kutsu.n).toBe(5);
      expect(k.kutsu.p95Ms).toBeGreaterThan(0);
      expect(k.kutsu.p95Ms).toBeLessThan(5000);
      expect(k.ensimmainenKylmaMs).toBeGreaterThan(0);
      expect(k.doRowsReadPerKutsu).not.toBeNull();
    }
    expect(q2.kutsut.tositteet?.vastausRiveja).toBeGreaterThan(0);
    expect(q2.kutsut['tositteen-tallennus']?.doRowsWrittenPerKutsu).toBeGreaterThan(0);

    const q6 = t.q6 as Q6Tulos;
    const y = q6.yhteensa;
    expect(y.laskurit_tasmaavat).toBe(true);
    expect(y.workerPyyntoja).toBe(y.asiakasPyyntoja);
    expect(y.bookDoKutsuja).toBe(y.workerPyyntoja);
    // Jokainen pyyntö: haeSessio + haeKayttajaTiedot + onJasen.
    expect(y.controlDoKutsuja).toBe(3 * y.workerPyyntoja);
    // 2 istuntoa × (init + listaus) + 6 × (luo + avaa + liite) + alv + 2 raporttia + 2 × täsmäytys
    // (init, tositteet, kumppanit, saldot; täsmäytys voi lukea useammin, joten alaraja riittää).
    expect(y.workerPyyntoja).toBeGreaterThanOrEqual(2 * 2 + 6 * 3 + 3 + 2);
    expect(y.r2.put).toBe(6);
    expect(y.r2.putTavut).toBe(y.liitetavutYhteensa);
    expect(y.doSqlRowsWritten).toBeGreaterThan(0);
    expect(q6.vaiheet.map((v) => v.nimi)).toEqual([
      'selaus',
      'kirjaus-ja-kuitit',
      'alv-ja-raportit',
      'tasmaytys',
    ]);

    // Tulostiedostot: olemassa, JSON kelpaa eikä kirjan sisältöä (nimiä/otsikoita) ole mukana.
    const hakemisto = t.hakemisto;
    expect(readdirSync(hakemisto).sort()).toEqual([
      'q2.json',
      'q3.json',
      'q6.json',
      'yhteenveto.md',
      'ymparisto.json',
    ]);
    for (const nimi of readdirSync(hakemisto)) {
      const teksti = readFileSync(join(hakemisto, nimi), 'utf8');
      if (nimi.endsWith('.json')) JSON.parse(teksti);
      expect(teksti).not.toMatch(/Testi Oy|Synteettinen|kuitti-\d+\.pdf|Mittaus/);
    }
    const md = readFileSync(join(hakemisto, 'yhteenveto.md'), 'utf8');
    expect(md).toContain('## Q2');
    expect(md).toContain('Q3 yhteensä: LÄPI');
    expect(md).toContain('Pyynnöt Workerille');
  });

  it('--vain rajaa ajettavat kysymykset', async () => {
    const t = await mittaa({
      ...asetukset,
      vain: ['q3'],
      q3Maara: 5,
      synteettinen: { tositteita: 40, liitteita: 1, liiteKoko: [5_000, 6_000] },
    });
    expect(t.q2).toBeUndefined();
    expect(t.q6).toBeUndefined();
    expect((t.q3 as Q3Tulos).lapaisee).toBe(true);
  });
});
