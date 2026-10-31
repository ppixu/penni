import { describe, expect, it } from 'vitest';
import { poimiVastaus } from './vastaus.js';

describe('poimiVastaus', () => {
  it('poimii assistentin tekstin viestilistasta', () => {
    const tulos = [
      {
        generated_text: [
          { role: 'user', content: 'kuva' },
          { role: 'assistant', content: '{"valuutta":"EUR"}' },
        ],
      },
    ];
    expect(poimiVastaus(tulos)).toBe('{"valuutta":"EUR"}');
  });

  it('poimii tekstin content-taulukosta', () => {
    const tulos = [
      { generated_text: [{ role: 'assistant', content: [{ type: 'text', text: 'hei' }] }] },
    ];
    expect(poimiVastaus(tulos)).toBe('hei');
  });

  it('palauttaa merkkijonon sellaisenaan', () => {
    expect(poimiVastaus('pelkkä teksti')).toBe('pelkkä teksti');
  });

  it('palauttaa tyhjän merkkijonon kun tulos on undefined', () => {
    expect(poimiVastaus(undefined)).toBe('');
  });
});
