import { LUKUMALLI, MALLI_ISANTA } from '@penni/engine';
import { describe, expect, it, vi } from 'vitest';
import { kytkeMallinHaku, luoMallinHaku, mallinOsoite } from './mallinOsoite.js';

const HF = 'https://huggingface.co/';
const KIINNITETTY = `${LUKUMALLI.id}/resolve/${LUKUMALLI.revisio}`;

describe('mallinOsoite', () => {
  it('kiinnittää lukumallin revision ja pitää https-isännän selaimessa', () => {
    expect(mallinOsoite(`${HF}${LUKUMALLI.id}/resolve/main/tokenizer_config.json`)).toBe(
      `${HF}${KIINNITETTY}/tokenizer_config.json`,
    );
    expect(mallinOsoite(`${HF}${LUKUMALLI.id}/resolve/${LUKUMALLI.revisio}/onnx/a.onnx`)).toBe(
      `${HF}${KIINNITETTY}/onnx/a.onnx`,
    );
  });

  it('ohjaa lukumallin haut annetun isännän kautta', () => {
    expect(
      mallinOsoite(`${HF}${LUKUMALLI.id}/resolve/jokin-haara/onnx/a.onnx_data`, MALLI_ISANTA),
    ).toBe(`${MALLI_ISANTA}${KIINNITETTY}/onnx/a.onnx_data`);
  });

  it('jättää muut osoitteet koskematta', () => {
    for (const osoite of [
      `${HF}onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/config.json`,
      `${HF}${LUKUMALLI.id}-toinen/resolve/main/config.json`,
      `${HF}${LUKUMALLI.id}/raw/main/config.json`,
      `${HF}${LUKUMALLI.id}/resolve/main`,
      `http://huggingface.co/${LUKUMALLI.id}/resolve/main/config.json`,
      'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm.wasm',
    ]) {
      expect(mallinOsoite(osoite, MALLI_ISANTA), osoite).toBe(osoite);
    }
  });
});

describe('luoMallinHaku', () => {
  it('välittää metodin ja otsakkeet (myös Range) muutettuun osoitteeseen', async () => {
    const haku = vi.fn(async () => new Response(null, { status: 206 }));
    const otsakkeet = new Headers({ Range: 'bytes=0-0' });
    const init = { method: 'GET', headers: otsakkeet, cache: 'no-store' as const };
    await luoMallinHaku(haku, MALLI_ISANTA)(
      new URL(`${HF}${LUKUMALLI.id}/resolve/main/config.json`),
      init,
    );
    expect(haku).toHaveBeenCalledWith(`${MALLI_ISANTA}${KIINNITETTY}/config.json`, init);
  });

  it('kytkee haun ja välimuistiasetuksen ympäristöön', () => {
    const perus = vi.fn(async () => new Response('{}'));
    const env = { fetch: perus as unknown, useBrowserCache: true };
    kytkeMallinHaku(env, { kautta: MALLI_ISANTA, selainValimuisti: false }, perus);
    expect(env.useBrowserCache).toBe(false);
    expect(env.fetch).not.toBe(perus);
  });
});
