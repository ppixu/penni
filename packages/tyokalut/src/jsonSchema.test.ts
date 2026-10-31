import { describe, expect, it } from 'vitest';
import { tyokalutJsonSchema } from './jsonSchema.js';
import { kaikkiTyokalut } from './rekisteri.js';

describe('tyokalutJsonSchema', () => {
  it('dumps every registered tool with a JSON Schema input', () => {
    const dump = tyokalutJsonSchema();
    expect(dump.versio).toBe(1);
    expect(dump.tyokalut.map((t) => t.nimi).sort()).toEqual(
      kaikkiTyokalut.map((t) => t.nimi).sort(),
    );
    const saldot = dump.tyokalut.find((t) => t.nimi === 'saldot');
    expect(saldot?.kirjoittava).toBe(false);
    const schema = saldot?.syote as { properties?: Record<string, unknown> };
    expect(schema.properties).toHaveProperty('pvm');
    expect(JSON.parse(JSON.stringify(dump))).toEqual(dump); // fully serializable
  });
});
