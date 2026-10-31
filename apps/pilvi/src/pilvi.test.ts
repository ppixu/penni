import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { pyynto, uusiKayttaja, uusiKirja } from './test/apu.js';

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

describe('pilvi-Worker: tunnistus', () => {
  it('rekisteröinti, /me, uloskirjautuminen ja kirjautuminen (5a:n logiikka Control DO:ta vasten)', async () => {
    const email = `kirjautuja-${crypto.randomUUID()}@esimerkki.fi`;
    const reg = await pyynto('POST', '/api/register', {
      runko: { email, salasana: 'salasana1', nimi: 'Meikäläinen Matti' },
    });
    expect(reg.status).toBe(201);
    const { token } = reg.body as { token: string };

    const mina = await pyynto('GET', '/api/me', { token });
    expect(mina.status).toBe(200);
    expect(mina.body).toMatchObject({ kayttaja: { email, nimi: 'Meikäläinen Matti' } });

    expect((await pyynto('POST', '/api/logout', { token, runko: {} })).status).toBe(200);
    expect((await pyynto('GET', '/api/me', { token })).status).toBe(401);

    const vaara = await pyynto('POST', '/api/login', { runko: { email, salasana: 'vaara1234' } });
    expect(vaara.status).toBe(401);
    expect(vaara.body).toMatchObject({ koodi: 'VAARA_TUNNUS' });
    const oikea = await pyynto('POST', '/api/login', { runko: { email, salasana: 'salasana1' } });
    expect(oikea.status).toBe(200);
  });

  it('varattu sähköposti → 409 EMAIL_VARATTU (virhe kulkee DO-rajan yli)', async () => {
    const email = `tupla-${crypto.randomUUID()}@esimerkki.fi`;
    await pyynto('POST', '/api/register', { runko: { email, salasana: 'salasana1' } });
    const toinen = await pyynto('POST', '/api/register', {
      runko: { email: email.toUpperCase(), salasana: 'salasana1' },
    });
    expect(toinen.status).toBe(409);
    expect(toinen.body).toMatchObject({ koodi: 'EMAIL_VARATTU' });
  });

  it('salasanan vaihto: vanha ei enää kelpaa, uusi kelpaa', async () => {
    const email = `vaihtaja-${crypto.randomUUID()}@esimerkki.fi`;
    const reg = await pyynto('POST', '/api/register', { runko: { email, salasana: 'salasana1' } });
    const { token } = reg.body as { token: string };
    const vaihto = await pyynto('POST', '/api/vaihda-salasana', {
      token,
      runko: { vanhaSalasana: 'salasana1', uusiSalasana: 'salasana2' },
    });
    expect(vaihto.status).toBe(200);
    const vanha = await pyynto('POST', '/api/login', { runko: { email, salasana: 'salasana1' } });
    expect(vanha.status).toBe(401);
    const uusi = await pyynto('POST', '/api/login', { runko: { email, salasana: 'salasana2' } });
    expect(uusi.status).toBe(200);
  });
});

