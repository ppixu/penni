import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LUKUMALLI } from '@penni/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kasitteleMallipyynto } from './malliProtokolla.js';

const POLKU = `${LUKUMALLI.id}/resolve/${LUKUMALLI.revisio}`;
const url = (tiedosto: string, polku = POLKU) => `penni-malli://hf/${polku}/${tiedosto}`;

function riippuvuudet(vastaus = () => new Response('painot', { status: 200 })) {
  return {
    juuri: mkdtempSync(join(tmpdir(), 'mallit-')),
    hae: vi.fn(async (_url: string, _init?: RequestInit) => vastaus()),
    lupa: vi.fn(() => true),
  };
}

/** Täysi lataus välimuistiin ja hae-laskurin nollaus. */
async function valimuistiin(r: ReturnType<typeof riippuvuudet>, tiedosto: string) {
  const { vastaus, tallennus } = await kasitteleMallipyynto(url(tiedosto), 'GET', r);
  await vastaus.text();
  await tallennus;
  r.hae.mockClear();
}

const mallinHakemisto = (juuri: string, ...osat: string[]) =>
  join(juuri, LUKUMALLI.id, LUKUMALLI.revisio, ...osat);

/** Kaikki hakemistopuun tiedostot suhteellisina polkuina. */
function tiedostot(hakemisto: string, etuliite = ''): string[] {
  if (!existsSync(hakemisto)) return [];
  return readdirSync(hakemisto, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? tiedostot(join(hakemisto, e.name), `${etuliite}${e.name}/`)
      : [`${etuliite}${e.name}`],
  );
}

afterEach(() => vi.restoreAllMocks());

