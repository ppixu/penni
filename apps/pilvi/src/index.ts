import { LAHDEKOODI_POLKU, authContract, contract, lahdekoodiTarjous } from '@penni/contract';
import {
  type Kayttaja,
  TunnistusVirhe,
  haeMinut,
  kirjaudu,
  kirjauduUlos,
  rekisteroi,
  vaihdaSalasana,
} from '@penni/control/ydin';
import { tunnistusKoodiHttp } from '@penni/server/kasittelijat';
import type { SqliteCoreSeed } from '@penni/storage-sqlite-core';
import { TsRestHttpError, TsRestResponse, createFetchHandler } from '@ts-rest/serverless/fetch';
import { type ControlDO, type Kontrolli, kontrolliStubista } from './control-do.js';
import { kehitysReitti } from './kehitys-reitit.js';
import {
  type KehitysEnv,
  kasvata,
  laskevaProxy,
  laskuritPaalla,
  workerLaskurit,
} from './kehitys.js';
import type { KirjaDO, Konteksti, ReittiSyote } from './kirja-do.js';
import { LuoKirjaSyote, oletusSiemen } from './siemen.js';

export { ControlDO } from './control-do.js';
export { KirjaDO } from './kirja-do.js';

export interface Env extends KehitysEnv {
  KIRJA: DurableObjectNamespace<KirjaDO>;
  CONTROL: DurableObjectNamespace<ControlDO>;
  /** R2-bucket (EU-lainkäyttöalue) liitteiden tavuille; avain `kirja/<kirjaId>/liite/<sha256>`. */
  LIITTEET: R2Bucket;
  /**
   * '1' vain paikallisessa workerdissä (vitest-pool-workers, `pnpm dev`), joka ei toteuta
   * lainkäyttöalueita vaan heittää. Puuttuessa nimiavaruudet osoitetaan aina EU:hun (fail-safe).
   */
  PAIKALLINEN_WORKERD?: string;
  /**
   * Lähdekoodin osoite AGPL §13 -tarjoukseen (GET /lahdekoodi). Muokatun version ylläpitäjän on
   * asetettava oman lähdekoodinsa osoite; puuttuessa Pennin oma repo.
   */
  LAHDEKOODI_URL?: string;
}

const API = '/api';
/** /api/kirjat/:kirjaId/<sopimuksen polku>. kirjaId on palvelimen antama UUID. */
const KIRJA_POLKU = /^\/api\/kirjat\/([A-Za-z0-9-]{1,64})(\/.*)$/;

const kello = (): string => new Date().toISOString();

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

/** DO-nimiavaruus EU-lainkäyttöalueella (paikallinen workerd ohittaa, ks. PAIKALLINEN_WORKERD). */
function eu<T extends Rpc.DurableObjectBranded>(
  ns: DurableObjectNamespace<T>,
  env: Env,
): DurableObjectNamespace<T> {
  return env.PAIKALLINEN_WORKERD === '1' ? ns : ns.jurisdiction('eu');
}

/** Kontrollitaso: yksi Control DO EU-lainkäyttöalueella. */
function kontrolli(env: Env, laske = true): Kontrolli {
  const ns = eu(env.CONTROL, env);
  const k = kontrolliStubista(ns.get(ns.idFromName('control')));
  // Mittaus (PILVI_KEHITYS_LASKURIT): jokainen Kontrolli-metodi = yksi Control DO -RPC. Kehitys-
  // reitit (laskurien luku, tuonti) eivät laske itseään mukaan.
  return laske && laskuritPaalla(env)
    ? laskevaProxy(k, (metodi) => {
        workerLaskurit.controlDoKutsut++;
        kasvata(workerLaskurit.controlDoMetodeittain, metodi);
      })
    : k;
}

/** Kirjan DO: yksi per kirjaId, EU-lainkäyttöalueella. */
function kirjaStub(env: Env, kirjaId: string): DurableObjectStub<KirjaDO> {
  const ns = eu(env.KIRJA, env);
  return ns.get(ns.idFromName(kirjaId));
}

function bearer(request: Request): string {
  const otsake = request.headers.get('authorization') ?? '';
  return otsake.toLowerCase().startsWith('bearer ') ? otsake.slice(7) : '';
}

