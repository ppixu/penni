import type { Liite } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { decodeLiite, decodeLiiteMeta, encodeLiite } from './liite.js';

describe('liite-koodekki', () => {
  it('encode -> decode kiertää datan tavulleen (base64-väylä)', () => {
    const liite: Liite = {
      id: 5,
      tosite: 3,
      nimi: 'kuitti.pdf',
      tyyppi: 'application/pdf',
      luotu: '2026-06-01T00:00:00.000Z',
      data: new Uint8Array([0x00, 0xff, 0x10]),
    };
    const wire = encodeLiite(liite);
    expect(typeof wire.data).toBe('string'); // base64
    const takaisin = decodeLiite(wire);
    expect(takaisin.data).toEqual(liite.data);
    expect(takaisin.id).toBe(5);
    expect(takaisin.tosite).toBe(3);
  });

  it('decode pakottaa id/tosite numeroiksi wire-stringistä', () => {
    const takaisin = decodeLiite({
      id: '7',
      tosite: '9',
      nimi: 'a.pdf',
      tyyppi: 'image/png',
      luotu: '2026-06-01T00:00:00.000Z',
      data: '',
    });
    expect(takaisin.id).toBe(7);
    expect(takaisin.tosite).toBe(9);
    expect(takaisin.data).toEqual(new Uint8Array(0));
  });

  it('decodeLiiteMeta jättää datan pois', () => {
    const meta = decodeLiiteMeta({ id: 1, tosite: 2, nimi: 'a', tyyppi: 't', luotu: 'x' });
    expect((meta as { data?: unknown }).data).toBeUndefined();
    expect(meta.tosite).toBe(2);
  });
});
