import type {
  Asetukset,
  AuditCtx,
  AuditEntry,
  InitBundle,
  InitPatch,
  IsoDate,
  Kumppani,
  Liite,
  LiiteMeta,
  SaldoQuery,
  Storage,
  StoredTosite,
  Tili,
  TiliData,
  Tilikausi,
  Tosite,
  TositeFilter,
  TositeVienti,
  UusiKumppani,
  UusiLiite,
} from '@penni/engine';
import type { Cents } from '@penni/euro';
import type { SqliteCoreSeed } from '@penni/storage-sqlite-core';

interface Pyynto {
  id: number;
  metodi: string;
  args: unknown[];
}
type Vastaus = { id: number; ok: true; arvo: unknown } | { id: number; ok: false; virhe: string };

/** OPFS-pohjainen Storage + close + nollaa (velhon uudelleensiemennys). */
export interface OpfsStorage extends Storage {
  close(): Promise<void>;
  /** Pudota ja rakenna kanta uudelleen annetulla siemenellä (velhon "Luo kirjanpito"). */
  nollaa(siemen: SqliteCoreSeed): Promise<void>;
}

export async function createOpfsStorage(
  nimi: string,
  siemen?: SqliteCoreSeed,
): Promise<OpfsStorage> {
  const worker = new Worker(new URL('./opfs-worker.js', import.meta.url), { type: 'module' });

  let seq = 0;
  const odottavat = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  worker.addEventListener('message', (ev: MessageEvent<Vastaus>) => {
    const p = odottavat.get(ev.data.id);
    if (!p) return;
    odottavat.delete(ev.data.id);
    if (ev.data.ok) p.resolve(ev.data.arvo);
    else p.reject(new Error(ev.data.virhe));
  });

  const kutsu = <T>(metodi: string, ...args: unknown[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      odottavat.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, metodi, args } satisfies Pyynto);
    });

  await kutsu<void>('__init', nimi, siemen);

  return {
    getTosite: (id: number) => kutsu<StoredTosite | null>('getTosite', id),
    listTositteet: (filter: TositeFilter) => kutsu<StoredTosite[]>('listTositteet', filter),
    listViennit: (filter: { alkupvm?: IsoDate; loppupvm?: IsoDate; tili?: number }) =>
      kutsu<TositeVienti[]>('listViennit', filter),
    saveTosite: (t: Tosite & { id?: number }, audit: AuditCtx) =>
      kutsu<StoredTosite>('saveTosite', t, audit),
    patchTositeTila: (id: number, tila: number, tunniste: number, audit: AuditCtx, data: unknown) =>
      kutsu<StoredTosite>('patchTositeTila', id, tila, tunniste, audit, data),
    softDeleteTosite: (id: number, audit: AuditCtx) => kutsu<void>('softDeleteTosite', id, audit),
    maxTunniste: (alkaa: IsoDate, loppuu: IsoDate, sarja: string | null) =>
      kutsu<number>('maxTunniste', alkaa, loppuu, sarja),
    querySaldot: async (q: SaldoQuery) => {
      const parit = await kutsu<[number, Cents][]>('querySaldot', q);
      return new Map<number, Cents>(parit);
    },
    queryErat: async (q: { saldopvm?: IsoDate }) => {
      const parit = await kutsu<[number, Cents][]>('queryErat', q);
      return new Map<number, Cents>(parit);
    },
    getLoki: (tositeId: number) => kutsu<AuditEntry[]>('getLoki', tositeId),
    tuoLoki: (merkinnat: AuditEntry[]) => kutsu<void>('tuoLoki', merkinnat),
    getChart: () => kutsu<Tili[]>('getChart'),
    getTilikaudet: () => kutsu<Tilikausi[]>('getTilikaudet'),
    getAsetukset: () => kutsu<Asetukset>('getAsetukset'),
    getInit: () => kutsu<InitBundle>('getInit'),
    putTili: (numero: number, data: TiliData) => kutsu<void>('putTili', numero, data),
    deleteTili: (numero: number, taso?: number) => kutsu<void>('deleteTili', numero, taso),
    putTilikausi: (alkaa: IsoDate, kausi: Tilikausi) => kutsu<void>('putTilikausi', alkaa, kausi),
    deleteTilikausi: (alkaa: IsoDate) => kutsu<void>('deleteTilikausi', alkaa),
    patchAsetukset: (patch: Asetukset) => kutsu<void>('patchAsetukset', patch),
    patchInit: (patch: InitPatch) => kutsu<void>('patchInit', patch),
    getKumppanit: () => kutsu<Kumppani[]>('getKumppanit'),
    saveKumppani: (kumppani: UusiKumppani) => kutsu<Kumppani>('saveKumppani', kumppani),
    deleteKumppani: (id: number) => kutsu<void>('deleteKumppani', id),
    laskeLiitteet: async () => {
      const parit = await kutsu<[number, number][]>('laskeLiitteet');
      return new Map<number, number>(parit);
    },
    getLiitteet: (tosite: number) => kutsu<LiiteMeta[]>('getLiitteet', tosite),
    getLiite: (id: number) => kutsu<Liite | null>('getLiite', id),
    saveLiite: (liite: UusiLiite) => kutsu<LiiteMeta>('saveLiite', liite),
    deleteLiite: (id: number) => kutsu<void>('deleteLiite', id),
    nollaa: (s: SqliteCoreSeed) => kutsu<void>('__nollaa', s),
    close: async () => {
      await kutsu<void>('__close');
      worker.terminate();
    },
  };
}
