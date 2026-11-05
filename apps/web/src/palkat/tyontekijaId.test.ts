import { describe, expect, it } from 'vitest';
import { uusiTyontekijaId } from './tyontekijaId';

describe('uusiTyontekijaId', () => {
  it('on 8 merkkiä merkistöstä [0-9a-z]', () => {
    for (let i = 0; i < 200; i++) expect(uusiTyontekijaId()).toMatch(/^[0-9a-z]{8}$/);
  });
  it('ei toista jo käytössä olevaa tunnusta', () => {
    const kaytossa = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = uusiTyontekijaId(kaytossa);
      expect(kaytossa.has(id)).toBe(false);
      kaytossa.add(id);
    }
  });
});
