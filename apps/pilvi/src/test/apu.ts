import { SELF } from 'cloudflare:test';
import type { HttpClient } from '../../../web/src/client/HttpClient.js';

export const POHJA = 'http://pilvi.local';

/** HttpClientin `api`-koukun tyyppi (web ja pilvi resolvoivat @ts-rest/coren eri peerillä). */
type ApiFetcher = NonNullable<NonNullable<ConstructorParameters<typeof HttpClient>[0]>['api']>;

/** JSON-pyyntö Workerille (SELF) ilman verkkoa. */
export async function pyynto(
  metodi: string,
  polku: string,
  { token, runko }: { token?: string; runko?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const otsakkeet: Record<string, string> = {};
  if (token) otsakkeet.authorization = `Bearer ${token}`;
  if (runko !== undefined) otsakkeet['content-type'] = 'application/json';
  const r = await SELF.fetch(`${POHJA}${polku}`, {
    method: metodi,
    headers: otsakkeet,
    ...(runko !== undefined ? { body: JSON.stringify(runko) } : {}),
  });
  const teksti = await r.text();
  return { status: r.status, body: teksti ? JSON.parse(teksti) : null };
}

/** Rekisteröi uusi käyttäjä yksilöllisellä sähköpostilla; palauttaa tokenin ja id:n. */
export async function uusiKayttaja(): Promise<{ token: string; id: number }> {
  const r = await pyynto('POST', '/api/register', {
    runko: { email: `testi-${crypto.randomUUID()}@esimerkki.fi`, salasana: 'salasana1' },
  });
  if (r.status !== 201) throw new Error(`rekisteröinti epäonnistui: ${r.status}`);
  const { token, kayttaja } = r.body as { token: string; kayttaja: { id: number } };
  return { token, id: kayttaja.id };
}

/** Luo kirja (POST /api/kirjat) käyttäjälle; palauttaa kirjaId:n. */
export async function uusiKirja(token: string, siemen?: unknown): Promise<string> {
  const r = await pyynto('POST', '/api/kirjat', {
    token,
    runko: siemen !== undefined ? { siemen } : {},
  });
  if (r.status !== 201) throw new Error(`kirjan luonti epäonnistui: ${r.status}`);
  return (r.body as { kirjaId: string }).kirjaId;
}

/** ts-rest ApiFetcher, joka ohjaa HttpClientin kutsut Workerille (SELF.fetch). */
export const selfFetcher: ApiFetcher = async (args) => {
  const r = await SELF.fetch(args.path, {
    method: args.method,
    headers: args.headers,
    ...(args.body != null ? { body: args.body as string } : {}),
  });
  const ct = r.headers.get('content-type') ?? '';
  const teksti = await r.text();
  const body = ct.includes('json') ? (teksti ? JSON.parse(teksti) : null) : teksti;
  return { status: r.status, body, headers: new Headers(r.headers) };
};
