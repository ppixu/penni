import type { HyvityslaskuSyote } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { decodeHyvityslaskuSyote, encodeHyvityslaskuSyote } from './hyvityslasku.js';

describe('hyvityslasku codec', () => {
  it('round-trips the syote', () => {
    const s: HyvityslaskuSyote = { alkuperainenTosite: 42, pvm: '2026-03-15', otsikko: 'Hyvitys' };
    expect(decodeHyvityslaskuSyote(encodeHyvityslaskuSyote(s))).toEqual(s);
  });
});
