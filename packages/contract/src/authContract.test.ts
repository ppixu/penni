import { describe, expect, it } from 'vitest';
import { authContract } from './authContract.js';
import { RekisterointiSyoteSchema, TunnistusVastausSchema } from './schema/auth.js';

describe('authContract', () => {
  it('reitit ja metodit', () => {
    expect(authContract.rekisteroi.method).toBe('POST');
    expect(authContract.rekisteroi.path).toBe('/register');
    expect(authContract.kirjaudu.path).toBe('/login');
    expect(authContract.mina.method).toBe('GET');
    expect(authContract.vaihdaSalasana.path).toBe('/vaihda-salasana');
  });
  it('skeema validoi ja hylkää', () => {
    expect(RekisterointiSyoteSchema.safeParse({ email: 'a@b.fi', salasana: 'x' }).success).toBe(
      true,
    );
    expect(RekisterointiSyoteSchema.safeParse({ email: 'a@b.fi' }).success).toBe(false);
    expect(
      TunnistusVastausSchema.safeParse({
        kayttaja: { id: 1, email: 'a@b.fi' },
        token: 't',
      }).success,
    ).toBe(true);
  });
});
