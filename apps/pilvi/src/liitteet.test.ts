import { env, runInDurableObject } from 'cloudflare:test';
import { bytesToBase64, decodeLiite, encodeLiite } from '@penni/contract';
import { describe, expect, it } from 'vitest';
import { pyynto, uusiKayttaja, uusiKirja } from './test/apu.js';

// Q4: liitteen tavut R2:een, SQLiteen vain metatieto. Koko ketju: HTTP (base64 + sha256) →
// Worker → Book DO (moottori) → storage-sqlite-core liitevarasto-saumalla → Miniflare-R2.

const SIEMEN = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Testi Oy' },
};
const TOSITE = {
  pvm: '2026-03-01',
  tyyppi: 0,
  sarja: '',
  tila: 100,
  viennit: [
    { tili: 1900, debet: '100.00', pvm: '2026-03-01' },
    { tili: 3000, kredit: '100.00', pvm: '2026-03-01' },
  ],
};
const LUOTU = '2026-06-01T10:00:00.000Z';
const MIB = 1024 * 1024;

/** Toistettava PDF:n näköinen hyötykuorma (otsikko + pseudosatunnaiset tavut, ei pakkautuva). */
function pdfKuorma(tavuja: number, siemen: number): Uint8Array {
  const data = new Uint8Array(tavuja);
  let x = siemen >>> 0 || 1;
  for (let i = 0; i < tavuja; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    data[i] = x & 0xff;
  }
  data.set(new TextEncoder().encode('%PDF-1.7\n'), 0);
  data.set(new TextEncoder().encode('\n%%EOF\n'), tavuja - 7);
  return data;
}

async function sha256Heksa(data: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function kirjaJaTosite(): Promise<{ token: string; kirjaId: string; tositeId: number }> {
  const { token } = await uusiKayttaja();
  const kirjaId = await uusiKirja(token, SIEMEN);
  const r = await pyynto('POST', `/api/kirjat/${kirjaId}/tositteet`, { token, runko: TOSITE });
  expect(r.status).toBe(201);
  return { token, kirjaId, tositeId: (r.body as { id: number }).id };
}

/** Kirjan DO:n SQLiten suurin yksittäinen rivi (kaikkien sarakkeiden tavujen summa, kaikki taulut). */
async function suurinRivi(kirjaId: string): Promise<{ taulu: string; tavua: number }> {
  const stub = env.KIRJA.get(env.KIRJA.idFromName(kirjaId));
  return runInDurableObject(stub, (_o, state) => {
    const sql = state.storage.sql;
    const taulut = sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
      )
      .toArray();
    let paras = { taulu: '', tavua: -1 };
    for (const { name } of taulut) {
      const sarakkeet = sql
        .exec<{ name: string }>('SELECT name FROM pragma_table_info(?)', name)
        .toArray()
        .map((c) => `COALESCE(length(CAST("${c.name}" AS BLOB)), 0)`);
      const rivi = sql
        .exec<{ n: number | null }>(`SELECT MAX(${sarakkeet.join(' + ')}) AS n FROM "${name}"`)
        .one();
      if ((rivi.n ?? 0) > paras.tavua) paras = { taulu: name, tavua: rivi.n ?? 0 };
    }
    return paras;
  });
}

