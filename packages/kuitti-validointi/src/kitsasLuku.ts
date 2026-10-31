import { type Tili, TositeTyyppi, lataaKartta } from '@penni/engine';
import Database from 'better-sqlite3';
import type { Leg } from './legit.js';

export interface KitsasLiite {
  nimi: string;
  mime: string;
  roolinimi: string;
  data: Uint8Array;
}

export interface KitsasTositeRivi {
  tositeId: number;
  pvm: string;
  tyyppi: number;
  myyja: string;
  legit: Leg[];
  liitteet: KitsasLiite[];
}

export interface KitsasData {
  chart: Tili[];
  ostotositteet: KitsasTositeRivi[];
}

interface TiliRow {
  numero: number;
  tyyppi: string;
  json: string | null;
}
interface TositeRow {
  id: number;
  pvm: string;
  tyyppi: number;
  kumppani: number | null;
}
interface VientiRow {
  tili: number;
  debetsnt: number | null;
  kreditsnt: number | null;
  alvkoodi: number | null;
  alvprosentti: number | null;
}
interface LiiteRow {
  nimi: string | null;
  tyyppi: string | null;
  roolinimi: string | null;
  data: Buffer | null;
}

const buf = (b: Buffer | null): Uint8Array =>
  b ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array();

/** Open a .kitsas SQLite book read-only and extract chart + receipt-backed purchase vouchers. */
export function avaaKitsas(polku: string): KitsasData {
  const db = new Database(polku, { readonly: true, fileMustExist: true });
  try {
    const chart = lataaKartta(
      db
        .prepare('SELECT numero, tyyppi, json FROM Tili')
        .all()
        .map((r) => {
          const row = r as TiliRow;
          const json = row.json ? (JSON.parse(row.json) as Record<string, unknown>) : {};
          return { ...json, numero: row.numero, tyyppi: row.tyyppi };
        }),
    );

    const kumppanit = new Map<number, string>();
    for (const r of db.prepare('SELECT id, nimi FROM Kumppani').all()) {
      const row = r as { id: number; nimi: string | null };
      kumppanit.set(row.id, row.nimi ?? '');
    }

    const vientiKysely = db.prepare(
      'SELECT tili, debetsnt, kreditsnt, alvkoodi, alvprosentti FROM Vienti WHERE tosite = ? ORDER BY rivi',
    );
    const liiteKysely = db.prepare(
      'SELECT nimi, tyyppi, roolinimi, data FROM Liite WHERE tosite = ?',
    );
    const liiteMaara = db.prepare('SELECT count(*) n FROM Liite WHERE tosite = ?');

    const ostotositteet: KitsasTositeRivi[] = [];
    const tositteet = db
      .prepare(
        'SELECT id, pvm, tyyppi, kumppani FROM Tosite WHERE tyyppi >= ? AND tyyppi < ? ORDER BY id',
      )
      .all(TositeTyyppi.MENO, TositeTyyppi.TULO) as TositeRow[];

    for (const t of tositteet) {
      if ((liiteMaara.get(t.id) as { n: number }).n === 0) continue;
      const legit: Leg[] = (vientiKysely.all(t.id) as VientiRow[]).map((v) => ({
        tili: v.tili,
        debet: v.debetsnt ?? 0,
        kredit: v.kreditsnt ?? 0,
        alvKoodi: v.alvkoodi ?? 0,
        alvProsentti: v.alvprosentti ?? 0,
      }));
      const liitteet: KitsasLiite[] = (liiteKysely.all(t.id) as LiiteRow[]).map((l) => ({
        nimi: l.nimi ?? '',
        mime: l.tyyppi ?? '',
        roolinimi: l.roolinimi ?? '',
        data: buf(l.data),
      }));
      ostotositteet.push({
        tositeId: t.id,
        pvm: t.pvm,
        tyyppi: t.tyyppi,
        myyja: t.kumppani !== null ? (kumppanit.get(t.kumppani) ?? '') : '',
        legit,
        liitteet,
      });
    }

    return { chart, ostotositteet };
  } finally {
    db.close();
  }
}
