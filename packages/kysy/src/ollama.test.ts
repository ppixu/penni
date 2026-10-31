import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { luoOllamaKutsu, varmistaKysyOllama } from './ollama.js';
import { OLETUS_ASETUKSET, type OllamaTyokalu, type OllamaViesti } from './tyypit.js';

const asetukset = { ...OLETUS_ASETUKSET };
const viestit: OllamaViesti[] = [{ role: 'user', content: 'Paljonko kassassa on rahaa?' }];
const tyokalut: OllamaTyokalu[] = [
  { type: 'function', function: { name: 'kassa', description: 'kassan saldo', parameters: {} } },
];

/** Vastaa Ollaman onnistunutta /api/chat-vastausta, ilman verkkoa (fetch on mockattu). */
const ollamaVastaus = (sisalto: string): Response =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ message: { role: 'assistant', content: sisalto } }),
    text: () => Promise.resolve(''),
  }) as unknown as Response;

describe('luoOllamaKutsu: pyynnön runko', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lähettää työkalut, lämpötilan 0 ja stream:false, ei format-kenttää', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ollamaVastaus('vastaus'));
    vi.stubGlobal('fetch', fetchMock);

    const kutsu = luoOllamaKutsu();
    await kutsu(viestit, tyokalut, asetukset);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const kutsuparametrit = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(kutsuparametrit[0]).toBe(asetukset.url);
    const runko = JSON.parse(kutsuparametrit[1].body as string);
    expect(runko.model).toBe(asetukset.malli);
    expect(runko.stream).toBe(false);
    expect(runko.think).toBe(asetukset.ajattelu);
    expect(runko.options).toEqual({ temperature: 0, num_predict: 1000 });
    expect(runko.tools).toEqual(tyokalut);
    expect('format' in runko).toBe(false);
  });

  it('jättää tools-avaimen kokonaan pois kun tyokalut on undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ollamaVastaus('vastaus'));
    vi.stubGlobal('fetch', fetchMock);

    const kutsu = luoOllamaKutsu();
    await kutsu(viestit, undefined, asetukset);

    const kutsuparametrit = fetchMock.mock.calls[0] as [string, RequestInit];
    const runko = JSON.parse(kutsuparametrit[1].body as string);
    expect('tools' in runko).toBe(false);
  });

  it('nostaa budjetin 3000:een kun ajattelu on päällä', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ollamaVastaus('vastaus'));
    vi.stubGlobal('fetch', fetchMock);

    const kutsu = luoOllamaKutsu();
    await kutsu(viestit, undefined, { ...asetukset, ajattelu: true });

    const kutsuparametrit = fetchMock.mock.calls[0] as [string, RequestInit];
    const runko = JSON.parse(kutsuparametrit[1].body as string);
    expect(runko.think).toBe(true);
    expect(runko.options).toEqual({ temperature: 0, num_predict: 3000 });
  });
});

describe('luoOllamaKutsu: HTTP-tason virheet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('HTTP-virhevastaus heittää KysyVirhe(kutsu), statuskoodi mukana viestissä', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('{"error":"model requires more system memory"}'),
        json: () => Promise.reject(new Error('ei pitäisi kutsua')),
      } as unknown as Response),
    );
    const kutsu = luoOllamaKutsu();
    await expect(kutsu(viestit, undefined, asetukset)).rejects.toMatchObject({
      name: 'KysyVirhe',
      koodi: 'kutsu',
      message: expect.stringContaining('500'),
    });
  });

  it('verkkovirhe (fetch hylkää) heittää KysyVirhe(kutsu)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434')),
    );
    const kutsu = luoOllamaKutsu();
    await expect(kutsu(viestit, undefined, asetukset)).rejects.toMatchObject({
      name: 'KysyVirhe',
      koodi: 'kutsu',
    });
  });

  it('puuttuva message-kenttä vastauksessa heittää KysyVirhe(kutsu)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ done_reason: 'stop' }),
        text: () => Promise.resolve(''),
      } as unknown as Response),
    );
    const kutsu = luoOllamaKutsu();
    await expect(kutsu(viestit, undefined, asetukset)).rejects.toMatchObject({
      name: 'KysyVirhe',
      koodi: 'kutsu',
    });
  });

  it('virheellinen message (content puuttuu) heittää KysyVirhe(kutsu)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ message: { role: 'assistant' } }),
        text: () => Promise.resolve(''),
      } as unknown as Response),
    );
    const kutsu = luoOllamaKutsu();
    await expect(kutsu(viestit, undefined, asetukset)).rejects.toMatchObject({
      name: 'KysyVirhe',
      koodi: 'kutsu',
    });
  });
});

describe('varmistaKysyOllama', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('läpäisee kun malli löytyy /api/tags-listalta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ models: [{ name: asetukset.malli }] }),
      } as unknown as Response),
    );
    await expect(varmistaKysyOllama(asetukset)).resolves.toBeUndefined();
  });

  it('kysyy /api/tags-osoitteesta (kirjoittaa /api/chat-päätteen uusiksi)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ models: [{ name: asetukset.malli }] }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await varmistaKysyOllama(asetukset);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.anything());
  });

  it('malli ei ole ladattu → KysyVirhe(kutsu) jonka korjaus sisältää "ollama pull"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ models: [{ name: 'jokumuu:malli' }] }),
      } as unknown as Response),
    );
    await expect(varmistaKysyOllama(asetukset)).rejects.toMatchObject({
      name: 'KysyVirhe',
      koodi: 'kutsu',
      korjaus: expect.stringContaining(`ollama pull ${asetukset.malli}`),
    });
  });

  it('yhteys epäonnistuu → KysyVirhe(kutsu) jonka korjaus sisältää "ollama pull"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434')),
    );
    await expect(varmistaKysyOllama(asetukset)).rejects.toMatchObject({
      name: 'KysyVirhe',
      koodi: 'kutsu',
      korjaus: expect.stringContaining(`ollama pull ${asetukset.malli}`),
    });
  });
});

describe('luoOllamaKutsu: levyvälimuisti', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('kaksi identtistä kutsua osuu välimuistiin: fetch kutsutaan vain kerran', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kysy-cache-test-'));
    try {
      const fetchMock = vi.fn().mockResolvedValue(ollamaVastaus('sama vastaus'));
      vi.stubGlobal('fetch', fetchMock);

      const kutsu = luoOllamaKutsu(dir);
      const v1 = await kutsu(viestit, tyokalut, asetukset);
      const v2 = await kutsu(viestit, tyokalut, asetukset);

      expect(v1).toEqual(v2);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const tiedostot = readdirSync(dir);
      expect(tiedostot).toHaveLength(1);
      expect(tiedostot[0]).toMatch(/\.json$/);
      expect(tiedostot.some((t) => t.includes('.tmp-'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('eri viestit → eri välimuistiavain → kaksi fetch-kutsua', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kysy-cache-test-'));
    try {
      const fetchMock = vi.fn().mockResolvedValue(ollamaVastaus('vastaus'));
      vi.stubGlobal('fetch', fetchMock);

      const kutsu = luoOllamaKutsu(dir);
      await kutsu(viestit, tyokalut, asetukset);
      await kutsu([{ role: 'user', content: 'eri kysymys' }], tyokalut, asetukset);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(readdirSync(dir)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