describe('kasitteleMallipyynto', () => {
  it('hakee sallitun tiedoston Hugging Facesta ja tallentaa sen levylle', async () => {
    const r = riippuvuudet();
    const { vastaus, tallennus } = await kasitteleMallipyynto(
      url('onnx/decoder_model_merged_q4.onnx'),
      'GET',
      r,
    );
    expect(r.hae).toHaveBeenCalledWith(
      `https://huggingface.co/${POLKU}/onnx/decoder_model_merged_q4.onnx`,
      { method: 'GET' },
    );
    expect(vastaus.headers.get('access-control-allow-origin')).toBe('*');
    expect(await vastaus.text()).toBe('painot');
    await tallennus;
    const levy = join(
      r.juuri,
      LUKUMALLI.id,
      LUKUMALLI.revisio,
      'onnx',
      'decoder_model_merged_q4.onnx',
    );
    expect(readFileSync(levy, 'utf8')).toBe('painot');
    expect(existsSync(`${levy}.osittainen`)).toBe(false);
  });

  it('palvelee välimuistista hakematta verkosta', async () => {
    const r = riippuvuudet();
    await (await kasitteleMallipyynto(url('config.json'), 'GET', r)).tallennus;
    r.hae.mockClear();
    const { vastaus } = await kasitteleMallipyynto(url('config.json'), 'GET', r);
    expect(r.hae).not.toHaveBeenCalled();
    expect(vastaus.headers.get('content-type')).toBe('application/json');
    expect(await vastaus.text()).toBe('painot');
  });

  it('hylkää muut repot, revisiot ja polkuhypyt', async () => {
    const r = riippuvuudet();
    for (const u of [
      url('config.json', 'toinen/malli/resolve/main'),
      url('config.json', `${LUKUMALLI.id}/resolve/main`),
      url('../../../etc/passwd'),
      url('onnx/%2e%2e/%2e%2e/x'),
      'penni-malli://muu/x',
    ]) {
      const { vastaus } = await kasitteleMallipyynto(u, 'GET', r);
      expect(vastaus.status, u).toBe(403);
    }
    expect(r.hae).not.toHaveBeenCalled();
  });

  it('välittää Hugging Facen virheen eikä tallenna sitä', async () => {
    const r = riippuvuudet(() => new Response('ei', { status: 404 }));
    const { vastaus, tallennus } = await kasitteleMallipyynto(url('puuttuva.json'), 'GET', r);
    expect(vastaus.status).toBe(404);
    await tallennus;
    expect(existsSync(join(r.juuri, LUKUMALLI.id, LUKUMALLI.revisio, 'puuttuva.json'))).toBe(false);
  });

  it('keskeytynyt lataus ei jätä valmista eikä osittaista tiedostoa ja kirjaa virheen', async () => {
    const varoitus = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const virheellinen = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('puoli'));
        c.error(new Error('yhteys katkesi'));
      },
    });
    const r = riippuvuudet(() => new Response(virheellinen, { status: 200 }));
    const { vastaus, tallennus } = await kasitteleMallipyynto(url('onnx/x.onnx_data'), 'GET', r);
    await vastaus.text().catch(() => undefined);
    await tallennus;
    expect(tiedostot(mallinHakemisto(r.juuri))).toEqual([]);
    expect(varoitus).toHaveBeenCalledOnce();
    expect(String(varoitus.mock.calls[0]?.[0])).toContain('onnx/x.onnx_data');
  });

  it('yhdistää päällekkäiset lataukset ja pitää osittaiset tiedostot palvelupuun ulkopuolella', async () => {
    let kontrolli: ReadableStreamDefaultController<Uint8Array> | undefined;
    const r = riippuvuudet(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              kontrolli = c;
            },
          }),
        ),
    );
    const a = await kasitteleMallipyynto(url('onnx/iso.onnx_data'), 'GET', r);
    const tekstiA = a.vastaus.text();
    kontrolli?.enqueue(new TextEncoder().encode('AA'));
    const bPyynto = kasitteleMallipyynto(url('onnx/iso.onnx_data'), 'GET', r);
    await vi.waitFor(() => expect(tiedostot(join(r.juuri, '.tmp'))).toHaveLength(1));
    expect(tiedostot(mallinHakemisto(r.juuri))).toEqual([]);
    kontrolli?.enqueue(new TextEncoder().encode('AA'));
    kontrolli?.close();
    const b = await bPyynto;
    expect(await tekstiA).toBe('AAAA');
    expect(await b.vastaus.text()).toBe('AAAA');
    await Promise.all([a.tallennus, b.tallennus]);
    expect(r.hae).toHaveBeenCalledOnce();
    expect(tiedostot(join(r.juuri, '.tmp'))).toEqual([]);
    expect(readFileSync(mallinHakemisto(r.juuri, 'onnx', 'iso.onnx_data'), 'utf8')).toBe('AAAA');
  });

  it('hylkää hakemistot', async () => {
    const r = riippuvuudet();
    mkdirSync(mallinHakemisto(r.juuri, 'onnx'), { recursive: true });
    expect((await kasitteleMallipyynto(url('onnx'), 'GET', r)).vastaus.status).toBe(403);
    expect(r.hae).not.toHaveBeenCalled();
  });

  it('siivoaa edellisen ajon väliaikaistiedostot alussa', async () => {
    const r = riippuvuudet();
    mkdirSync(join(r.juuri, '.tmp'));
    writeFileSync(join(r.juuri, '.tmp', 'vanha.OSITTAINEN'), 'salainen');
    await (await kasitteleMallipyynto(url('config.json'), 'GET', r)).tallennus;
    expect(tiedostot(join(r.juuri, '.tmp'))).toEqual([]);
  });

  it.each(['100', '2', 'virhe'])(
    'ei tallenna väärän content-lengthin (%s) runkoa',
    async (pituus) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const r = riippuvuudet(
        () => new Response('painot', { headers: { 'content-length': pituus } }),
      );
      const a = await kasitteleMallipyynto(url('config.json'), 'GET', r);
      await a.vastaus.text();
      await a.tallennus;
      expect(tiedostot(r.juuri)).toEqual([]);
    },
  );

  it.each(['tiedosto', 'hakemisto', 'tmp', 'rikkinainen'])(
    'hylkää symbolisen linkin: %s',
    async (tyyppi) => {
      const r = riippuvuudet();
      const ulkona = mkdtempSync(join(tmpdir(), 'ulkona-'));
      mkdirSync(mallinHakemisto(r.juuri), { recursive: true });
      writeFileSync(join(ulkona, 'salainen'), 'salainen');
      let tiedosto = 'config.json';
      if (tyyppi === 'tmp') symlinkSync(ulkona, join(r.juuri, '.tmp'));
      else if (tyyppi === 'hakemisto') {
        symlinkSync(ulkona, mallinHakemisto(r.juuri, 'onnx'));
        tiedosto = 'onnx/uusi.onnx';
      } else
        symlinkSync(
          join(ulkona, tyyppi === 'rikkinainen' ? 'puuttuva' : 'salainen'),
          mallinHakemisto(r.juuri, tiedosto),
        );
      expect((await kasitteleMallipyynto(url(tiedosto), 'GET', r)).vastaus.status).toBe(403);
      expect(r.hae).not.toHaveBeenCalled();
      expect(readFileSync(join(ulkona, 'salainen'), 'utf8')).toBe('salainen');
      expect(existsSync(join(ulkona, 'uusi.onnx'))).toBe(false);
    },
  );

  it('tarkistaa kohdepolun uudelleen ennen valmiin tiedoston siirtoa', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let kontrolli: ReadableStreamDefaultController<Uint8Array> | undefined;
    const r = riippuvuudet(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              kontrolli = c;
            },
          }),
        ),
    );
    const ulkona = mkdtempSync(join(tmpdir(), 'ulkona-'));
    const a = await kasitteleMallipyynto(url('onnx/uusi.onnx'), 'GET', r);
    renameSync(mallinHakemisto(r.juuri, 'onnx'), mallinHakemisto(r.juuri, 'vanha'));
    symlinkSync(ulkona, mallinHakemisto(r.juuri, 'onnx'));
    kontrolli?.enqueue(new TextEncoder().encode('painot'));
    kontrolli?.close();
    await a.vastaus.text();
    await a.tallennus;
    expect(existsSync(join(ulkona, 'uusi.onnx'))).toBe(false);
    expect(tiedostot(join(r.juuri, '.tmp'))).toEqual([]);
  });

  it('tarkistaa identity-koodatun vastauksen pituuden', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = riippuvuudet(
      () =>
        new Response('painot', {
          headers: {
            'content-length': '100',
            'content-encoding': 'identity',
          },
        }),
    );
    const a = await kasitteleMallipyynto(url('config.json'), 'GET', r);
    await a.vastaus.text();
    await a.tallennus;
    expect(tiedostot(r.juuri)).toEqual([]);
  });

  it('vapauttaa epäonnistuneen latauksen ja sallii uuden yrityksen', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = riippuvuudet(() => new Response('painot', { headers: { 'content-length': '100' } }));
    const a = await kasitteleMallipyynto(url('config.json'), 'GET', r);
    const bPyynto = kasitteleMallipyynto(url('config.json'), 'GET', r);
    await a.tallennus;
    expect((await bPyynto).vastaus.status).toBe(502);
    r.hae.mockImplementation(async () => new Response('painot'));
    await (await kasitteleMallipyynto(url('config.json'), 'GET', r)).tallennus;
    expect(readFileSync(mallinHakemisto(r.juuri, 'config.json'), 'utf8')).toBe('painot');
  });

  it('välittää content-lengthin vain pakkaamattomasta vastauksesta', async () => {
    const pakkaamaton = riippuvuudet(
      () => new Response('painot', { status: 200, headers: { 'content-length': '6' } }),
    );
    const a = await kasitteleMallipyynto(url('a.bin'), 'GET', pakkaamaton);
    expect(a.vastaus.headers.get('content-length')).toBe('6');
    await a.vastaus.text();
    await a.tallennus;

    const pakattu = riippuvuudet(
      () =>
        new Response('painot', {
          status: 200,
          headers: { 'content-length': '3', 'content-encoding': 'gzip' },
        }),
    );
    const b = await kasitteleMallipyynto(url('b.bin'), 'GET', pakattu);
    expect(b.vastaus.headers.get('content-length')).toBeNull();
    await b.vastaus.text();
    await b.tallennus;
    expect(readFileSync(mallinHakemisto(pakattu.juuri, 'b.bin'), 'utf8')).toBe('painot');
  });

  it('sallii vain GET- ja HEAD-pyynnöt', async () => {
    const { vastaus } = await kasitteleMallipyynto(url('config.json'), 'POST', riippuvuudet());
    expect(vastaus.status).toBe(405);
  });

  it('vastaa CORS-esilentoon ilman levy- tai verkkotoimia', async () => {
    const r = riippuvuudet();
    const { vastaus } = await kasitteleMallipyynto(url('config.json'), 'OPTIONS', r);
    expect(vastaus.status).toBe(204);
    expect(vastaus.headers.get('access-control-allow-origin')).toBe('*');
    expect(vastaus.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS');
    expect(vastaus.headers.get('access-control-allow-headers')).toBe('range');
    expect(r.hae).not.toHaveBeenCalled();
    expect(r.lupa).not.toHaveBeenCalled();
  });

  it('palvelee välimuistissa olevan tiedoston Range-pyynnön levyltä (206)', async () => {
    const r = riippuvuudet();
    await valimuistiin(r, 'onnx/a.onnx');
    r.lupa.mockReturnValue(false);
    for (const [alue, runko, rajat] of [
      ['bytes=0-0', 'p', 'bytes 0-0/6'],
      ['bytes=2-', 'inot', 'bytes 2-5/6'],
      ['bytes=1-3', 'ain', 'bytes 1-3/6'],
      ['bytes=4-100', 'ot', 'bytes 4-5/6'],
      ['bytes=-2', 'ot', 'bytes 4-5/6'],
    ] as const) {
      const { vastaus, tallennus } = await kasitteleMallipyynto(url('onnx/a.onnx'), 'GET', r, alue);
      expect(vastaus.status, alue).toBe(206);
      expect(vastaus.headers.get('content-range'), alue).toBe(rajat);
      expect(vastaus.headers.get('content-length'), alue).toBe(String(runko.length));
      expect(vastaus.headers.get('access-control-expose-headers'), alue).toContain('content-range');
      expect(await vastaus.text(), alue).toBe(runko);
      await tallennus;
    }
    const ohi = await kasitteleMallipyynto(url('onnx/a.onnx'), 'GET', r, 'bytes=6-');
    expect(ohi.vastaus.status).toBe(416);
    expect(ohi.vastaus.headers.get('content-range')).toBe('bytes */6');
    expect(r.hae).not.toHaveBeenCalled();
  });

  it('välittää puuttuvan tiedoston Range-pyynnön Hugging Faceen tallentamatta mitään', async () => {
    const r = riippuvuudet(
      () =>
        new Response('p', {
          status: 206,
          headers: { 'content-range': 'bytes 0-0/6', 'content-length': '1' },
        }),
    );
    const { vastaus, tallennus } = await kasitteleMallipyynto(
      url('tokenizer_config.json'),
      'GET',
      r,
      'bytes=0-0',
    );
    expect(r.hae).toHaveBeenCalledWith(`https://huggingface.co/${POLKU}/tokenizer_config.json`, {
      method: 'GET',
      headers: { range: 'bytes=0-0' },
    });
    expect(vastaus.status).toBe(206);
    expect(vastaus.headers.get('content-range')).toBe('bytes 0-0/6');
    expect(vastaus.headers.get('content-length')).toBe('1');
    expect(await vastaus.text()).toBe('p');
    await tallennus;
    expect(tiedostot(r.juuri)).toEqual([]);

    // Seuraava täysi haku lataa tiedoston normaalisti: Range ei jättänyt keskeneräistä latausta.
    r.hae.mockImplementation(async () => new Response('painot'));
    await valimuistiin(r, 'tokenizer_config.json');
    expect(readFileSync(mallinHakemisto(r.juuri, 'tokenizer_config.json'), 'utf8')).toBe('painot');
  });

  it('Range-pyyntö ei odota eikä liity käynnissä olevaan täyteen lataukseen', async () => {
    let kontrolli: ReadableStreamDefaultController<Uint8Array> | undefined;
    const r = riippuvuudet(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              kontrolli = c;
            },
          }),
        ),
    );
    const taysi = await kasitteleMallipyynto(url('onnx/iso.onnx_data'), 'GET', r);
    const tekstiTaysi = taysi.vastaus.text();
    r.hae.mockImplementationOnce(
      async () => new Response('A', { status: 206, headers: { 'content-range': 'bytes 0-0/4' } }),
    );
    const osa = await kasitteleMallipyynto(url('onnx/iso.onnx_data'), 'GET', r, 'bytes=0-0');
    expect(osa.vastaus.status).toBe(206);
    expect(await osa.vastaus.text()).toBe('A');
    expect(r.hae).toHaveBeenCalledTimes(2);
    expect(r.hae.mock.calls[1]?.[1]).toEqual({ method: 'GET', headers: { range: 'bytes=0-0' } });
    kontrolli?.enqueue(new TextEncoder().encode('AAAA'));
    kontrolli?.close();
    expect(await tekstiTaysi).toBe('AAAA');
    await taysi.tallennus;
    expect(readFileSync(mallinHakemisto(r.juuri, 'onnx', 'iso.onnx_data'), 'utf8')).toBe('AAAA');
  });

  it('tyhjä tai pelkkää tyhjää oleva Range-otsake käyttäytyy kuin puuttuva: täysi lataus tallennetaan ja yhdistetään', async () => {
    for (const alue of ['', '   ']) {
      let kontrolli: ReadableStreamDefaultController<Uint8Array> | undefined;
      const r = riippuvuudet(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                kontrolli = c;
              },
            }),
          ),
      );
      const ensimmainen = await kasitteleMallipyynto(url('config.json'), 'GET', r, alue);
      // Toinen samanaikainen pyyntö liittyy samaan lataukseen eikä hae verkosta uudelleen.
      const toinen = kasitteleMallipyynto(url('config.json'), 'GET', r, alue);
      const teksti1 = ensimmainen.vastaus.text();
      kontrolli?.enqueue(new TextEncoder().encode('{}'));
      kontrolli?.close();
      expect(await teksti1).toBe('{}');
      await ensimmainen.tallennus;
      const { vastaus } = await toinen;
      expect(vastaus.status, JSON.stringify(alue)).toBe(200);
      expect(await vastaus.text()).toBe('{}');
      expect(r.hae).toHaveBeenCalledTimes(1);
      // Ei välitetty Hugging Faceen Range-pyyntönä, vaan tavallisena GET:nä.
      expect(r.hae.mock.calls[0]?.[1]).toEqual({ method: 'GET' });
      expect(readFileSync(mallinHakemisto(r.juuri, 'config.json'), 'utf8')).toBe('{}');
    }
  });

  it('ilman lupaa ei hae verkosta (403), mutta palvelee välimuistista', async () => {
    const r = riippuvuudet();
    await valimuistiin(r, 'config.json');
    r.lupa.mockReturnValue(false);
    for (const [metodi, alue] of [
      ['GET', null],
      ['HEAD', null],
      ['GET', 'bytes=0-0'],
    ] as const) {
      const { vastaus } = await kasitteleMallipyynto(url('puuttuva.json'), metodi, r, alue);
      expect(vastaus.status, `${metodi} ${alue}`).toBe(403);
    }
    expect(r.hae).not.toHaveBeenCalled();
    const { vastaus } = await kasitteleMallipyynto(url('config.json'), 'GET', r);
    expect(vastaus.status).toBe(200);
    expect(vastaus.headers.get('accept-ranges')).toBe('bytes');
    expect(await vastaus.text()).toBe('painot');
    expect(tiedostot(join(r.juuri, '.tmp'))).toEqual([]);
  });

  it('ilman lupaa ei liity keskeneräiseen lataukseen', async () => {
    let kontrolli: ReadableStreamDefaultController<Uint8Array> | undefined;
    const r = riippuvuudet(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              kontrolli = c;
            },
          }),
        ),
    );
    const a = await kasitteleMallipyynto(url('onnx/iso.onnx_data'), 'GET', r);
    const tekstiA = a.vastaus.text();
    r.lupa.mockReturnValue(false);
    const b = await kasitteleMallipyynto(url('onnx/iso.onnx_data'), 'GET', r);
    expect(b.vastaus.status).toBe(403);
    kontrolli?.close();
    await tekstiA;
    await a.tallennus;
    expect(r.hae).toHaveBeenCalledOnce();
  });
});
