import { lueTyokalut } from '@penni/tyokalut';
import { z } from 'zod/v4';
import type { OllamaTyokalu } from './tyypit.js';

/** Converts the read-tool registry (never the write tool) to Ollama's tool-calling format. */
export function lueTyokalutOllamalle(): OllamaTyokalu[] {
  return lueTyokalut.map((t) => ({
    type: 'function',
    function: {
      name: t.nimi,
      description: t.kuvaus,
      parameters: z.toJSONSchema(t.syote),
    },
  }));
}
