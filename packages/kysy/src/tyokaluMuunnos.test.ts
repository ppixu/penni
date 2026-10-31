import { lueTyokalut } from '@penni/tyokalut';
import { describe, expect, it } from 'vitest';
import { lueTyokalutOllamalle } from './tyokaluMuunnos.js';

it('converts exactly the read tools, never the write tool', () => {
  const tyokalut = lueTyokalutOllamalle();
  expect(tyokalut.map((t) => t.function.name).sort()).toEqual(
    lueTyokalut.map((t) => t.nimi).sort(),
  );
  expect(tyokalut.some((t) => t.function.name === 'tosite_luonnos')).toBe(false);
  const saldot = tyokalut.find((t) => t.function.name === 'saldot');
  expect(saldot?.function.description.length).toBeGreaterThan(20);
  expect((saldot?.function.parameters as { properties?: object }).properties).toHaveProperty('pvm');
});