describe('pilvi: liitteet R2:ssa (Q4)', () => {
  it('10 MiB PDF: tallennaLiite → metarivi SQLitessä → haeLiite tavulleen samana; suurin rivi < 2 MB', async () => {
    const { token, kirjaId, tositeId } = await kirjaJaTosite();
    const data = pdfKuorma(10 * MIB, 20261010);
    const sha = await sha256Heksa(data);

    const alku = performance.now();
    const lahetys = await pyynto('POST', `/api/kirjat/${kirjaId}/liitteet`, {
      token,
      runko: encodeLiite({
        tosite: tositeId,
        nimi: 'testi-oy-lasku.pdf',
        tyyppi: 'application/pdf',
        sha,
        luotu: LUOTU,
        data,
      }),
    });
    const lahetysMs = performance.now() - alku;
    expect(lahetys.status).toBe(200);
    const meta = lahetys.body as { id: number; sha: string; data?: unknown };
    expect(meta).toMatchObject({ tosite: tositeId, nimi: 'testi-oy-lasku.pdf', sha });
    expect(meta.data).toBeUndefined();

    // R2: täsmälleen yksi objekti odotetulla avaimella, tavut identtiset.
    const avain = `kirja/${kirjaId}/liite/${sha}`;
    const lista = await env.LIITTEET.list({ prefix: `kirja/${kirjaId}/` });
    expect(lista.objects.map((o) => o.key)).toEqual([avain]);
    expect(lista.objects[0]?.size).toBe(10 * MIB);

    // SQLite: metatieto + avain + koko, ei tavuja; kirjan suurin rivi selvästi alle DO:n 2 MB:n rajan.
    const stub = env.KIRJA.get(env.KIRJA.idFromName(kirjaId));
    const rivi = await runInDurableObject(stub, (_o, state) =>
      state.storage.sql
        .exec<{ data_n: number; varasto_avain: string; koko: number; sha: string }>(
          'SELECT length(data) AS data_n, varasto_avain, koko, sha FROM liite WHERE id = ?',
          meta.id,
        )
        .one(),
    );
    expect(rivi).toEqual({ data_n: 0, varasto_avain: avain, koko: 10 * MIB, sha });
    const suurin = await suurinRivi(kirjaId);
    expect(suurin.tavua).toBeLessThan(2 * MIB);
    console.log(
      `[Q4] 10 MiB liite: lähetys ${lahetysMs.toFixed(0)} ms; suurin SQLite-rivi ${suurin.tavua} B (${suurin.taulu})`,
    );

    // Lataus: base64 wire → tavulleen sama, sha täsmää.
    const luku0 = performance.now();
    const luku = await pyynto('GET', `/api/kirjat/${kirjaId}/liitteet/${meta.id}`, { token });
    const lukuMs = performance.now() - luku0;
    expect(luku.status).toBe(200);
    const haettu = decodeLiite(luku.body as Record<string, unknown>);
    expect(haettu.data.byteLength).toBe(10 * MIB);
    expect(await sha256Heksa(haettu.data)).toBe(sha);
    expect(bytesToBase64(haettu.data) === bytesToBase64(data)).toBe(true);
    console.log(`[Q4] 10 MiB liite: lataus ${lukuMs.toFixed(0)} ms`);

    // Metalista ei sisällä dataa.
    const lista2 = await pyynto('GET', `/api/kirjat/${kirjaId}/tositteet/${tositeId}/liitteet`, {
      token,
    });
    expect(lista2.body).toEqual([expect.objectContaining({ id: meta.id, sha })]);
    expect(JSON.stringify(lista2.body)).not.toContain('"data"');
  }, 120_000);

  it('agenttipolku (lisaaLiite) kulkee saman sauman läpi: 3 MiB menee R2:een, loki kirjautuu', async () => {
    const { token, kirjaId, tositeId } = await kirjaJaTosite();
    const data = pdfKuorma(3 * MIB, 7);
    const sha = await sha256Heksa(data);
    const r = await pyynto('POST', `/api/kirjat/${kirjaId}/tositteet/${tositeId}/liitteet`, {
      token,
      runko: encodeLiite({
        tosite: tositeId,
        nimi: 'agentti.pdf',
        tyyppi: 'application/pdf',
        sha,
        luotu: LUOTU,
        data,
      }),
    });
    expect(r.status).toBe(200);
    const id = (r.body as { id: number }).id;
    const objekti = await env.LIITTEET.get(`kirja/${kirjaId}/liite/${sha}`);
    expect(objekti?.size).toBe(3 * MIB);
    const luku = await pyynto('GET', `/api/kirjat/${kirjaId}/liitteet/${id}`, { token });
    expect(await sha256Heksa(decodeLiite(luku.body as Record<string, unknown>).data)).toBe(sha);
    expect((await suurinRivi(kirjaId)).tavua).toBeLessThan(2 * MIB);
  }, 60_000);

  it('sama sisältö kahdesti samaan kirjaan = yksi R2-objekti; kirjat eivät jaa objekteja', async () => {
    const a = await kirjaJaTosite();
    const b = await kirjaJaTosite();
    const data = pdfKuorma(64 * 1024, 99);
    const sha = await sha256Heksa(data);
    const laheta = (k: { token: string; kirjaId: string; tositeId: number }, nimi: string) =>
      pyynto('POST', `/api/kirjat/${k.kirjaId}/liitteet`, {
        token: k.token,
        runko: encodeLiite({
          tosite: k.tositeId,
          nimi,
          tyyppi: 'application/pdf',
          sha,
          luotu: LUOTU,
          data,
        }),
      });
    expect((await laheta(a, 'yksi.pdf')).status).toBe(200);
    expect((await laheta(a, 'kaksi.pdf')).status).toBe(200);
    expect((await laheta(b, 'kolme.pdf')).status).toBe(200);
    const objektitA = await env.LIITTEET.list({ prefix: `kirja/${a.kirjaId}/` });
    const objektitB = await env.LIITTEET.list({ prefix: `kirja/${b.kirjaId}/` });
    expect(objektitA.objects.map((o) => o.key)).toEqual([`kirja/${a.kirjaId}/liite/${sha}`]);
    expect(objektitB.objects.map((o) => o.key)).toEqual([`kirja/${b.kirjaId}/liite/${sha}`]);
  });

  it('poisto poistaa metarivin kuten ennen; R2-objektia ei poisteta (spike)', async () => {
    const { token, kirjaId, tositeId } = await kirjaJaTosite();
    const data = pdfKuorma(2048, 5);
    const sha = await sha256Heksa(data);
    const r = await pyynto('POST', `/api/kirjat/${kirjaId}/liitteet`, {
      token,
      runko: encodeLiite({
        tosite: tositeId,
        nimi: 'x.pdf',
        tyyppi: 'application/pdf',
        sha,
        luotu: LUOTU,
        data,
      }),
    });
    const id = (r.body as { id: number }).id;
    expect(
      (await pyynto('DELETE', `/api/kirjat/${kirjaId}/liitteet/${id}`, { token })).status,
    ).toBe(200);
    expect((await pyynto('GET', `/api/kirjat/${kirjaId}/liitteet/${id}`, { token })).status).toBe(
      404,
    );
    expect(await env.LIITTEET.head(`kirja/${kirjaId}/liite/${sha}`)).not.toBeNull();
  });
  it('TilitPaatetty ei pääse liitteen R2-siirron väliin: kirjan kutsut sarjallistuvat', async () => {
    // Hidas R2-put: liitteen lukkotarkistus on jo tehty, kun tavut ovat vielä matkalla. Ilman
    // sarjallistusta lukko ehtisi päälle ennen liiterivin kirjoitusta ja liite kirjautuisi
    // lukittuun kauteen (DO:n input gate aukeaa R2-odotuksessa).
    const { token, kirjaId, tositeId } = await kirjaJaTosite();
    const stub = env.KIRJA.get(env.KIRJA.idFromName(kirjaId));
    let lukkoKesken: boolean | undefined;
    let putAlkoi: () => void = () => {};
    const alkoi = new Promise<void>((r) => {
      putAlkoi = r;
    });
    await runInDurableObject(stub, (o) => {
      const bucket = (o as unknown as { env: { LIITTEET: R2Bucket } }).env.LIITTEET;
      const alkuperainen = bucket.put.bind(bucket);
      bucket.put = (async (...args: Parameters<R2Bucket['put']>) => {
        putAlkoi();
        await new Promise((r) => setTimeout(r, 300));
        lukkoKesken = (await o.kirja().getAsetukset()).TilitPaatetty !== undefined;
        return alkuperainen(...args);
      }) as R2Bucket['put'];
    });

    const data = pdfKuorma(4096, 3);
    const liite = pyynto('POST', `/api/kirjat/${kirjaId}/tositteet/${tositeId}/liitteet`, {
      token,
      runko: encodeLiite({
        tosite: tositeId,
        nimi: 'kesken.pdf',
        tyyppi: 'application/pdf',
        sha: await sha256Heksa(data),
        luotu: LUOTU,
        data,
      }),
    });
    await alkoi;
    const lukko = pyynto('PATCH', `/api/kirjat/${kirjaId}/asetukset`, {
      token,
      runko: { TilitPaatetty: '2026-12-31' },
    });
    const [liiteVastaus, lukkoVastaus] = await Promise.all([liite, lukko]);

    expect(lukkoVastaus.status).toBe(200);
    // Invariantti: lukko ei saa olla päällä liitteen kirjoitushetkellä, jos liite hyväksyttiin.
    expect(lukkoKesken).toBe(false);
    if (liiteVastaus.status === 200) {
      const loki = await pyynto('GET', `/api/kirjat/${kirjaId}/tositteet/${tositeId}/liitteet`, {
        token,
      });
      expect((loki.body as unknown[]).length).toBe(1);
    } else {
      expect(liiteVastaus.body).toMatchObject({ koodi: 'PVMLUKITTU' });
    }
    // Lukon jälkeen uusi liite kirjatulle tositteelle hylätään.
    const jalkeen = await pyynto('POST', `/api/kirjat/${kirjaId}/tositteet/${tositeId}/liitteet`, {
      token,
      runko: encodeLiite({
        tosite: tositeId,
        nimi: 'myohassa.pdf',
        tyyppi: 'application/pdf',
        luotu: LUOTU,
        data: pdfKuorma(64, 4),
      }),
    });
    expect(jalkeen.status).toBe(409);
    expect(jalkeen.body).toMatchObject({ koodi: 'PVMLUKITTU' });
  });
});
