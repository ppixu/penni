/**
 * Näkömallin (VLM) ajoasetukset. Oletus tulee moottorin LUKUMALLI-vakiosta; vaihda MALLI_ID arvioidaksesi eri ehdokkaita.
 * Ehdokkaita (transformers.js/WebGPU-yhteensopivat ONNX-buildit):
 *   'onnx-community/Qwen3.5-0.8B-ONNX'       (OLETUS: pieni monimodaali Qwen 3.5, kvantisoitu; virallinen webml-community/Qwen3.5-WebGPU-demo; selvästi parempi kuin SmolVLM. dtype alla.)
 *   'huggingworld/Qwen3-VL-2B-Instruct-ONNX' (isompi/tarkempi Qwen3-VL 2B, q4f16)
 *   'onnx-community/gemma-4-E2B-it-ONNX'     (Gemma 4 E2B, ~500 Mt q4f16, ~4 Gt VRAM; MALLI_DTYPE = 'q4f16')
 *   'HuggingFaceTB/SmolVLM-256M-Instruct'    (pienin, nopea putken varmistus, MALLI_DTYPE = 'fp32' — liian heikko kuittien lukuun)
 * HUOM: repossa on oltava transformers.js-yhteensopivat ONNX-tiedostot (väärä repo → 401 "Unauthorized").
 * Tuorein malli (Qwen3.5) voi vaatia tuoreimman @huggingface/transformers-version — päivitä, jos lataus
 * kaatuu virheeseen "Unsupported model type".
 */
import { LUKUMALLI } from '@penni/engine';
export const MALLI_ID = LUKUMALLI.id;
/** Kiinnitetty revisio: painot eivät vaihdu alta, ja työpöydän välimuisti sallii vain tämän. */
export const MALLI_REVISIO = LUKUMALLI.revisio;

/**
 * ONNX-tarkkuus. Qwen3.5-0.8B: moduulikohtainen kvantisointi (q4-runko + fp16-näköenkooderi).
 * Yksinkertaisemmille malleille käy myös yhden merkkijonon dtype (esim. 'fp32' | 'q4' | 'q4f16').
 */
export const MALLI_DTYPE = {
  embed_tokens: 'q4',
  decoder_model_merged: 'q4',
  vision_encoder: 'fp16',
} as const;

export const MALLI_LAITE = 'webgpu' as const;

export const MAKS_UUDET_TOKENIT = 512;
