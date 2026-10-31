import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Tier 5a:n salasanatiiviste (packages/control/src/salasana.ts): scrypt N=16384, r=8, p=1, 64 t.
const PARAMS = { N: 16384, r: 8, p: 1 };

function scryptAsync(selko: string, suola: Uint8Array, pituus: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(selko, suola, pituus, PARAMS, (err, t) => (err ? reject(err) : resolve(t))),
  );
}

describe('node:crypto scrypt workerdissä (nodejs_compat)', () => {
  it('tuottaa RFC 7914 -testivektorin 5a:n parametreilla (sama tulos kuin Nodessa)', async () => {
    const t = await scryptAsync('pleaseletmein', Buffer.from('SodiumChloride'), 64);
    expect(t.toString('hex')).toBe(
      '7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2' +
        'd5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887',
    );
    expect(scryptSync('pleaseletmein', 'SodiumChloride', 64, PARAMS).equals(t)).toBe(true);
  });

  it('hash + vakioaikainen tarkistus kulkee kuten 5a:n tarkistaSalasana', async () => {
    const suola = randomBytes(16);
    const tiiviste = await scryptAsync('salainen', suola, 64);
    expect(timingSafeEqual(tiiviste, await scryptAsync('salainen', suola, 64))).toBe(true);
    expect(timingSafeEqual(tiiviste, await scryptAsync('väärä', suola, 64))).toBe(false);
  });
});
