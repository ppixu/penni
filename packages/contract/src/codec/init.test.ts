import type { InitBundle } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { decodeInit, encodeInit } from './init.js';

const bundle: InitBundle = {
  asetukset: { Nimi: 'Oy Esimerkki', AlvVelvollinen: 'true' },
  tilit: [
    { numero: 1, tyyppi: 'H1', nimi: { fi: 'VASTAAVAA' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' }, laajuus: 1 },
  ],
  tilikaudet: [{ alkaa: '2025-01-01', loppuu: '2025-12-31' }],
  tositesarjat: ['', 'KP'],
  kohdennukset: [],
};

describe('init codec', () => {
  it('encode adds an empty kierrot array and keeps the 6 bundle keys', () => {
    const w = encodeInit(bundle);
    expect(w.kierrot).toEqual([]);
    expect(Object.keys(w).sort()).toEqual(
      ['asetukset', 'kierrot', 'kohdennukset', 'tilikaudet', 'tilit', 'tositesarjat'].sort(),
    );
  });

  it('round-trips the bundle (ignoring the read-only kierrot)', () => {
    const back = decodeInit(encodeInit(bundle));
    expect(back.asetukset).toEqual(bundle.asetukset);
    expect(back.tilikaudet).toEqual(bundle.tilikaudet);
    expect(back.tositesarjat).toEqual(bundle.tositesarjat);
    expect(back.tilit.map((t) => (t as { numero: unknown }).numero)).toEqual([1, 1900]);
  });
});