describe('pilvi-Worker: kirjat ja jäsenyys', () => {
  it('kirjareitti ilman tokenia → 401 EI_SESSIOTA', async () => {
    const { token } = await uusiKayttaja();
    const kirjaId = await uusiKirja(token, SIEMEN);
    const r = await pyynto('GET', `/api/kirjat/${kirjaId}/init`);
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ koodi: 'EI_SESSIOTA' });
  });

  it('tuntematon tai uloskirjattu token → 401', async () => {
    const { token } = await uusiKayttaja();
    const kirjaId = await uusiKirja(token, SIEMEN);
    expect((await pyynto('GET', `/api/kirjat/${kirjaId}/init`, { token: 'eioo' })).status).toBe(
      401,
    );
    await pyynto('POST', '/api/logout', { token, runko: {} });
    expect((await pyynto('GET', `/api/kirjat/${kirjaId}/init`, { token })).status).toBe(401);
  });

  it('kirjan luonti vaatii kirjautumisen', async () => {
    const r = await pyynto('POST', '/api/kirjat', { runko: {} });
    expect(r.status).toBe(401);
  });

  it('kirjan luonti hylkää kelvottoman rungon (400)', async () => {
    const { token } = await uusiKayttaja();
    const r = await pyynto('POST', '/api/kirjat', { token, runko: { siemen: { tilit: 'x' } } });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ koodi: 'EPAKELPO_SYOTE' });
  });

  it('jäsen: oletuskirja siemennetään yritys-tilikartalla ja kuluvalla tilikaudella', async () => {
    const { token } = await uusiKayttaja();
    const kirjaId = await uusiKirja(token);
    const r = await pyynto('GET', `/api/kirjat/${kirjaId}/init`, { token });
    expect(r.status).toBe(200);
    const init = r.body as {
      tilit: unknown[];
      tilikaudet: { alkaa: string }[];
      asetukset: Record<string, string>;
    };
    expect(init.tilit.length).toBeGreaterThan(500);
    expect(init.asetukset.Nimi).toBe('Uusi kirjanpito');
    expect(init.asetukset['tulos/yleinen']).toBeDefined();
    expect(init.tilikaudet.map((k) => k.alkaa)).toEqual([`${new Date().getUTCFullYear()}-01-01`]);
  });

  it('ei-jäsen saa 404:n eikä voi lukea tai kirjoittaa toisen kirjaan', async () => {
    const omistaja = await uusiKayttaja();
    const vieras = await uusiKayttaja();
    const kirjaId = await uusiKirja(omistaja.token, SIEMEN);

    const luku = await pyynto('GET', `/api/kirjat/${kirjaId}/init`, { token: vieras.token });
    expect(luku.status).toBe(404);
    expect(luku.body).toMatchObject({ koodi: 'EI_KIRJAA' });
    const kirjoitus = await pyynto('POST', `/api/kirjat/${kirjaId}/tositteet`, {
      token: vieras.token,
      runko: TOSITE,
    });
    expect(kirjoitus.status).toBe(404);

    const omat = await pyynto('GET', `/api/kirjat/${kirjaId}/tositteet`, {
      token: omistaja.token,
    });
    expect(omat.body).toEqual([]);
  });

  it('olematon kirja → sama 404 kuin ei-jäsenelle', async () => {
    const { token } = await uusiKayttaja();
    const r = await pyynto('GET', `/api/kirjat/${crypto.randomUUID()}/init`, { token });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ koodi: 'EI_KIRJAA' });
  });

  it('jäsenen tosite kantaa käyttäjän id:n kirjan DO:n tarkastuslokiin', async () => {
    const { token, id: kayttajaId } = await uusiKayttaja();
    const kirjaId = await uusiKirja(token, SIEMEN);
    const luotu = await pyynto('POST', `/api/kirjat/${kirjaId}/tositteet`, {
      token,
      runko: TOSITE,
    });
    expect(luotu.status).toBe(201);
    const { id, tunniste } = luotu.body as { id: number; tunniste: number };
    expect(tunniste).toBe(1);

    const stub = env.KIRJA.get(env.KIRJA.idFromName(kirjaId));
    const loki = await runInDurableObject(stub, (o) => o.kirja().getLoki(id));
    expect(loki.map((e) => e.userId)).toEqual([kayttajaId]);
  });

  it('moottorin ResourceError ja ts-restin validointi palautuvat HTTP-virheinä', async () => {
    const { token } = await uusiKayttaja();
    const kirjaId = await uusiKirja(token, SIEMEN);
    const puuttuu = await pyynto('GET', `/api/kirjat/${kirjaId}/tositteet/999`, { token });
    expect(puuttuu.status).toBe(404);
    expect(puuttuu.body).toMatchObject({ koodi: 'EITOSITETTA' });
    const kelvoton = await pyynto('POST', `/api/kirjat/${kirjaId}/tositteet`, {
      token,
      runko: { pvm: 5 },
    });
    expect(kelvoton.status).toBe(400);
  });

  it('odottamaton virhe kirjan DO:ssa → 500 (ei ResourceError, ei kaatumista)', async () => {
    const { token } = await uusiKayttaja();
    const kirjaId = await uusiKirja(token, SIEMEN);
    const stub = env.KIRJA.get(env.KIRJA.idFromName(kirjaId));
    await runInDurableObject(stub, (o) => {
      // Rikotaan tämän DO-instanssin Storage: moottori saa tavallisen poikkeuksen. Heitetään
      // synkronisesti: vitest-pool-workers raportoi `return Promise.reject(...)` -kuvion
      // käsittelemättömäksi, vaikka kutsuja ottaa sen kiinni (työkalun artefakti).
      o.kirja().listTositteet = () => {
        throw new TypeError('rikki');
      };
    });
    const virheet: unknown[] = [];
    const alkuperainen = console.error;
    console.error = (...a: unknown[]) => virheet.push(a);
    try {
      const r = await pyynto('GET', `/api/kirjat/${kirjaId}/tositteet`, { token });
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ virhe: 'Palvelinvirhe' });
    } finally {
      console.error = alkuperainen;
    }
    expect(virheet.length).toBe(1);
  });

  it('tuntematon polku → 404', async () => {
    const { token } = await uusiKayttaja();
    const kirjaId = await uusiKirja(token, SIEMEN);
    expect((await pyynto('GET', `/api/kirjat/${kirjaId}/eioo`, { token })).status).toBe(404);
    expect((await pyynto('GET', '/api/eioo')).status).toBe(404);
    expect((await pyynto('GET', '/muu')).status).toBe(404);
  });
});
