import { authContract } from '@penni/contract';
import { type ApiFetcher, initClient } from '@ts-rest/core';

export function tunnistusViesti(koodi: string): string {
  switch (koodi) {
    case 'EMAIL_VARATTU':
      return 'Sähköposti on jo käytössä';
    case 'EPAKELPO_EMAIL':
      return 'Tarkista sähköpostiosoite';
    case 'HEIKKO_SALASANA':
      return 'Salasanan on oltava vähintään 8 merkkiä';
    case 'VAARA_TUNNUS':
      return 'Väärä sähköposti tai salasana';
    case 'EI_SESSIOTA':
      return 'Istunto on vanhentunut, kirjaudu uudelleen';
    default:
      return 'Tunnistautuminen epäonnistui';
  }
}

export interface Kayttaja {
  id: number;
  email: string;
  nimi?: string;
}

function virheeksi(body: unknown): Error {
  const koodi =
    body &&
    typeof body === 'object' &&
    'koodi' in body &&
    typeof (body as { koodi: unknown }).koodi === 'string'
      ? (body as { koodi: string }).koodi
      : '';
  return new Error(tunnistusViesti(koodi));
}

export interface AuthClientOptions {
  baseUrl: string;
  token?: string;
  api?: ApiFetcher;
}

export function luoAuthClient(opts: AuthClientOptions) {
  const tsr = initClient(authContract, {
    baseUrl: opts.baseUrl,
    baseHeaders: opts.token ? { authorization: `bearer ${opts.token}` } : {},
    ...(opts.api ? { api: opts.api } : {}),
  });
  return {
    async rekisteroi(syote: { email: string; salasana: string; nimi?: string }): Promise<{
      kayttaja: Kayttaja;
      token: string;
    }> {
      const r = await tsr.rekisteroi({ body: syote });
      if (r.status === 201) return r.body as { kayttaja: Kayttaja; token: string };
      throw virheeksi(r.body);
    },
    async kirjaudu(syote: { email: string; salasana: string }): Promise<{
      kayttaja: Kayttaja;
      token: string;
    }> {
      const r = await tsr.kirjaudu({ body: syote });
      if (r.status === 200) return r.body as { kayttaja: Kayttaja; token: string };
      throw virheeksi(r.body);
    },
    async haeMinut(): Promise<Kayttaja> {
      const r = await tsr.mina();
      if (r.status === 200) return (r.body as { kayttaja: Kayttaja }).kayttaja;
      throw virheeksi(r.body);
    },
    async kirjauduUlos(): Promise<void> {
      await tsr.kirjauduUlos({ body: {} });
    },
    async vaihdaSalasana(syote: { vanhaSalasana: string; uusiSalasana: string }): Promise<void> {
      const r = await tsr.vaihdaSalasana({ body: syote });
      if (r.status !== 200) throw virheeksi(r.body);
    },
  };
}
