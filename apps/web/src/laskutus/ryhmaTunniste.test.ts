import { describe, expect, it, vi } from 'vitest';
import { uusiRyhmaTunniste } from './ryhmaTunniste';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uusiRyhmaTunniste', () => {
  it('käyttää crypto.randomUUID:ta, kun se on saatavilla (suojattu yhteys)', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555' as const);
    expect(
      uusiRyhmaTunniste({ randomUUID, getRandomValues: crypto.getRandomValues.bind(crypto) }),
    ).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('pelkällä HTTP:llä (ei randomUUID:ta) muodostaa v4-UUID:n getRandomValuesilla', () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    const a = uusiRyhmaTunniste({ getRandomValues });
    const b = uusiRyhmaTunniste({ getRandomValues });
    expect(a).toMatch(UUID_V4);
    expect(b).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });

  it('ilman crypto-rajapintaa tunniste on silti UUID-muotoinen', () => {
    expect(uusiRyhmaTunniste(null)).toMatch(UUID_V4);
  });
});
