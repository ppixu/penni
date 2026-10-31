import { tsRestFetchApi } from '@ts-rest/core';
import { HttpClient } from '../../web/src/client/HttpClient.js';

/**
 * HttpClientin `api`-koukun tyyppi johdetaan HttpClientista itsestään: web ja pilvi resolvoivat
 * `@ts-rest/core`:n eri @types/node-peerillä (kaksi instanssia), joten pilvin oma `ApiFetcher`
 * ei olisi sijoitettavissa webin tyyppiin. Ajonaikaisesti instanssi on sama koodi.
 */
type ApiFetcher = NonNullable<NonNullable<ConstructorParameters<typeof HttpClient>[0]>['api']>;

/** Kirjautunut käyttäjä paikallista Workeria vasten. */
export interface Istunto {
  pohja: string;
  token: string;
}

/** Yksi HTTP-pyyntö kuten asiakas sen kokee (haku + vastauksen luku). */
export interface PyyntoMitta {
  polku: string;
  metodi: string;
  status: number;
  ms: number;
}

/** Asiakkaan puolen laskuri ja mittapuskuri; HttpClient kutsuu sitä jokaisesta pyynnöstä. */
export interface PyyntoLaskuri {
  pyynnot: number;
  mitat: PyyntoMitta[];
}

export const uusiLaskuri = (): PyyntoLaskuri => ({ pyynnot: 0, mitat: [] });

async function json(r: Response): Promise<unknown> {
  const teksti = await r.text();
  return teksti ? JSON.parse(teksti) : null;
}

/** Rekisteröi uusi käyttäjä (5a: POST /api/register) ja palauta istunto. */
export async function rekisteroi(pohja: string): Promise<Istunto> {
  const r = await fetch(`${pohja}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `mittaus-${crypto.randomUUID()}@esimerkki.fi`,
      salasana: `mittaus-${crypto.randomUUID()}`,
    }),
  });
  if (r.status !== 201) throw new Error(`rekisteröinti epäonnistui: ${r.status}`);
  const { token } = (await json(r)) as { token: string };
  return { pohja, token };
}

/**
 * Luo kirja ja palauta kirjaId. Oletuksena ilman siementä (tuonti täyttää); `oletussiemenella`
 * antaa Workerin oletussiemenen (yritys-tilikartta ja kuluvan vuoden tilikausi).
 */
export async function luoTyhjaKirja(istunto: Istunto, oletussiemenella = false): Promise<string> {
  const r = await fetch(`${istunto.pohja}/api/kirjat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${istunto.token}` },
    body: JSON.stringify(oletussiemenella ? {} : { siemen: {} }),
  });
  if (r.status !== 201) throw new Error(`kirjan luonti epäonnistui: ${r.status}`);
  return ((await json(r)) as { kirjaId: string }).kirjaId;
}

/**
 * HttpClient (apps/web) kirjaa vasten. Jokainen HTTP-pyyntö kirjataan laskuriin (määrä + aika),
 * joten kutsukohtaiset ajat ja pyyntömäärä saadaan samasta sovelluskerroksen reitistä kuin
 * selaimessa.
 */
export function luoClient(
  istunto: Istunto,
  kirjaId: string,
  laskuri: PyyntoLaskuri = uusiLaskuri(),
): HttpClient {
  const api: ApiFetcher = async (args) => {
    const alku = performance.now();
    laskuri.pyynnot++;
    const vastaus = await tsRestFetchApi(args as unknown as Parameters<typeof tsRestFetchApi>[0]);
    laskuri.mitat.push({
      polku: args.route.path,
      metodi: args.method,
      status: vastaus.status,
      ms: performance.now() - alku,
    });
    return vastaus;
  };
  return new HttpClient({
    baseUrl: `${istunto.pohja}/api/kirjat/${kirjaId}`,
    baseHeaders: { authorization: `Bearer ${istunto.token}` },
    api,
  });
}

/** Kehitysreitti (tuonti, yhteenveto, laskurit, lokimäärät). Heittää ei-2xx:llä. */
export async function kehitysPyynto<T>(
  istunto: Istunto,
  kirjaId: string,
  metodi: 'GET' | 'POST',
  loppu: string,
  runko?: unknown,
): Promise<T> {
  const r = await fetch(`${istunto.pohja}/api/kirjat/${kirjaId}/kehitys/${loppu}`, {
    method: metodi,
    headers: {
      authorization: `Bearer ${istunto.token}`,
      ...(runko !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(runko !== undefined ? { body: JSON.stringify(runko) } : {}),
  });
  const vastaus = await json(r);
  if (!r.ok) {
    throw new Error(`kehitys/${loppu}: ${r.status} ${JSON.stringify(vastaus).slice(0, 300)}`);
  }
  return vastaus as T;
}

/** Worker- ja DO-laskurit (apps/pilvi/src/kehitys.ts); `nollaa` palauttaa ja nollaa. */
export interface LaskuriVastaus {
  worker: {
    pyynnot: number;
    kirjaPyynnot: number;
    authPyynnot: number;
    kirjaDoKutsut: number;
    kirjaDoReiteittain: Record<string, number>;
    controlDoKutsut: number;
    controlDoMetodeittain: Record<string, number>;
  };
  kirja: {
    esiintyma: string;
    kasittelyja: number;
    kasittelyMs: number;
    sqlLauseita: number;
    rowsRead: number;
    rowsWritten: number;
    r2: { head: number; put: number; get: number; putTavut: number; getTavut: number };
  } | null;
}

export const haeLaskurit = (
  istunto: Istunto,
  kirjaId: string,
  nollaa: boolean,
): Promise<LaskuriVastaus> =>
  kehitysPyynto<LaskuriVastaus>(
    istunto,
    kirjaId,
    nollaa ? 'POST' : 'GET',
    'laskurit',
    nollaa ? {} : undefined,
  );
