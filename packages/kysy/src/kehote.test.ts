import { describe, expect, it } from 'vitest';
import { rakennaKysyKehote } from './kehote.js';

it('embeds book facts and the ground rules', () => {
  const kehote = rakennaKysyKehote({ nimi: 'Testi Oy', pvm: '2026-08-15' });
  expect(kehote).toContain('Olet kirjanpitäjä');
  expect(kehote).toContain('Testi Oy');
  expect(kehote).toContain('2026-08-15');
  expect(kehote).toContain('en tiedä');
});

it('includes the tool-selection guide', () => {
  const kehote = rakennaKysyKehote({ nimi: 'Testi Oy' });
  expect(kehote).toContain('Työkalun valinta');
  expect(kehote).toContain('saldot:');
  expect(kehote).toContain('lukumaara-kentän');
});
