import { SELF, env } from 'cloudflare:test';
import { decodeLiite } from '@penni/contract';
import { describe, expect, it } from 'vitest';
import worker from './index.js';
import { LIITE_RIVI_OTSAKE } from './kehitys-reitit.js';
import { POHJA, pyynto, uusiKayttaja, uusiKirja } from './test/apu.js';

// Kehitysreitit (kirjan tuonti ja mittauslaskurit; kehitys.ts): vain paikalliseen mittaukseen.

async function tyhjaKirja(): Promise<{ token: string; kirjaId: string }> {
  const { token } = await uusiKayttaja();
  return { token, kirjaId: await uusiKirja(token, {}) };
}

const TILI = (numero: number, tyyppi: string, nimi: string) => [
  numero,
  0,
  tyyppi,
  JSON.stringify({ numero, tyyppi, nimi: { fi: nimi } }),
  0,
];

async function tuo(
  token: string,
  kirjaId: string,
  taulu: string,
  sarakkeet: string[],
  rivit: unknown[][],
) {
  return pyynto('POST', `/api/kirjat/${kirjaId}/kehitys/tuonti/rivit`, {
    token,
    runko: { taulu, sarakkeet, rivit },
  });
}

describe('kehitystuonti', () => {
  it('tuo rivit ja liitteen (tavut R2:een) niin että kirja toimii tuonnin jälkeen', async () => {
    const { token, kirjaId } = await tyhjaKirja();
    const tiliSarakkeet = ['numero', 'taso', 'tyyppi', 'json', 'muokattu'];
    expect(
      (
        await tuo(token, kirjaId, 'tili', tiliSarakkeet, [
          TILI(1900, 'ARP', 'Pankkitili'),
          TILI(3000, 'CL', 'Myynti'),
        ])
      ).body,
    ).toEqual({ tuotu: 2 });
    await tuo(
      token,
      kirjaId,
      'tilikausi',
      ['alkaa', 'loppuu', 'json'],
      [['2026-01-01', '2026-12-31', JSON.stringify({ alkaa: '2026-01-01', loppuu: '2026-12-31' })]],
    );
    const tositeSarakkeet = ['id', 'pvm', 'tyyppi', 'tila', 'tunniste', 'sarja', 'json'];
    // Yli 100/7 = 14 riviä → useampi monirivinen INSERT.
    const tositteet = Array.from({ length: 40 }, (_, i) => [
      i + 1,
      '2026-03-01',
      0,
      100,
      i + 1,
      '',
      JSON.stringify({
        id: i + 1,
        pvm: '2026-03-01',
        tyyppi: 0,
        tila: 100,
        tunniste: i + 1,
        sarja: '',
        otsikko: `Testi ${i + 1}`,
        viennit: [
          { tili: 1900, debet: 1000, kredit: 0, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
          { tili: 3000, debet: 0, kredit: 1000, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
        ],
      }),
    ]);
    expect((await tuo(token, kirjaId, 'tosite', tositeSarakkeet, tositteet)).body).toEqual({
      tuotu: 40,
    });
    const viennit = tositteet.flatMap((t, i) => [
      [i * 2 + 1, t[0], 1, 1900, '2026-03-01', 1000, 0, 0, null],
      [i * 2 + 2, t[0], 2, 3000, '2026-03-01', 0, 1000, 0, null],
    ]);
    await tuo(
      token,
      kirjaId,
      'vienti',
      ['id', 'tosite', 'rivi', 'tili', 'pvm', 'debetsnt', 'kreditsnt', 'kohdennus', 'eraid'],
      viennit,
    );

    const tavut = new Uint8Array(70_000).map((_, i) => (i * 31) & 0xff);
    const liite = await SELF.fetch(`${POHJA}/api/kirjat/${kirjaId}/kehitys/tuonti/liite`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        [LIITE_RIVI_OTSAKE]: encodeURIComponent(
          JSON.stringify({
            id: 7,
            tosite: 3,
            nimi: 'kuitti ä.pdf',
            roolinimi: null,
            tyyppi: 'application/pdf',
            sha: null,
            luotu: '2026-03-02T10:00:00.000Z',
            json: JSON.stringify({ id: 7, tosite: 3, nimi: 'kuitti ä.pdf' }),
          }),
        ),
      },
      body: tavut,
    });
    expect(liite.status).toBe(200);

    const yhteenveto = await pyynto('GET', `/api/kirjat/${kirjaId}/kehitys/yhteenveto`, { token });
    expect(yhteenveto.body).toMatchObject({
      rivit: { tili: 2, tilikausi: 1, tosite: 40, vienti: 80, liite: 1, loki: 0 },
    });

    // Kirja toimii: lista, saldot, liitteen lataus R2:sta ja uusi tosite saa seuraavan numeron.
    const lista = await pyynto('GET', `/api/kirjat/${kirjaId}/tositteet`, { token });
    expect((lista.body as unknown[]).length).toBe(40);
    const saldot = await pyynto(
      'GET',
      `/api/kirjat/${kirjaId}/saldot?pvm=2026-12-31&tuloslaskelma=true`,
      { token },
    );
    expect(saldot.status).toBe(200);
    const luku = await pyynto('GET', `/api/kirjat/${kirjaId}/liitteet/7`, { token });
    expect(luku.status).toBe(200);
    expect(decodeLiite(luku.body as Record<string, unknown>).data).toEqual(tavut);
    expect((await env.LIITTEET.list({ prefix: `kirja/${kirjaId}/` })).objects).toHaveLength(1);
    const uusi = await pyynto('POST', `/api/kirjat/${kirjaId}/tositteet`, {
      token,
      runko: {
        pvm: '2026-03-05',
        tyyppi: 0,
        sarja: '',
        tila: 100,
        viennit: [
          { tili: 1900, debet: '10.00', pvm: '2026-03-05' },
          { tili: 3000, kredit: '10.00', pvm: '2026-03-05' },
        ],
      },
    });
    expect(uusi.status).toBe(201);
    expect((uusi.body as { tunniste: number }).tunniste).toBe(41);
  });

  it('hylkää tuntemattoman taulun ja sarakkeen (ei SQL-injektiota)', async () => {
    const { token, kirjaId } = await tyhjaKirja();
    const huono = await tuo(token, kirjaId, 'migraatio', ['versio'], [[99]]);
    expect(huono.status).toBe(400);
    const huonoSarake = await tuo(token, kirjaId, 'tili', ['numero) VALUES (1); --'], [[1]]);
    expect(huonoSarake.status).toBe(400);
  });

  it('vaatii jäsenyyden kuten muutkin kirjareitit', async () => {
    const { kirjaId } = await tyhjaKirja();
    const vieras = await uusiKayttaja();
    const r = await pyynto('GET', `/api/kirjat/${kirjaId}/kehitys/yhteenveto`, {
      token: vieras.token,
    });
    expect(r.status).toBe(404);
    expect((await pyynto('GET', `/api/kirjat/${kirjaId}/kehitys/yhteenveto`)).status).toBe(401);
  });

  it('ilman kehitysmuuttujia kaikki kehitysreitit ovat 404 ja DO:n metodit heittävät', async () => {
    const { token, kirjaId } = await tyhjaKirja();
    const { PILVI_KEHITYS_TUONTI: _t, PILVI_KEHITYS_LASKURIT: _l, ...ilman } = env;
    const kutsu = async (metodi: string, loppu: string, runko?: unknown) =>
      (
        await worker.fetch(
          new Request(`${POHJA}/api/kirjat/${kirjaId}${loppu}`, {
            method: metodi,
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            ...(runko !== undefined ? { body: JSON.stringify(runko) } : {}),
          }),
          ilman,
        )
      ).status;
    expect(await kutsu('GET', '/kehitys/yhteenveto')).toBe(404);
    expect(await kutsu('GET', '/kehitys/laskurit')).toBe(404);
    expect(await kutsu('POST', '/kehitys/laskurit')).toBe(404);
    expect(await kutsu('POST', '/kehitys/lokimaarat', { ids: [1] })).toBe(404);
    expect(
      await kutsu('POST', '/kehitys/tuonti/rivit', { taulu: 'tili', sarakkeet: [], rivit: [] }),
    ).toBe(404);
    // Tavallinen kirjareitti toimii edelleen.
    expect(await kutsu('GET', '/tositteet')).toBe(200);
  });
});

