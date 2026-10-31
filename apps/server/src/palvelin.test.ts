import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { luoPalvelin } from './palvelin.js';

const seed = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Oy Esimerkki' },
};

function app() {
  return luoPalvelin(createMemoryStorage(seed), { kello: () => '2026-06-01T00:00:00.000Z' });
}

const myyntiTosite = {
  pvm: '2026-03-01',
  tyyppi: 0,
  sarja: '',
  viennit: [
    { tili: 1900, debet: '100.00', pvm: '2026-03-01' },
    { tili: 3000, kredit: '100.00', pvm: '2026-03-01' },
  ],
};

describe('GET /init', () => {
  it('returns the bootstrap bundle', async () => {
    const app = luoPalvelin(createMemoryStorage(seed), { kello: () => '2026-06-01T00:00:00.000Z' });
    const res = await app.inject({ method: 'GET', url: '/init' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.asetukset.Nimi).toBe('Oy Esimerkki');
    expect(body.tilit).toHaveLength(2);
    expect(body.tilikaudet).toHaveLength(1);
    expect(body.kierrot).toEqual([]);
    await app.close();
  });
});

describe('voucher lifecycle over HTTP', () => {
  it('PUT ilman tunnistetta säilyttää kirjatun tositteen numeron (ei aukkoa numerointiin)', async () => {
    const a = app();
    const eka = (
      await a.inject({ method: 'POST', url: '/tositteet', payload: myyntiTosite })
    ).json() as {
      id: number;
      tunniste: number;
    };
    await a.inject({ method: 'POST', url: '/tositteet', payload: myyntiTosite });
    const put = await a.inject({
      method: 'PUT',
      url: `/tositteet/${eka.id}`,
      payload: { ...myyntiTosite, tila: 100, otsikko: 'muokattu' },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { tunniste: number }).tunniste).toBe(eka.tunniste);
    await a.close();
  });

  it('POST creates (201) with money as "N.NN" strings; GET reads it back', async () => {
    const a = app();
    const post = await a.inject({ method: 'POST', url: '/tositteet', payload: myyntiTosite });
    expect(post.statusCode).toBe(201);
    const created = post.json() as {
      id: number;
      tunniste: number;
      viennit: { debet?: string; kredit?: string }[];
    };
    expect(created.id).toBeGreaterThan(0);
    expect(created.tunniste).toBe(1); // gapless numbering assigned
    expect(created.viennit[0]?.debet).toBe('100.00'); // integer cents -> "N.NN"

    const get = await a.inject({ method: 'GET', url: `/tositteet/${created.id}` });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { id: number }).id).toBe(created.id);
    await a.close();
  });

  it('GET /tositteet lists finalized vouchers; DELETE removes it (200, null) into the poistetut bucket', async () => {
    const a = app();
    const created = (
      await a.inject({ method: 'POST', url: '/tositteet', payload: myyntiTosite })
    ).json() as { id: number };
    expect((await a.inject({ method: 'GET', url: '/tositteet' })).json()).toHaveLength(1);

    const del = await a.inject({ method: 'DELETE', url: `/tositteet/${created.id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toBeNull();
    expect((await a.inject({ method: 'GET', url: '/tositteet' })).json()).toHaveLength(0);
    expect(
      (await a.inject({ method: 'GET', url: '/tositteet?bucket=poistetut' })).json(),
    ).toHaveLength(1);
    await a.close();
  });

  it('PATCH /tositteet/:id finalizes a draft (200, null) and assigns a tunniste', async () => {
    const a = app();
    const luonnos = {
      pvm: '2026-03-01',
      tyyppi: 0,
      tila: 50, // LUONNOS
      sarja: '',
      viennit: [
        { tili: 1900, debet: '100.00', pvm: '2026-03-01' },
        { tili: 3000, kredit: '100.00', pvm: '2026-03-01' },
      ],
    };
    const created = (
      await a.inject({ method: 'POST', url: '/tositteet', payload: luonnos })
    ).json() as { id: number; tunniste?: number };
    // A draft is absent from the default (finalized) list, present in ?bucket=luonnos.
    expect((await a.inject({ method: 'GET', url: '/tositteet' })).json()).toHaveLength(0);
    expect(
      (await a.inject({ method: 'GET', url: '/tositteet?bucket=luonnos' })).json(),
    ).toHaveLength(1);

    const patch = await a.inject({
      method: 'PATCH',
      url: `/tositteet/${created.id}`,
      payload: { tila: 100 }, // KIRJANPIDOSSA
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toBeNull();

    // The state change took effect: now in the default (finalized) list with a tunniste assigned.
    const lista = (await a.inject({ method: 'GET', url: '/tositteet' })).json() as {
      id: number;
      tunniste: number;
    }[];
    expect(lista).toHaveLength(1);
    expect(lista[0]?.id).toBe(created.id);
    expect(lista[0]?.tunniste).toBe(1); // gapless numbering assigned on finalize
    await a.close();
  });

  it('GET /tositteet/:id returns 404 for a missing voucher', async () => {
    const a = app();
    const res = await a.inject({ method: 'GET', url: '/tositteet/9999' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { virhe: string }).virhe).toContain('9999');
    await a.close();
  });

  it('DELETE of a missing voucher maps EITOSITETTA -> 404', async () => {
    const a = app();
    expect((await a.inject({ method: 'DELETE', url: '/tositteet/9999' })).statusCode).toBe(404);
    await a.close();
  });

  it('an unbalanced finalized voucher maps EIVALMISTU -> 422', async () => {
    const a = app();
    const res = await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2026-03-01',
        tyyppi: 0,
        sarja: '',
        viennit: [{ tili: 1900, debet: '100.00', pvm: '2026-03-01' }],
      },
    });
    expect(res.statusCode).toBe(422);
    await a.close();
  });

  it('rejects a malformed request body with 400, not 500', async () => {
    // ts-rest's plugin runs the route's zod body schema; a schema-invalid body must surface as a
    // 4xx (composed with our setErrorHandler), never a 500. Guards against a silent regression on
    // a future ts-rest upgrade. Here `viennit` is a string where WireTositeSyoteSchema wants an array.
    const a = app();
    const res = await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: { pvm: '2026-03-01', viennit: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
    await a.close();
  });
});

describe('saldot + viennit over HTTP', () => {
  it('GET /saldot returns account -> "N.NN" after a posting', async () => {
    const a = app();
    await a.inject({ method: 'POST', url: '/tositteet', payload: myyntiTosite });
    const res = await a.inject({ method: 'GET', url: '/saldot?pvm=2026-12-31' });
    expect(res.statusCode).toBe(200);
    const saldot = res.json() as Record<string, string>;
    expect(saldot['1900']).toBe('100.00'); // asset, debit-positive, money string
    await a.close();
  });

  it('GET /viennit lists posted entries', async () => {
    const a = app();
    await a.inject({ method: 'POST', url: '/tositteet', payload: myyntiTosite });
    expect((await a.inject({ method: 'GET', url: '/viennit' })).json()).toHaveLength(2);
    await a.close();
  });
});

describe('master data over HTTP', () => {
  it('PUT /tilit then GET /init reflects it; PATCH /asetukset with null deletes', async () => {
    const a = app();
    const put = await a.inject({
      method: 'PUT',
      url: '/tilit/4000',
      payload: { numero: 4000, tyyppi: 'D', nimi: { fi: 'Kulut' } },
    });
    expect(put.statusCode).toBe(200);
    const init = (await a.inject({ method: 'GET', url: '/init' })).json() as {
      tilit: { numero: number | string }[];
    };
    expect(init.tilit.some((t) => Number(t.numero) === 4000)).toBe(true);

    await a.inject({ method: 'PATCH', url: '/asetukset', payload: { Nimi: null } });
    expect((await a.inject({ method: 'GET', url: '/asetukset' })).json()).not.toHaveProperty(
      'Nimi',
    );
    await a.close();
  });

  it('PUT/DELETE /tilikaudet works', async () => {
    const a = app();
    await a.inject({
      method: 'PUT',
      url: '/tilikaudet/2027-01-01',
      payload: { alkaa: '2027-01-01', loppuu: '2027-12-31' },
    });
    expect((await a.inject({ method: 'GET', url: '/tilikaudet' })).json()).toHaveLength(2);
    await a.inject({ method: 'DELETE', url: '/tilikaudet/2027-01-01' });
    expect((await a.inject({ method: 'GET', url: '/tilikaudet' })).json()).toHaveLength(1);
    await a.close();
  });

  it('PUT /tilit/:numero/:taso stores a heading (tyyppi "H<taso>"); DELETE removes it', async () => {
    const a = app();
    const put = await a.inject({
      method: 'PUT',
      url: '/tilit/1/1',
      payload: { numero: 1, nimi: { fi: 'VASTAAVAA' } },
    });
    expect(put.statusCode).toBe(200);
    const init = (await a.inject({ method: 'GET', url: '/init' })).json() as {
      tilit: { numero: number | string; tyyppi: string }[];
    };
    const otsikko = init.tilit.find((t) => Number(t.numero) === 1);
    expect(otsikko?.tyyppi).toBe('H1'); // :taso encoded into tyyppi

    const del = await a.inject({ method: 'DELETE', url: '/tilit/1/1' });
    expect(del.statusCode).toBe(200);
    const tilit = (
      (await a.inject({ method: 'GET', url: '/init' })).json() as {
        tilit: { numero: number | string }[];
      }
    ).tilit;
    expect(tilit.some((t) => Number(t.numero) === 1)).toBe(false);
    await a.close();
  });
});

describe('GET /raportit', () => {
  const LAYOUT = JSON.stringify({
    nimi: { fi: 'Tuloslaskelma' },
    rivit: [{ fi: 'Liikevaihto', L: '3' }],
  });

  it('palauttaa renderöidyt rivit (arvo "N.NN")', async () => {
    const a = luoPalvelin(
      createMemoryStorage({
        tilit: [
          { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
          { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
          { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tulos' } },
        ],
        tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
        asetukset: { 'tulos/yleinen': LAYOUT },
      }),
      { kello: () => '2026-06-01T00:00:00.000Z' },
    );
    // post a balanced voucher: debet 1900 / kredit 3000 = 100,00
    await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2026-02-01',
        tyyppi: 200,
        tila: 100,
        sarja: '',
        viennit: [
          { tili: 1900, debet: '100.00', kredit: '0.00', pvm: '2026-02-01' },
          { tili: 3000, debet: '0.00', kredit: '100.00', pvm: '2026-02-01' },
        ],
      },
    });
    const r = await a.inject({
      method: 'GET',
      url: '/raportit?muoto=tulos/yleinen&pvm=2026-12-31&alkupvm=2026-01-01',
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { rivit: { teksti: string; arvo: string | null }[] };
    const liikevaihto = body.rivit.find((x) => x.teksti === 'Liikevaihto');
    expect(liikevaihto?.arvo).toBe('100.00');
    await a.close();
  });

  it('erittelyt=true lisää *-rivin alle tilirivit (tili-kenttä)', async () => {
    const a = luoPalvelin(
      createMemoryStorage({
        tilit: [
          { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
          { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
        ],
        tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
        asetukset: {
          'tulos/yleinen': JSON.stringify({ rivit: [{ fi: 'Liikevaihto', L: '3 *' }] }),
        },
      }),
      { kello: () => '2026-06-01T00:00:00.000Z' },
    );
    await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2026-02-01',
        tyyppi: 200,
        tila: 100,
        sarja: '',
        viennit: [
          { tili: 1900, debet: '100.00', kredit: '0.00', pvm: '2026-02-01' },
          { tili: 3000, debet: '0.00', kredit: '100.00', pvm: '2026-02-01' },
        ],
      },
    });
    const url = '/raportit?muoto=tulos/yleinen&pvm=2026-12-31&alkupvm=2026-01-01';
    const ilman = await a.inject({ method: 'GET', url });
    expect((ilman.json() as { rivit: unknown[] }).rivit).toHaveLength(1);
    const r = await a.inject({ method: 'GET', url: `${url}&erittelyt=true` });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { rivit: unknown[] }).rivit[1]).toEqual({
      teksti: '3000 Myynti',
      sisennys: 1,
      lihava: false,
      arvo: '100.00',
      tili: 3000,
      kaavarivi: 0,
    });
    await a.close();
  });

  it('vastaa 404 kun raporttilayoutia ei ole', async () => {
    const a = luoPalvelin(createMemoryStorage({ asetukset: {} }), {
      kello: () => '2026-06-01T00:00:00.000Z',
    });
    const r = await a.inject({ method: 'GET', url: '/raportit?muoto=tase/yleinen&pvm=2026-12-31' });
    expect(r.statusCode).toBe(404);
    await a.close();
  });
});

describe('POST /myyntilaskut', () => {
  it('posts a balanced, numbered sales invoice with generated viennit', async () => {
    const a = luoPalvelin(
      createMemoryStorage({
        tilit: [
          { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
          { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
          { numero: 2939, tyyppi: 'CV', nimi: { fi: 'Suoritettava alv' } },
        ],
        tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
        asetukset: {
          AlvVelvollinen: 'true',
          LaskuSaatavaTili: '1701',
          OletusMyyntitili: '3000',
          AlvVelkaTili: '2939',
        },
      }),
      { kello: () => '2026-06-01T00:00:00.000Z' },
    );
    const res = await a.inject({
      method: 'POST',
      url: '/myyntilaskut',
      payload: {
        pvm: '2026-06-01',
        rivit: [{ myyntikpl: 1, ahinta: 100, alvkoodi: 11, alvprosentti: 25.5 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      numero?: string;
      tunniste: number;
      viennit: { tili: number; debet?: string; kredit?: string }[];
    };
    expect(body.numero).toBe('1');
    expect(body.tunniste).toBe(1);
    expect(body.viennit.find((v) => v.tili === 1701)?.debet).toBe('125.50');
    expect(body.viennit.find((v) => v.tili === 3000)?.kredit).toBe('100.00');
    expect(body.viennit.find((v) => v.tili === 2939)?.kredit).toBe('25.50');
    await a.close();
  });
});

describe('myyntilaskut list + suoritus over HTTP', () => {
  it('lists invoices with avoin and settles one via POST /suoritukset', async () => {
    const a = app();
    // Seed AR + VAT accounts + settings (1900/3000 are already in the base seed).
    await a.inject({
      method: 'PATCH',
      url: '/asetukset',
      payload: {
        AlvVelvollinen: 'true',
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
        LaskuMaksutili: '1900',
      },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/1701',
      payload: { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/2939',
      payload: { numero: 2939, tyyppi: 'CV', nimi: { fi: 'Suoritettava alv' } },
    });

    const luonti = await a.inject({
      method: 'POST',
      url: '/myyntilaskut',
      payload: {
        pvm: '2026-06-01',
        rivit: [{ myyntikpl: 1, ahinta: 100, alvkoodi: 11, alvprosentti: 25.5 }],
      },
    });
    expect(luonti.statusCode).toBe(201);
    const laskuId = luonti.json().id as number;

    const lista = await a.inject({ method: 'GET', url: '/myyntilaskut' });
    expect(lista.statusCode).toBe(200);
    const rivit = lista.json() as Array<{ tosite: number; summa: string; avoin: string }>;
    expect(rivit).toHaveLength(1);
    expect(rivit[0]?.summa).toBe('125.50');
    expect(rivit[0]?.avoin).toBe('125.50');

    const maksu = await a.inject({
      method: 'POST',
      url: '/suoritukset',
      payload: { tosite: laskuId, pvm: '2026-06-15', summa: '125.50' },
    });
    expect(maksu.statusCode).toBe(201);

    const lista2 = await a.inject({ method: 'GET', url: '/myyntilaskut' });
    const rivit2 = lista2.json() as Array<{ avoin: string }>;
    expect(rivit2[0]?.avoin).toBe('0.00');
    await a.close();
  });
});

describe('ALV-laskelma ja tilitys HTTP:n yli', () => {
  const alvSeed = {
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Arvonlisäverosaatava' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
      { numero: 2940, tyyppi: 'BV', nimi: { fi: 'Verovelka' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: { AlvVelvollinen: 'true' },
  };
  const alvApp = () =>
    luoPalvelin(createMemoryStorage(alvSeed), { kello: () => '2026-06-01T00:00:00.000Z' });

  const alvMyynti = {
    pvm: '2026-06-05',
    tyyppi: 0,
    sarja: '',
    viennit: [
      { tili: 1900, debet: '125.50', pvm: '2026-06-05' },
      { tili: 3000, kredit: '100.00', pvm: '2026-06-05', alvkoodi: 11, alvprosentti: '25.50' },
      { tili: 2939, kredit: '25.50', pvm: '2026-06-05', alvkoodi: 111, alvprosentti: '25.50' },
    ],
  };

  it('GET /alv palauttaa koodit ja maksettavan "N.NN"-rahoina', async () => {
    const a = alvApp();
    await a.inject({ method: 'POST', url: '/tositteet', payload: alvMyynti });
    const res = await a.inject({
      method: 'GET',
      url: '/alv?alkupvm=2026-06-01&loppupvm=2026-06-30',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { koodit: Record<string, string>; maksettava: string };
    expect(body.koodit['301']).toBe('25.50');
    expect(body.koodit['308']).toBe('25.50');
    expect(body.maksettava).toBe('25.50');
    await a.close();
  });

  it('POST /alv/tilitys kirjaa ALVLASKELMA-tositteen (201) ja toinen yritys hylätään (400)', async () => {
    const a = alvApp();
    await a.inject({ method: 'POST', url: '/tositteet', payload: alvMyynti });
    const kausi = { alkupvm: '2026-06-01', loppupvm: '2026-06-30' };
    const post = await a.inject({ method: 'POST', url: '/alv/tilitys', payload: kausi });
    expect(post.statusCode).toBe(201);
    const tosite = post.json() as {
      tyyppi: number;
      viennit: { debet?: string; kredit?: string }[];
    };
    expect(tosite.tyyppi).toBe(9100);
    expect(tosite.viennit.find((v) => v.debet === '25.50')).toBeTruthy();

    const uudestaan = await a.inject({ method: 'POST', url: '/alv/tilitys', payload: kausi });
    expect(uudestaan.statusCode).toBe(400); // JOILMOITETTU
    expect((uudestaan.json() as { koodi?: string }).koodi).toBe('JOILMOITETTU');
    await a.close();
  });

  it('POST /alv/tilitys tyhjälle kaudelle -> 400 (EITILITYSTA)', async () => {
    const a = alvApp();
    const res = await a.inject({
      method: 'POST',
      url: '/alv/tilitys',
      payload: { alkupvm: '2026-06-01', loppupvm: '2026-06-30' },
    });
    expect(res.statusCode).toBe(400);
    await a.close();
  });
});

describe('tilikauden lukitus ja tilinavaus HTTP:n yli', () => {
  const lukitusSeed = {
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Oma pääoma' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    ],
    tilikaudet: [
      { alkaa: '2025-01-01', loppuu: '2025-12-31' },
      { alkaa: '2026-01-01', loppuu: '2026-12-31' },
    ],
    asetukset: {},
  };
  const lukitusApp = () =>
    luoPalvelin(createMemoryStorage(lukitusSeed), { kello: () => '2026-06-01T00:00:00.000Z' });

  it('POST /tilikaudet/:alkaa/lukitus lukitsee ja estää kirjauksen (409)', async () => {
    const a = lukitusApp();
    const lock = await a.inject({
      method: 'POST',
      url: '/tilikaudet/2025-01-01/lukitus',
      payload: {},
    });
    expect(lock.statusCode).toBe(200);
    const asetukset = await a.inject({ method: 'GET', url: '/asetukset' });
    expect((asetukset.json() as { TilitPaatetty?: string }).TilitPaatetty).toBe('2025-12-31');
    const kirjaus = await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2025-06-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          { tili: 1900, debet: '100.00', pvm: '2025-06-01' },
          { tili: 3000, kredit: '100.00', pvm: '2025-06-01' },
        ],
      },
    });
    expect(kirjaus.statusCode).toBe(409); // PVMLUKITTU
    await a.close();
  });

  it('DELETE /tilikaudet/:alkaa/lukitus avaa ja kirjaus onnistuu taas (201)', async () => {
    const a = lukitusApp();
    await a.inject({ method: 'POST', url: '/tilikaudet/2025-01-01/lukitus', payload: {} });
    const open = await a.inject({ method: 'DELETE', url: '/tilikaudet/2025-01-01/lukitus' });
    expect(open.statusCode).toBe(200);
    const kirjaus = await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2025-06-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          { tili: 1900, debet: '100.00', pvm: '2025-06-01' },
          { tili: 3000, kredit: '100.00', pvm: '2025-06-01' },
        ],
      },
    });
    expect(kirjaus.statusCode).toBe(201);
    await a.close();
  });

  it('lukitus väärässä järjestyksessä -> 400 (EDELLINENAUKI)', async () => {
    const a = lukitusApp();
    const res = await a.inject({
      method: 'POST',
      url: '/tilikaudet/2026-01-01/lukitus',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await a.close();
  });

  it('POST /tilinavaus kirjaa TILINAVAUS-tositteen (201) rahat "N.NN"', async () => {
    const a = lukitusApp();
    const res = await a.inject({
      method: 'POST',
      url: '/tilinavaus',
      payload: {
        pvm: '2025-01-01',
        saldot: [
          { tili: 1900, saldo: '150.00' },
          { tili: 2251, saldo: '150.00' },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const t = res.json() as {
      tyyppi: number;
      viennit: { tili: number; debet?: string; kredit?: string }[];
    };
    expect(t.tyyppi).toBe(9010);
    expect(t.viennit.find((v) => v.tili === 1900)?.debet).toBe('150.00');
    expect(t.viennit.find((v) => v.tili === 2251)?.kredit).toBe('150.00');
    await a.close();
  });
});

describe('alv-ilmoitus ja yhteisömyynti HTTP:n yli', () => {
  const ilmoitusSeed = {
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: { AlvVelvollinen: 'true' },
  };
  const ilmoitusApp = () =>
    luoPalvelin(createMemoryStorage(ilmoitusSeed), { kello: () => '2026-06-01T00:00:00.000Z' });

  it('GET /alv/ilmoitus palauttaa koodit, kausityypin ja nolla-merkinnän', async () => {
    const a = ilmoitusApp();
    await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2026-06-05',
        tyyppi: 0,
        sarja: '',
        viennit: [
          { tili: 1900, debet: '125.50', pvm: '2026-06-05' },
          { tili: 3000, kredit: '100.00', pvm: '2026-06-05', alvkoodi: 11, alvprosentti: '25.50' },
          { tili: 2939, kredit: '25.50', pvm: '2026-06-05', alvkoodi: 111, alvprosentti: '25.50' },
        ],
      },
    });
    const res = await a.inject({
      method: 'GET',
      url: '/alv/ilmoitus?alkupvm=2026-06-01&loppupvm=2026-06-30',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      koodit: Record<string, string>;
      kausityyppi: string;
      nolla: boolean;
    };
    expect(body.koodit['301']).toBe('25.50');
    expect(body.kausityyppi).toBe('K');
    expect(body.nolla).toBe(false);
    await a.close();
  });

  it('GET /alv/eumyynti erittelee asiakkaan ja merkitsee puuttuvan tunnuksen', async () => {
    const a = ilmoitusApp();
    const asiakas = await a.inject({
      method: 'POST',
      url: '/kumppanit',
      payload: { nimi: 'EU Ostaja Oy' }, // ei alv-tunnusta
    });
    const asiakasId = (asiakas.json() as { id: number }).id;
    await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2026-06-10',
        tyyppi: 0,
        sarja: '',
        kumppani: { id: asiakasId },
        viennit: [
          { tili: 1900, debet: '80.00', pvm: '2026-06-10' },
          { tili: 3000, kredit: '80.00', pvm: '2026-06-10', alvkoodi: 14 },
        ],
      },
    });
    const res = await a.inject({
      method: 'GET',
      url: '/alv/eumyynti?alkupvm=2026-06-01&loppupvm=2026-06-30',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rivit: { tavara: string }[]; puuttuviaTunnuksia: boolean };
    expect(body.rivit).toHaveLength(1);
    expect(body.rivit[0]?.tavara).toBe('80.00');
    expect(body.puuttuviaTunnuksia).toBe(true);
    await a.close();
  });
});

describe('tulovero HTTP:n yli', () => {
  it('GET /tulovero laskee ja POST /tulovero kirjaa jaksotustositteen', async () => {
    const a = app();
    for (const [numero, tyyppi, nimi] of [
      [5000, 'DH', 'Edustus'],
      [1770, 'DVE', 'Ennakkoverot'],
      [9940, 'DZ', 'Verojaksotus'],
      [2968, 'B', 'Siirtovelat'],
    ] as const) {
      await a.inject({
        method: 'PUT',
        url: `/tilit/${numero}`,
        payload: { numero, tyyppi, nimi: { fi: nimi } },
      });
    }
    // Tulo 50 000 (1900 debet / 3000 kredit).
    await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2026-03-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          { tili: 1900, debet: '500.00', kredit: '0.00', pvm: '2026-03-01' },
          { tili: 3000, debet: '0.00', kredit: '500.00', pvm: '2026-03-01' },
        ],
      },
    });

    const laskelma = await a.inject({
      method: 'GET',
      url: '/tulovero?alkupvm=2026-01-01&loppupvm=2026-12-31',
    });
    expect(laskelma.statusCode).toBe(200);
    expect((laskelma.json() as { vero: string }).vero).toBe('100.00'); // 50000/5 = 10000 snt

    const kirjaus = await a.inject({
      method: 'POST',
      url: '/tulovero',
      payload: { alkupvm: '2026-01-01', loppupvm: '2026-12-31' },
    });
    expect([200, 201]).toContain(kirjaus.statusCode);
    const tosite = kirjaus.json() as {
      tyyppi: number;
      viennit: { tili: number; debet?: string }[];
    };
    expect(tosite.tyyppi).toBe(9930);
    const vienti9940 = tosite.viennit.find((v) => v.tili === 9940);
    expect(vienti9940?.debet).toBe('100.00');
    await a.close();
  });
});

describe('poistot HTTP:n yli', () => {
  it('GET /poistot laskee ja POST /poistot kirjaa POISTOLASKELMAn', async () => {
    const a = app();
    await a.inject({
      method: 'PUT',
      url: '/tilit/1120',
      payload: {
        numero: 1120,
        tyyppi: 'APM',
        nimi: { fi: 'Koneet' },
        menojaannospoisto: 25,
        poistotili: 6820,
      },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/6820',
      payload: { numero: 6820, tyyppi: 'DP', nimi: { fi: 'Poistot' } },
    });
    // Hankinta 100 000 (1120 debet / 1900 kredit).
    await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2026-03-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          { tili: 1120, debet: '1000.00', kredit: '0.00', pvm: '2026-03-01' },
          { tili: 1900, debet: '0.00', kredit: '1000.00', pvm: '2026-03-01' },
        ],
      },
    });

    const laskelma = await a.inject({ method: 'GET', url: '/poistot?loppupvm=2026-12-31' });
    expect(laskelma.statusCode).toBe(200);
    expect((laskelma.json() as { yhteensa: string }).yhteensa).toBe('250.00'); // 25 % * 100000 snt = 25000 snt

    const kirjaus = await a.inject({
      method: 'POST',
      url: '/poistot',
      payload: { loppupvm: '2026-12-31' },
    });
    expect([200, 201]).toContain(kirjaus.statusCode);
    const tosite = kirjaus.json() as {
      tyyppi: number;
      viennit: { tili: number; kredit?: string }[];
    };
    expect(tosite.tyyppi).toBe(9910);
    expect(tosite.viennit.find((v) => v.tili === 1120)?.kredit).toBe('250.00');
    await a.close();
  });
});

describe('jaksotukset HTTP:n yli', () => {
  it('GET /jaksotukset laskee ja POST /jaksotukset kirjaa päätös- ja purkutositteen', async () => {
    const a = app();
    await a.inject({
      method: 'PUT',
      url: '/tilikaudet/2027-01-01',
      payload: { alkaa: '2027-01-01', loppuu: '2027-12-31' },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/1774',
      payload: { numero: 1774, tyyppi: 'AJ', nimi: { fi: 'Siirtosaamiset' } },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/2925',
      payload: { numero: 2925, tyyppi: 'BJ', nimi: { fi: 'Siirtovelat' } },
    });
    // Etukäteen maksettu kulu, jakso 2026-11-01..2027-10-31.
    await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2026-11-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 3000,
            debet: '365.00',
            kredit: '0.00',
            pvm: '2026-11-01',
            jaksoalkaa: '2026-11-01',
            jaksoloppuu: '2027-10-31',
          },
          { tili: 1900, debet: '0.00', kredit: '365.00', pvm: '2026-11-01' },
        ],
      },
    });

    const laskelma = await a.inject({ method: 'GET', url: '/jaksotukset?loppupvm=2026-12-31' });
    expect(laskelma.statusCode).toBe(200);
    expect(JSON.parse(laskelma.body).rivit.length).toBe(1);

    const kirjaus = await a.inject({
      method: 'POST',
      url: '/jaksotukset',
      payload: { loppupvm: '2026-12-31' },
    });
    expect([200, 201]).toContain(kirjaus.statusCode);
    expect(JSON.parse(kirjaus.body).tyyppi).toBe(9920);
    await a.close();
  });
});

describe('ostolaskut over HTTP', () => {
  it('POST /ostolaskut kirjaa ja GET /ostolaskut listaa avoimen ostovelan', async () => {
    const a = app();
    await a.inject({
      method: 'PATCH',
      url: '/asetukset',
      payload: { LaskuMaksutili: '1900' },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/4000',
      payload: { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/2870',
      payload: { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } },
    });
    const kirjaus = await a.inject({
      method: 'POST',
      url: '/ostolaskut',
      payload: {
        pvm: '2026-03-01',
        laskupvm: '2026-03-01',
        erapvm: '2026-03-31',
        viite: '77',
        rivit: [{ myyntikpl: 1, ahinta: 100, alvkoodi: 0, alvprosentti: 0, tili: 4000 }],
      },
    });
    expect([200, 201]).toContain(kirjaus.statusCode);

    const lista = await a.inject({ method: 'GET', url: '/ostolaskut?avoin=true' });
    expect(lista.statusCode).toBe(200);
    const rivit = JSON.parse(lista.body) as { avoin: string }[];
    expect(rivit.length).toBe(1);
    expect(rivit[0]?.avoin).toBe('100.00');

    const laskuId = (JSON.parse(kirjaus.body) as { id: number }).id;
    await a.inject({
      method: 'POST',
      url: '/suoritukset',
      payload: { tosite: laskuId, pvm: '2026-03-31', summa: '100.00' },
    });
    const lista2 = await a.inject({ method: 'GET', url: '/ostolaskut?avoin=true' });
    expect(lista2.statusCode).toBe(200);
    const rivit2 = JSON.parse(lista2.body) as { avoin: string }[];
    expect(rivit2.length).toBe(0);

    await a.close();
  });
});

describe('POST /hyvityslaskut', () => {
  it('hyvittää myyntilaskun (HYVITYSLASKU 214)', async () => {
    const a = app();
    await a.inject({
      method: 'PATCH',
      url: '/asetukset',
      payload: {
        AlvVelvollinen: 'true',
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
      },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/1701',
      payload: { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/2939',
      payload: { numero: 2939, tyyppi: 'CV', nimi: { fi: 'Suoritettava alv' } },
    });

    const lasku = await a.inject({
      method: 'POST',
      url: '/myyntilaskut',
      payload: {
        pvm: '2026-03-01',
        rivit: [{ myyntikpl: 1, ahinta: 100, alvkoodi: 11, alvprosentti: 25.5, tili: 3000 }],
      },
    });
    expect(lasku.statusCode).toBe(201);
    const laskuId = (JSON.parse(lasku.body) as { id: number }).id;

    const hyv = await a.inject({
      method: 'POST',
      url: '/hyvityslaskut',
      payload: { alkuperainenTosite: laskuId, pvm: '2026-03-15' },
    });
    expect([200, 201]).toContain(hyv.statusCode);
    const body = JSON.parse(hyv.body) as { tyyppi: number; alkuperainenTosite: number };
    expect(body.tyyppi).toBe(214);
    expect(body.alkuperainenTosite).toBe(laskuId);

    await a.close();
  });
});

describe('POST /maksuperusteisen-alv-vanhennus', () => {
  it('vanhentaa yli 12 kk auki olleen maksuperusteisen myynnin alv:n (JARJESTELMATOSITE, alvkoodi 118); toinen ajo palauttaa nullin', async () => {
    const a = app();
    await a.inject({
      method: 'PATCH',
      url: '/asetukset',
      payload: {
        AlvVelvollinen: 'true',
        MaksuAlvAlkaa: '2020-01-01',
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
        LaskuMaksutili: '1900',
      },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/1701',
      payload: { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/2939',
      payload: { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Suoritettava alv' } },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/2949',
      payload: { numero: 2949, tyyppi: 'BLM', nimi: { fi: 'Kohdentamaton alv-velka' } },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilikaudet/2027-01-01',
      payload: { alkaa: '2027-01-01', loppuu: '2027-12-31' },
    });

    const lasku = await a.inject({
      method: 'POST',
      url: '/myyntilaskut',
      payload: {
        pvm: '2026-01-15', // yli 12 kk ennen vanhennuksen loppupvm:ää 2027-06-30
        rivit: [{ myyntikpl: 1, ahinta: 100, alvkoodi: 11, alvprosentti: 25.5, tili: 3000 }],
      },
    });
    expect(lasku.statusCode).toBe(201);

    const vanhennus = await a.inject({
      method: 'POST',
      url: '/maksuperusteisen-alv-vanhennus',
      payload: { loppupvm: '2027-06-30' },
    });
    expect(vanhennus.statusCode).toBe(200);
    const vanhennettu = JSON.parse(vanhennus.body) as {
      tyyppi: number;
      viennit: { tili: number; alvkoodi?: number }[];
    };
    expect(vanhennettu.tyyppi).toBe(1000); // JARJESTELMATOSITE
    expect(vanhennettu.viennit.some((v) => v.tili === 2939 && v.alvkoodi === 118)).toBe(true);

    const toinen = await a.inject({
      method: 'POST',
      url: '/maksuperusteisen-alv-vanhennus',
      payload: { loppupvm: '2027-06-30' },
    });
    expect(toinen.statusCode).toBe(200);
    expect(toinen.json()).toBeNull();

    await a.close();
  });
});

describe('POST /marginaalivero', () => {
  it('kirjaa kauden marginaaliveron (MARGINAALILASKELMA, 113-vienti 2939:lle); toiminnaton kausi palauttaa nullin', async () => {
    const a = app();
    await a.inject({
      method: 'PATCH',
      url: '/asetukset',
      payload: { AlvVelvollinen: 'true' },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/3010',
      payload: { numero: 3010, tyyppi: 'CL', nimi: { fi: 'Marginaalimyynti' } },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/4000',
      payload: { numero: 4000, tyyppi: 'D', nimi: { fi: 'Marginaaliostot' } },
    });
    await a.inject({
      method: 'PUT',
      url: '/tilit/2939',
      payload: { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
    });

    const myynti = await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2026-06-05',
        tyyppi: 0,
        sarja: '',
        viennit: [
          { tili: 1900, debet: '1000.00', pvm: '2026-06-05' },
          {
            tili: 3010,
            kredit: '1000.00',
            pvm: '2026-06-05',
            alvkoodi: 13,
            alvprosentti: 25.5,
          },
        ],
      },
    });
    expect(myynti.statusCode).toBe(201);

    const osto = await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2026-06-10',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 4000,
            debet: '600.00',
            pvm: '2026-06-10',
            alvkoodi: 23,
            alvprosentti: 25.5,
          },
          { tili: 1900, kredit: '600.00', pvm: '2026-06-10' },
        ],
      },
    });
    expect(osto.statusCode).toBe(201);

    const laskelma = await a.inject({
      method: 'POST',
      url: '/marginaalivero',
      payload: { alkupvm: '2026-06-01', loppupvm: '2026-06-30' },
    });
    expect(laskelma.statusCode).toBe(200);
    const marginaalilaskelma = JSON.parse(laskelma.body) as {
      tyyppi: number;
      viennit: { tili: number; alvkoodi?: number; kredit?: string }[];
    };
    expect(marginaalilaskelma.tyyppi).toBe(9105); // MARGINAALILASKELMA
    // margin 400,00; vero = roundHalfAway(2550*40000/12550) = 8127 -> "81.27"
    expect(
      marginaalilaskelma.viennit.some(
        (v) => v.tili === 2939 && v.alvkoodi === 113 && v.kredit === '81.27',
      ),
    ).toBe(true);

    const tyhja = await a.inject({
      method: 'POST',
      url: '/marginaalivero',
      payload: { alkupvm: '2026-08-01', loppupvm: '2026-08-31' },
    });
    expect(tyhja.statusCode).toBe(200);
    expect(tyhja.json()).toBeNull();

    await a.close();
  });
});

describe('tilinpäätös HTTP:n yli', () => {
  const tilinpaatosSeed = {
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto' } },
      { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden voitto' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: {
      Nimi: 'Testi Oy',
      'tulos/yleinen': JSON.stringify({
        nimi: { fi: 'Tuloslaskelma' },
        rivit: [{ fi: 'Liikevaihto', L: '3' }],
      }),
      'tase/yleinen': JSON.stringify({
        nimi: { fi: 'Tase' },
        rivit: [{ fi: 'Pankkitili', L: '1900' }],
      }),
    },
  };
  const tilinpaatosApp = () =>
    luoPalvelin(createMemoryStorage(tilinpaatosSeed), { kello: () => '2027-01-15T00:00:00.000Z' });

  it('vahvistaa, näyttää ja peruu tilinpäätöksen; liitetiedot tallentuvat', async () => {
    const a = tilinpaatosApp();

    // Kirjaa myyntitosite, jotta tuloslaskelmalle syntyy sisältöä.
    const kirjaus = await a.inject({
      method: 'POST',
      url: '/tositteet',
      payload: {
        pvm: '2026-06-01',
        tyyppi: 200,
        sarja: '',
        viennit: [
          { tili: 1900, debet: '1000.00', kredit: '0.00', pvm: '2026-06-01' },
          { tili: 3000, debet: '0.00', kredit: '1000.00', pvm: '2026-06-01' },
        ],
      },
    });
    expect(kirjaus.statusCode).toBe(201);

    // Ennen kauden päättämistä vahvistus ei onnistu (EIPAATETTY -> 400).
    const eiPaatetty = await a.inject({
      method: 'POST',
      url: '/tilinpaatos/vahvista',
      payload: { alkaa: '2026-01-01' },
    });
    expect(eiPaatetty.statusCode).toBe(400);

    const lukitus = await a.inject({
      method: 'POST',
      url: '/tilikaudet/2026-01-01/lukitus',
      payload: {},
    });
    expect(lukitus.statusCode).toBe(200);

    // Liitetiedot tallentuvat ennen vahvistusta (vahvistettuun ei voi enää koskea).
    const liite = await a.inject({
      method: 'POST',
      url: '/liitetiedot',
      payload: { loppupvm: '2026-12-31', teksti: 'Yhtiö on toiminut normaalisti.' },
    });
    expect(liite.statusCode).toBe(200);

    const vahvistus = await a.inject({
      method: 'POST',
      url: '/tilinpaatos/vahvista',
      payload: { alkaa: '2026-01-01' },
    });
    expect(vahvistus.statusCode).toBe(200);

    const haku = await a.inject({ method: 'GET', url: '/tilinpaatos?alkaa=2026-01-01' });
    expect(haku.statusCode).toBe(200);
    const doc = haku.json() as {
      vahvistettu: string | null;
      tuloslaskelma: { teksti: string; arvo: string | null }[];
      tase: { teksti: string; arvo: string | null }[];
      liitetiedot: string;
    };
    expect(doc.vahvistettu).toBe('2027-01-15');
    expect(doc.tuloslaskelma.find((r) => r.teksti === 'Liikevaihto')?.arvo).toBe('1000.00');
    expect(doc.tase.find((r) => r.teksti === 'Pankkitili')?.arvo).toBe('1000.00');
    expect(doc.liitetiedot).toBe('Yhtiö on toiminut normaalisti.');

    const peru = await a.inject({
      method: 'POST',
      url: '/tilinpaatos/peru',
      payload: { alkaa: '2026-01-01' },
    });
    expect(peru.statusCode).toBe(200);

    const hakuPerun = await a.inject({ method: 'GET', url: '/tilinpaatos?alkaa=2026-01-01' });
    expect((hakuPerun.json() as { vahvistettu: string | null }).vahvistettu).toBeNull();

    await a.close();
  });
});

describe('GET /tulot ja /menot', () => {
  const rahavirtaSeed = {
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: { Nimi: 'Oy Esimerkki' },
  };

  const rahavirtaApp = () =>
    luoPalvelin(createMemoryStorage(rahavirtaSeed), {
      kello: () => '2026-06-01T00:00:00.000Z',
    });

  const myyntiVoucherPayload = {
    pvm: '2026-03-01',
    tyyppi: 200,
    sarja: '',
    otsikko: 'Revontuli',
    viennit: [
      { tili: 1900, debet: '125.50', pvm: '2026-03-01' },
      { tili: 3000, kredit: '100.00', pvm: '2026-03-01' },
      { tili: 2939, kredit: '25.50', pvm: '2026-03-01' },
    ],
  };

  it('listaa tulot ja erittelee alvin', async () => {
    const app = rahavirtaApp();
    const luonti = await app.inject({
      method: 'POST',
      url: '/tositteet',
      payload: myyntiVoucherPayload,
    });
    expect(luonti.statusCode).toBeLessThan(300);

    const res = await app.inject({ method: 'GET', url: '/tulot' });

    expect(res.statusCode).toBe(200);
    const rivit = res.json();
    expect(rivit).toHaveLength(1);
    expect(rivit[0].netto).toBe('100.00');
    expect(rivit[0].alv).toBe('25.50');
    expect(rivit[0].summa).toBe('125.50');
    expect(rivit[0].avoin).toBe('0.00');
    await app.close();
  });

  it('menot on tyhjä kun kirjassa on vain myyntiä', async () => {
    const app = rahavirtaApp();
    const luonti = await app.inject({
      method: 'POST',
      url: '/tositteet',
      payload: myyntiVoucherPayload,
    });
    expect(luonti.statusCode).toBeLessThan(300);

    const res = await app.inject({ method: 'GET', url: '/menot' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it('kelpaamaton kumppani-parametri ei kaadu vaan jättää suodattimen huomiotta', async () => {
    const app = rahavirtaApp();
    const luonti = await app.inject({
      method: 'POST',
      url: '/tositteet',
      payload: myyntiVoucherPayload,
    });
    expect(luonti.statusCode).toBeLessThan(300);

    const res = await app.inject({ method: 'GET', url: '/tulot?kumppani=abc' });

    expect(res.statusCode).toBe(200);
    const rivit = res.json();
    expect(rivit).toHaveLength(1);
    expect(rivit[0].netto).toBe('100.00');
    await app.close();
  });
});
