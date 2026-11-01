import {
  type SqliteCoreSeed,
  type SqliteCoreStorage,
  createSqliteCoreStorage,
} from '@penni/storage-sqlite-core';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { luoOo1Ajuri } from './ajuri-oo1.js';

interface Pyynto {
  id: number;
  metodi: string;
  args: unknown[];
}
type Vastaus = { id: number; ok: true; arvo: unknown } | { id: number; ok: false; virhe: string };

let storage: SqliteCoreStorage | undefined;
// biome-ignore lint/suspicious/noExplicitAny: SAHPool-poolin tyyppi tulee ajonaikaisesta moduulista
let pool: any;
let dbPolku = '';
let viimeSiemen: SqliteCoreSeed | undefined;

async function alusta(nimi: string, siemen?: SqliteCoreSeed): Promise<void> {
  const sqlite3 = await sqlite3InitModule();
  pool = await sqlite3.installOpfsSAHPoolVfs({
    name: 'penni-opfs',
    directory: '/penni',
    initialCapacity: 8,
    clearOnInit: false,
  });
  dbPolku = `/${nimi}.sqlite3`;
  viimeSiemen = siemen;
  const db = new pool.OpfsSAHPoolDb(dbPolku);
  db.exec('PRAGMA foreign_keys = ON'); // EI WAL SAHPoolin alla
  storage = createSqliteCoreStorage(luoOo1Ajuri(db), siemen ?? {});
}

/** Pudota ja rakenna kanta uudelleen + siemennä (velhon "Luo kirjanpito"). */
function nollaa(siemen: SqliteCoreSeed): void {
  if (!pool) throw new Error('OPFS-ajuria ei ole alustettu');
  storage?.close();
  pool.unlink(dbPolku); // poista tiedosto OPFS:stä
  const db = new pool.OpfsSAHPoolDb(dbPolku);
  db.exec('PRAGMA foreign_keys = ON');
  storage = createSqliteCoreStorage(luoOo1Ajuri(db), siemen);
}

function vaadiStorage(): SqliteCoreStorage {
  if (!storage) throw new Error('OPFS-ajuria ei ole alustettu');
  return storage;
}

// biome-ignore lint/suspicious/noExplicitAny: RPC-rajapinnan dynaaminen metodikutsu
const kasittelijat: Record<string, (...a: any[]) => unknown> = {
  __init: (nimi: string, siemen?: SqliteCoreSeed) => alusta(nimi, siemen),
  __nollaa: (siemen: SqliteCoreSeed) => nollaa(siemen),
  __close: () => storage?.close(),
  getTosite: (id) => vaadiStorage().getTosite(id),
  listTositteet: (f) => vaadiStorage().listTositteet(f),
  listViennit: (f) => vaadiStorage().listViennit(f),
  saveTosite: (t, a) => vaadiStorage().saveTosite(t, a),
  patchTositeTila: (id, tila, tun, a, d) => vaadiStorage().patchTositeTila(id, tila, tun, a, d),
  softDeleteTosite: (id, a) => vaadiStorage().softDeleteTosite(id, a),
  maxTunniste: (al, lo, sa) => vaadiStorage().maxTunniste(al, lo, sa),
  querySaldot: (q) => vaadiStorage().querySaldot(q),
  queryErat: (q) => vaadiStorage().queryErat(q),
  getLoki: (id) => vaadiStorage().getLoki(id),
  tuoLoki: (m) => vaadiStorage().tuoLoki(m),
  getChart: () => vaadiStorage().getChart(),
  getTilikaudet: () => vaadiStorage().getTilikaudet(),
  getAsetukset: () => vaadiStorage().getAsetukset(),
  getInit: () => vaadiStorage().getInit(),
  putTili: (n, d) => vaadiStorage().putTili(n, d),
  deleteTili: (n, t) => vaadiStorage().deleteTili(n, t),
  putTilikausi: (al, k) => vaadiStorage().putTilikausi(al, k),
  deleteTilikausi: (al) => vaadiStorage().deleteTilikausi(al),
  patchAsetukset: (p) => vaadiStorage().patchAsetukset(p),
  patchInit: (p) => vaadiStorage().patchInit(p),
  getKumppanit: () => vaadiStorage().getKumppanit(),
  saveKumppani: (k) => vaadiStorage().saveKumppani(k),
  deleteKumppani: (id) => vaadiStorage().deleteKumppani(id),
  getKohdennukset: () => vaadiStorage().getKohdennukset(),
  saveKohdennus: (k) => vaadiStorage().saveKohdennus(k),
  deleteKohdennus: (id) => vaadiStorage().deleteKohdennus(id),
  laskeKohdennustenKaytto: () => vaadiStorage().laskeKohdennustenKaytto(),
  getBudjetti: (kausi) => vaadiStorage().getBudjetti(kausi),
  putBudjetti: (kausi, rivit) => vaadiStorage().putBudjetti(kausi, rivit),
  laskeLiitteet: () => vaadiStorage().laskeLiitteet(),
  getLiitteet: (tosite) => vaadiStorage().getLiitteet(tosite),
  getLiite: (id) => vaadiStorage().getLiite(id),
  saveLiite: (liite) => vaadiStorage().saveLiite(liite),
  deleteLiite: (id) => vaadiStorage().deleteLiite(id),
};

self.addEventListener('message', async (ev: MessageEvent<Pyynto>) => {
  const { id, metodi, args } = ev.data;
  try {
    const kasittelija = kasittelijat[metodi];
    if (!kasittelija) throw new Error(`Tuntematon metodi: ${metodi}`);
    // querySaldot palauttaa Mapin → muunna entry-taulukoksi rakenteelliseen kloonaukseen.
    const tulos = await kasittelija(...args);
    const arvo = tulos instanceof Map ? Array.from(tulos.entries()) : tulos;
    self.postMessage({ id, ok: true, arvo } satisfies Vastaus);
  } catch (e) {
    self.postMessage({
      id,
      ok: false,
      virhe: e instanceof Error ? e.message : String(e),
    } satisfies Vastaus);
  }
});

// Käytetään `viimeSiemen` mykistämään käyttämätön-muuttujan varoitus (nollaa() voi käyttää sitä myöhemmin).
void viimeSiemen;
