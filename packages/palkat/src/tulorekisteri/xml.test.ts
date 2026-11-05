import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { PalkatVirhe } from '../taulukot.js';
import { escapeXml, euroa, sha256Hex } from './xml.js';

describe('xml-apurit', () => {
  it('euroa: sentit -> "1234.56" ilman liukulukuja', () => {
    expect(euroa(220_366 as Cents)).toBe('2203.66');
    expect(euroa(5 as Cents)).toBe('0.05');
    expect(euroa(0 as Cents)).toBe('0.00');
    expect(euroa(-1234 as Cents)).toBe('-12.34');
    expect(euroa(900_719_925_474_099 as Cents)).toBe('9007199254740.99');
    expect(() => euroa(1.5 as Cents)).toThrow(PalkatVirhe);
  });

  it('escapeXml', () => {
    expect(escapeXml(`a & b < c > d "e" 'f'`)).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;',
    );
  });

  it('sha256Hex (WebCrypto)', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    // UTF-8-tavut (c3 a4), ei UTF-16
    expect(await sha256Hex('ä')).toBe(
      '33e6d73fee82904c8d7afb78de1154d1e8dc2a0edb08120e63df5b9385c2d9cc',
    );
  });
});