/**
 * Tunnista pyynnön käyttäjä (5a:n haeMinut Control DO:ta vasten). Palauttaa Responsen 401:lle;
 * muu kuin TunnistusVirhe (esim. Control DO:n katkos) heitetään ylös 500:ksi, kuten palvelimella.
 */
async function tunnista(request: Request, control: Kontrolli): Promise<Kayttaja | Response> {
  const token = bearer(request);
  if (!token) return json(401, { virhe: 'Kirjautuminen vaaditaan', koodi: 'EI_SESSIOTA' });
  try {
    return await haeMinut(control, token, { kello });
  } catch (e) {
    if (e instanceof TunnistusVirhe) {
      return json(401, { virhe: 'Istunto vanhentunut', koodi: 'EI_SESSIOTA' });
    }
    throw e;
  }
}

/**
 * ts-restin omat HTTP-virheet (esim. validointi 400) kulkevat läpi, TunnistusVirhe kuvataan kuten
 * palvelimella (409/400/401), muu odottamaton virhe → 500.
 */
function virheKasittelija(e: unknown): TsRestResponse | undefined {
  if (e instanceof TsRestHttpError) return undefined;
  if (e instanceof TunnistusVirhe) {
    return TsRestResponse.fromJson(
      { virhe: e.message, koodi: e.koodi },
      { status: tunnistusKoodiHttp(e.koodi) },
    );
  }
  console.error('[pilvi] odottamaton virhe', e);
  return TsRestResponse.fromJson({ virhe: 'Palvelinvirhe' }, { status: 500 });
}

interface AuthAlusta {
  control: Kontrolli;
}

/** authContract (5a) fetch-reitittimenä; logiikka on @penni/controlin, kuten Fastify-palvelimella. */
const authKasittelija = createFetchHandler<typeof authContract, object, AuthAlusta>(
  authContract,
  {
    rekisteroi: async ({ body: { email, salasana, nimi } }, { control }) => ({
      status: 201,
      body: await rekisteroi(
        control,
        { email, salasana, ...(nimi !== undefined ? { nimi } : {}) },
        { kello },
      ),
    }),
    kirjaudu: async ({ body }, { control }) => ({
      status: 200,
      body: await kirjaudu(control, body, { kello }),
    }),
    kirjauduUlos: async (_args, { control, request }) => {
      const token = bearer(request);
      if (!token) throw new TunnistusVirhe('EI_SESSIOTA');
      await kirjauduUlos(control, token);
      return { status: 200, body: null };
    },
    mina: async (_args, { control, request }) => ({
      status: 200,
      body: { kayttaja: await haeMinut(control, bearer(request), { kello }) },
    }),
    vaihdaSalasana: async ({ body }, { control, request }) => {
      const k = await haeMinut(control, bearer(request), { kello });
      await vaihdaSalasana(control, k.id, body, { kello });
      return { status: 200, body: null };
    },
  },
  { basePath: API, errorHandler: virheKasittelija },
);

interface KirjaAlusta {
  kirja: DurableObjectStub<KirjaDO>;
  konteksti: Konteksti;
  /** Mittauslaskurit päällä (PILVI_KEHITYS_LASKURIT). */
  laske: boolean;
}
type KirjaToteutus = Parameters<typeof createFetchHandler<typeof contract, object, KirjaAlusta>>[1];

/**
 * Kirjan sopimus (@penni/contract) fetch-reitittimenä: ts-rest jäsentää ja validoi pyynnön
 * sopimuksen mukaan, ja jokainen reitti välitetään nimellään Book DO:lle yhtenä RPC-kutsuna.
 * Sopimus on ainoa totuus: reittilista johdetaan siitä, toteutus on DO:ssa.
 */
const kirjaKasittelija = createFetchHandler<typeof contract, object, KirjaAlusta>(
  contract,
  Object.fromEntries(
    Object.keys(contract).map((reitti) => [
      reitti,
      ({ params, query, body }: ReittiSyote, { kirja, konteksti, laske }: KirjaAlusta) => {
        if (laske) {
          workerLaskurit.kirjaDoKutsut++;
          kasvata(workerLaskurit.kirjaDoReiteittain, reitti);
        }
        // itty-routerin params/query eivät ole tavallisia olioita (RPC:n structured clone hylkää
        // ne); kopioidaan omiksi olioiksi. Runko on jo JSON.parse-tulos.
        return kirja.kasittele(
          reitti,
          { params: { ...(params as object) }, query: { ...(query as object) }, body },
          konteksti,
        );
      },
    ]),
  ) as unknown as KirjaToteutus,
  { errorHandler: virheKasittelija },
);