describe('mittauslaskurit', () => {
  it('laskevat Worker-pyynnöt, Book/Control DO -kutsut, R2-operaatiot ja SQL-rivit', async () => {
    const { token, kirjaId } = await tyhjaKirja();
    const nollaa = () =>
      pyynto('POST', `/api/kirjat/${kirjaId}/kehitys/laskurit`, { token, runko: {} });
    await nollaa();

    const lista = await pyynto('GET', `/api/kirjat/${kirjaId}/tositteet`, { token });
    expect(lista.status).toBe(200);
    const tosite = await pyynto('POST', `/api/kirjat/${kirjaId}/tositteet`, {
      token,
      runko: {
        pvm: '2026-03-05',
        tyyppi: 0,
        sarja: '',
        tila: 50,
        viennit: [],
      },
    });
    expect(tosite.status).toBe(201);
    const id = (tosite.body as { id: number }).id;
    const liite = await pyynto('POST', `/api/kirjat/${kirjaId}/liitteet`, {
      token,
      runko: {
        tosite: id,
        nimi: 'a.pdf',
        tyyppi: 'application/pdf',
        luotu: '2026-03-05T10:00:00.000Z',
        data: btoa('%PDF-1.7 testi'),
      },
    });
    expect(liite.status).toBe(200);

    const luku = await nollaa();
    const { worker: w, kirja: k } = luku.body as {
      worker: {
        controlDoMetodeittain: Record<string, number>;
        pyynnot: number;
        kirjaDoKutsut: number;
        controlDoKutsut: number;
        kirjaDoReiteittain: Record<string, number>;
      };
      kirja: {
        kasittelyja: number;
        rowsRead: number;
        rowsWritten: number;
        r2: { head: number; put: number; get: number; putTavut: number };
      };
    };
    // 3 kirjapyyntöä (+ nollaus, joka on kehitysreitti eikä laske).
    expect(w.pyynnot).toBe(3);
    expect(w.kirjaDoKutsut).toBe(3);
    expect(w.kirjaDoReiteittain).toEqual({ listaaTositteet: 1, luoTosite: 1, tallennaLiite: 1 });
    // Jokaisessa pyynnössä haeSessio + haeKayttajaTiedot + onJasen (ei välimuistia); lukupyyntö
    // itse ei laske mukaan.
    expect(w.controlDoKutsut).toBe(9);
    expect(w.controlDoMetodeittain).toEqual({ haeSessio: 3, haeKayttajaTiedot: 3, onJasen: 3 });
    expect(k.kasittelyja).toBe(3);
    expect(k.rowsWritten).toBeGreaterThan(0);
    expect(k.rowsRead).toBeGreaterThan(0);
    expect(k.r2).toMatchObject({ head: 1, put: 1 });
    expect(k.r2.putTavut).toBe(14);

    // Nollaus nollasi: uusi lukema on tyhjä, mutta DO-esiintymä on sama.
    const tyhja = await nollaa();
    expect((tyhja.body as { worker: { pyynnot: number } }).worker.pyynnot).toBe(0);
    expect((tyhja.body as { kirja: { sqlLauseita: number } }).kirja.sqlLauseita).toBe(0);
  });
});
