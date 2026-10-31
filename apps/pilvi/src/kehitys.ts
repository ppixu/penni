// Vain paikalliseen kehitykseen ja mittaukseen (Q2/Q3/Q6, apps/pilvi/mittaus): kirjan tuonti ja
// käyttölaskurit. Kaikki on kytketty ympäristömuuttujiin, jotka asetetaan vain `pnpm dev`-
// skriptissä, mittausskriptin wrangler-käynnistyksessä ja vitest-konfiguraatiossa — ei koskaan
// wrangler.jsonc:n oletusmuuttujiin. Ilman muuttujaa kaikki reitit vastaavat 404 ja laskurit ovat
// pois päältä, joten julkaistussa Workerissa tästä ei ole mitään näkyvissä.

/** '1' = kirjan tuontireitit ja DO:n tuontimetodit käytössä. */
export const TUONTI_MUUTTUJA = 'PILVI_KEHITYS_TUONTI';
/** '1' = pyyntö-/DO-/R2-/SQL-laskurit päällä ja niiden lukureitti käytössä. */
export const LASKURI_MUUTTUJA = 'PILVI_KEHITYS_LASKURIT';

export interface KehitysEnv {
  PILVI_KEHITYS_TUONTI?: string;
  PILVI_KEHITYS_LASKURIT?: string;
}

export const tuontiPaalla = (env: KehitysEnv): boolean => env[TUONTI_MUUTTUJA] === '1';
export const laskuritPaalla = (env: KehitysEnv): boolean => env[LASKURI_MUUTTUJA] === '1';

/** Taulut, jotka tuodaan riveinä (liite erikseen, koska sen tavut menevät liitevarastoon). */
export const TUONTI_TAULUT = [
  'asetus',
  'tili',
  'tilikausi',
  'kumppani',
  'tosite',
  'vienti',
  'loki',
] as const;
export type TuontiTaulu = (typeof TUONTI_TAULUT)[number];
/** Kaikki taulut, joiden rivimäärät yhteenveto kertoo. */
export const YHTEENVETO_TAULUT = [...TUONTI_TAULUT, 'liite'] as const;

/** Worker-puolen laskurit (moduulin tila: paikallisessa wrangler devissä yksi isolaatti). */
export interface WorkerLaskurit {
  /** /api/*-pyynnöt Workerille (ei kehitysreittejä). */
  pyynnot: number;
  kirjaPyynnot: number;
  authPyynnot: number;
  /** Kirjan DO:n RPC-kutsut yhteensä ja reiteittäin. */
  kirjaDoKutsut: number;
  kirjaDoReiteittain: Record<string, number>;
  /** Control DO:n RPC-kutsut yhteensä ja metodeittain. */
  controlDoKutsut: number;
  controlDoMetodeittain: Record<string, number>;
}

export function tyhjatWorkerLaskurit(): WorkerLaskurit {
  return {
    pyynnot: 0,
    kirjaPyynnot: 0,
    authPyynnot: 0,
    kirjaDoKutsut: 0,
    kirjaDoReiteittain: {},
    controlDoKutsut: 0,
    controlDoMetodeittain: {},
  };
}

export function kasvata(rec: Record<string, number>, avain: string): void {
  rec[avain] = (rec[avain] ?? 0) + 1;
}

/** DO-puolen laskurit (yhden kirjan DO-instanssin muistissa; `esiintyma` paljastaa evictionin). */
export interface DoLaskurit {
  esiintyma: string;
  kasittelyja: number;
  /** performance.now()-erotusten summa käsittelijän ympäriltä; workerdissä kello etenee vain I/O:ssa. */
  kasittelyMs: number;
  sqlLauseita: number;
  rowsRead: number;
  rowsWritten: number;
  r2: { head: number; put: number; get: number; putTavut: number; getTavut: number };
}

export function tyhjatDoLaskurit(esiintyma: string): DoLaskurit {
  return {
    esiintyma,
    kasittelyja: 0,
    kasittelyMs: 0,
    sqlLauseita: 0,
    rowsRead: 0,
    rowsWritten: 0,
    r2: { head: 0, put: 0, get: 0, putTavut: 0, getTavut: 0 },
  };
}

/**
 * R2-bucket, joka laskee Liitevaraston käyttämät head/put/get-kutsut (ja tavut) ennen
 * delegointia. Vain nämä kolme metodia on toteutettu: ne ovat kaikki mitä luoR2Liitevarasto käyttää.
 */
export function laskevaR2(bucket: R2Bucket, l: DoLaskurit['r2']): R2Bucket {
  const laskeva = {
    head: (avain: string) => {
      l.head++;
      return bucket.head(avain);
    },
    put: (avain: string, arvo: Parameters<R2Bucket['put']>[1], valinnat?: R2PutOptions) => {
      l.put++;
      if (arvo instanceof Uint8Array || arvo instanceof ArrayBuffer) l.putTavut += arvo.byteLength;
      return bucket.put(avain, arvo, valinnat);
    },
    get: async (avain: string) => {
      l.get++;
      const objekti = await bucket.get(avain);
      if (objekti) l.getTavut += objekti.size;
      return objekti;
    },
  };
  return laskeva as unknown as R2Bucket;
}

/** Laskee jokaisen kutsun, jonka Kontrolli (tai muu RPC-näkymä) saa; metodin nimi avaimena. */
export function laskevaProxy<T extends object>(kohde: T, laske: (metodi: string) => void): T {
  return new Proxy(kohde, {
    get(t, p, vastaanottaja) {
      const arvo = Reflect.get(t, p, vastaanottaja);
      if (typeof arvo !== 'function' || typeof p !== 'string') return arvo;
      return (...args: unknown[]) => {
        laske(p);
        return arvo.apply(t, args);
      };
    },
  });
}

/** Workerin yksi laskurioliö (paikallisessa wrangler devissä yksi isolaatti palvelee kaiken). */
export const workerLaskurit: WorkerLaskurit = tyhjatWorkerLaskurit();

/** Palauta nykyiset Worker-laskurit ja aloita alusta. */
export function nollaaWorkerLaskurit(): WorkerLaskurit {
  const kopio = structuredClone(workerLaskurit);
  Object.assign(workerLaskurit, tyhjatWorkerLaskurit());
  return kopio;
}