async function luoKirja(request: Request, env: Env, control: Kontrolli): Promise<Response> {
  const kayttaja = await tunnista(request, control);
  if (kayttaja instanceof Response) return kayttaja;
  const teksti = await request.text();
  let raaka: unknown;
  try {
    raaka = teksti ? JSON.parse(teksti) : {};
  } catch {
    return json(400, { virhe: 'Runko ei ole JSONia', koodi: 'EPAKELPO_SYOTE' });
  }
  const syote = LuoKirjaSyote.safeParse(raaka);
  if (!syote.success) return json(400, { virhe: syote.error.message, koodi: 'EPAKELPO_SYOTE' });

  const kirjaId = crypto.randomUUID();
  const siemen = (syote.data.siemen as SqliteCoreSeed | undefined) ?? oletusSiemen(new Date());
  if (laskuritPaalla(env)) {
    workerLaskurit.kirjaDoKutsut++;
    kasvata(workerLaskurit.kirjaDoReiteittain, 'alusta');
  }
  await kirjaStub(env, kirjaId).alusta(siemen, kirjaId);
  // Jäsenyys vasta kun kirja on olemassa: keskeytynyt luonti jättää orvon DO:n, ei roikkuvaa
  // jäsenyyttä tyhjään kirjaan.
  await control.lisaaJasenyys(kayttaja.id, kirjaId);
  return json(201, { kirjaId });
}

async function kirjaReitti(
  request: Request,
  env: Env,
  control: Kontrolli,
  kirjaId: string,
  loppu: string,
): Promise<Response> {
  const kayttaja = await tunnista(request, control);
  if (kayttaja instanceof Response) return kayttaja;
  // Ei-jäsenelle sama 404 kuin olemattomalle kirjalle: kirjan olemassaolo ei paljastu.
  if (!(await control.onJasen(kayttaja.id, kirjaId))) {
    return json(404, { virhe: 'Kirjanpitoa ei löydy', koodi: 'EI_KIRJAA' });
  }
  // Vain paikallinen kehitys/mittaus; ilman ympäristömuuttujaa reitit vastaavat 404.
  if (loppu.startsWith('/kehitys/')) {
    return kehitysReitti(request, env, kirjaStub(env, kirjaId), kirjaId, loppu);
  }
  const url = new URL(request.url);
  const sisa = new Request(new URL(loppu + url.search, url.origin), request);
  return kirjaKasittelija(sisa, {
    kirja: kirjaStub(env, kirjaId),
    konteksti: { aika: kello(), userId: kayttaja.id, kirjaId },
    laske: laskuritPaalla(env),
  } satisfies KirjaAlusta);
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      const polku = new URL(request.url).pathname;
      // AGPL §13: lähdekoodin tarjous kaikille, ilman kirjautumista (wrangler.jsonc ohjaa polun
      // Workerille ennen SPA-assetteja, ks. run_worker_first).
      if (polku === LAHDEKOODI_POLKU) {
        return new Response(lahdekoodiTarjous(env.LAHDEKOODI_URL || undefined), {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
      const control = kontrolli(env, !polku.includes('/kehitys/'));
      if (laskuritPaalla(env) && polku.startsWith(`${API}/`) && !polku.includes('/kehitys/')) {
        workerLaskurit.pyynnot++;
        workerLaskurit[
          KIRJA_POLKU.test(polku) || polku === `${API}/kirjat` ? 'kirjaPyynnot' : 'authPyynnot'
        ]++;
      }
      if (polku === `${API}/kirjat`) {
        if (request.method !== 'POST') return json(405, { virhe: 'Vain POST' });
        return await luoKirja(request, env, control);
      }
      const osuma = KIRJA_POLKU.exec(polku);
      if (osuma) return await kirjaReitti(request, env, control, osuma[1] ?? '', osuma[2] ?? '/');
      if (polku.startsWith(`${API}/`)) return await authKasittelija(request, { control });
      return json(404, { virhe: 'Reittiä ei löydy', koodi: 'EI_LOYDY' });
    } catch (e) {
      console.error('[pilvi] odottamaton virhe', e);
      return json(500, { virhe: 'Palvelinvirhe' });
    }
  },
} satisfies ExportedHandler<Env>;
