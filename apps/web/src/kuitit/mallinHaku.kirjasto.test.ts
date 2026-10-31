/*
 * Ajaa transformers.js:n oikean hub- ja tokenisoijatiedostojen selvityksen (ei GPU:ta) väärennetyn
 * verkon päällä samalla kytkennällä kuin päättelytyöntekijä (kytkeMallinHaku). Varmistaa, että
 * kirjaston Range-tunnustelu ja tiedostohaut osuvat kiinnitettyyn revisioon ja työpöydällä
 * `penni-malli://hf/`-isäntään, ja että muiden mallien osoitteet kulkevat koskematta.
 */
import { AutoTokenizer, ModelRegistry, env } from '@huggingface/transformers';
import { LUKUMALLI, MALLI_ISANTA } from '@penni/engine';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type MallinHaku, kytkeMallinHaku } from './mallinOsoite.js';
import { TEKSTI_MALLI_ID } from './teksti-malli.js';

const HF = 'https://huggingface.co/';
const KIINNITETTY = `${LUKUMALLI.id}/resolve/${LUKUMALLI.revisio}/`;

const TIEDOSTOT: Record<string, unknown> = {
  'tokenizer_config.json': { tokenizer_class: 'PreTrainedTokenizer', model_max_length: 8 },
  'tokenizer.json': {
    version: '1.0',
    model: { type: 'WordLevel', vocab: { kuitti: 0, '[UNK]': 1 }, unk_token: '[UNK]' },
    normalizer: null,
    pre_tokenizer: { type: 'Whitespace' },
    post_processor: null,
    decoder: { type: 'Fuse' },
    added_tokens: [],
  },
  'preprocessor_config.json': {},
};

interface Kutsu {
  osoite: string;
  metodi: string;
  alue: string | null;
}

/** Väärennetty verkko: Range-pyyntöön 206 ja content-range, muuten koko JSON. */
function verkko(): { haku: MallinHaku; kutsut: Kutsu[] } {
  const kutsut: Kutsu[] = [];
  const haku: MallinHaku = async (osoite, init) => {
    const alue = new Headers(init?.headers).get('range');
    kutsut.push({ osoite: String(osoite), metodi: init?.method ?? 'GET', alue });
    const nimi = String(osoite).split('/').at(-1) ?? '';
    const sisalto = TIEDOSTOT[nimi];
    if (sisalto === undefined) return new Response('ei', { status: 404 });
    const runko = JSON.stringify(sisalto);
    if (alue)
      return new Response(runko.slice(0, 1), {
        status: 206,
        headers: { 'content-range': `bytes 0-0/${runko.length}` },
      });
    return new Response(runko, { headers: { 'content-type': 'application/json' } });
  };
  return { haku, kutsut };
}

const alkuperainen = {
  fetch: env.fetch,
  useFS: env.useFS,
  useFSCache: env.useFSCache,
  allowLocalModels: env.allowLocalModels,
  useBrowserCache: env.useBrowserCache,
};

beforeAll(() => {
  // jsdomin Headers pudottaa Range-otsakkeen (selain ei pudota); Noden oma Headers säilyttää sen.
  vi.stubGlobal('Headers', new Response('').headers.constructor);
  // Kuten selaimen työntekijässä: ei paikallisia tiedostoja eikä levyvälimuistia.
  env.useFS = false;
  env.useFSCache = false;
  env.allowLocalModels = false;
});

afterAll(() => {
  Object.assign(env, alkuperainen);
  vi.unstubAllGlobals();
});

describe('lukumallin haut transformers.js:n läpi', () => {
  it('työpöydällä tokenisoija löytyy kiinnitetystä revisiosta penni-malli-isännän kautta', async () => {
    const { haku, kutsut } = verkko();
    kytkeMallinHaku(env, { kautta: MALLI_ISANTA, selainValimuisti: false }, haku);
    expect(env.remoteHost).toBe(HF);

    const tokenisoija = await AutoTokenizer.from_pretrained(LUKUMALLI.id, {
      revision: LUKUMALLI.revisio,
    });

    expect(tokenisoija.encode('kuitti')).toEqual([0]);
    expect(kutsut).toContainEqual({
      osoite: `${MALLI_ISANTA}${KIINNITETTY}tokenizer_config.json`,
      metodi: 'GET',
      alue: 'bytes=0-0',
    });
    expect(kutsut.map((k) => k.osoite)).toContain(`${MALLI_ISANTA}${KIINNITETTY}tokenizer.json`);
    for (const k of kutsut) expect(k.osoite.startsWith(`${MALLI_ISANTA}${KIINNITETTY}`)).toBe(true);
  });

  it('selaimessa tunnustelu osuu kiinnitettyyn revisioon https-isännässä', async () => {
    const { haku, kutsut } = verkko();
    kytkeMallinHaku(env, { selainValimuisti: false }, haku);
    expect(await ModelRegistry.get_processor_files(LUKUMALLI.id)).toEqual([
      'preprocessor_config.json',
    ]);
    expect(kutsut).toEqual([
      { osoite: `${HF}${KIINNITETTY}preprocessor_config.json`, metodi: 'GET', alue: 'bytes=0-0' },
    ]);
  });

  it('muun mallin osoitteet kulkevat koskematta', async () => {
    const { haku, kutsut } = verkko();
    kytkeMallinHaku(env, { kautta: MALLI_ISANTA, selainValimuisti: false }, haku);
    await ModelRegistry.get_tokenizer_files(TEKSTI_MALLI_ID);
    expect(kutsut.map((k) => k.osoite)).toEqual([
      `${HF}${TEKSTI_MALLI_ID}/resolve/main/tokenizer_config.json`,
    ]);
  });
});
