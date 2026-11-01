import type { BudjettiRivi, IsoDate, UusiKohdennus } from '@penni/engine';
import { Euro } from '@penni/euro';
import type Database from 'better-sqlite3';

/** A raw row from the Kitsas `Kohdennus` table (sqlite/luo.sql:33-40). */
export interface KitsasKohdennusRivi {
  id: number;
  tyyppi: number;
  kuuluu: number | null;
  json: string | null;
}

/** A raw row from the Kitsas `Merkkaus` table: one tag on one ledger row (luo.sql:146-151). */
export interface KitsasMerkkausRivi {
  vienti: number;
  kohdennus: number;
}

/** A raw row from the Kitsas `Budjetti` table (luo.sql:45-52); `sentti` is kredit − debet. */
export interface KitsasBudjettiRivi {
  tilikausi: string;
  kohdennus: number | null;
  tili: number;
  sentti: number | null;
}

export interface LuetutKohdennukset {
  kohdennukset: UusiKohdennus[];
  /** Kitsas `Vienti.id` -> tag ids, ascending and unique. */
  merkkaukset: Map<number, number[]>;
  budjetit: { tilikausi: IsoDate; rivit: BudjettiRivi[] }[];
}

const PVM = /^\d{4}-\d{2}-\d{2}$/;

function lueJson(json: string | null): Record<string, unknown> {
  try {
    const arvo: unknown = json ? JSON.parse(json) : {};
    return arvo && typeof arvo === 'object' && !Array.isArray(arvo)
      ? (arvo as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Name map of a Kitsas kohdennus. Penni needs a non-empty `nimi.fi`; a row whose json holds
 * no usable name (older or hand-edited book) gets the first name it has in another language,
 * else the placeholder `Kohdennus <id>`, so it stays visible and renamable instead of failing.
 * A plain string is the Finnish name, as Kitsas `Monikielinen::aseta` reads it
 * (kieli/monikielinen.cpp:48-49).
 */
function nimi(raaka: unknown, id: number): Record<string, string> {
  const kartta: Record<string, string> = {};
  if (typeof raaka === 'string' && raaka.trim() !== '') kartta.fi = raaka;
  else if (raaka && typeof raaka === 'object') {
    for (const [kieli, arvo] of Object.entries(raaka as Record<string, unknown>))
      if (typeof arvo === 'string' && arvo.trim() !== '') kartta[kieli] = arvo;
  }
  if (kartta.fi === undefined) kartta.fi = Object.values(kartta)[0] ?? `Kohdennus ${id}`;
  return kartta;
}

/**
 * Kitsas `Kohdennus` rows -> Penni kohdennukset, ids kept (ledger rows point at them). Type 0
 * (Yleinen) is implicit in Penni and skipped. `json` carries `nimi`, `alkaa`, `paattyy`; any
 * other key is kept as is. `kuuluu` is kept for projects only, 0/NULL meaning Yleinen = absent.
 */
export function muunnaKohdennukset(rivit: readonly KitsasKohdennusRivi[]): UusiKohdennus[] {
  const tulos: UusiKohdennus[] = [];
  for (const rivi of rivit) {
    if (rivi.tyyppi !== 1 && rivi.tyyppi !== 2 && rivi.tyyppi !== 3) continue;
    const { nimi: raakaNimi, alkaa, paattyy, ...muut } = lueJson(rivi.json);
    const k: UusiKohdennus = {
      ...muut,
      id: rivi.id,
      tyyppi: rivi.tyyppi,
      nimi: nimi(raakaNimi, rivi.id),
    };
    if (rivi.tyyppi === 2 && rivi.kuuluu) k.kuuluu = rivi.kuuluu;
    if (typeof alkaa === 'string' && PVM.test(alkaa)) k.alkaa = alkaa;
    if (typeof paattyy === 'string' && PVM.test(paattyy)) k.paattyy = paattyy;
    tulos.push(k);
  }
  return tulos;
}

/** `Merkkaus` rows grouped by Kitsas vienti id; each list ascending and unique. */
export function merkkauksetVienneittain(
  rivit: readonly KitsasMerkkausRivi[],
): Map<number, number[]> {
  const kartta = new Map<number, number[]>();
  for (const r of rivit) {
    const lista = kartta.get(r.vienti) ?? [];
    if (!lista.includes(r.kohdennus)) lista.push(r.kohdennus);
    kartta.set(r.vienti, lista);
  }
  for (const lista of kartta.values()) lista.sort((a, b) => a - b);
  return kartta;
}

/**
 * `Budjetti` rows -> one row list per fiscal year (ascending by `tilikausi`). A NULL kohdennus
 * is Yleinen (0), `sentti` is already Penni's sign (kredit − debet) and integer cents. Rows
 * Kitsas keeps twice under NULL and 0 (its primary key does not cover NULL) are summed; zero
 * and NULL amounts are dropped, as Penni never stores zero rows.
 */
export function muunnaBudjetit(
  rivit: readonly KitsasBudjettiRivi[],
): { tilikausi: IsoDate; rivit: BudjettiRivi[] }[] {
  const kaudet = new Map<string, Map<string, BudjettiRivi>>();
  for (const r of rivit) {
    const sentit = Math.trunc(r.sentti ?? 0);
    if (sentit === 0) continue;
    const kohdennus = r.kohdennus ?? 0;
    const kausi = kaudet.get(r.tilikausi) ?? new Map<string, BudjettiRivi>();
    const avain = `${kohdennus}/${r.tili}`;
    const edellinen = kausi.get(avain);
    kausi.set(avain, {
      kohdennus,
      tili: r.tili,
      sentit: Euro.fromCents((edellinen?.sentit ?? 0) + sentit),
    });
    kaudet.set(r.tilikausi, kausi);
  }
  return [...kaudet.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tilikausi, kausi]) => ({
      tilikausi,
      rivit: [...kausi.values()].sort((a, b) => a.kohdennus - b.kohdennus || a.tili - b.tili),
    }))
    .filter((k) => k.rivit.length > 0);
}

function onTaulu(db: Database.Database, taulu: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(taulu) !== undefined
  );
}

/** Read the three tables from an open Kitsas book; a missing table (older Kitsas) is empty. */
export function lueKohdennukset(db: Database.Database): LuetutKohdennukset {
  const kohdennukset = onTaulu(db, 'Kohdennus')
    ? muunnaKohdennukset(
        db
          .prepare('SELECT id, tyyppi, kuuluu, json FROM Kohdennus ORDER BY id')
          .all() as KitsasKohdennusRivi[],
      )
    : [];
  const merkkaukset = onTaulu(db, 'Merkkaus')
    ? merkkauksetVienneittain(
        db.prepare('SELECT vienti, kohdennus FROM Merkkaus').all() as KitsasMerkkausRivi[],
      )
    : new Map<number, number[]>();
  const budjetit = onTaulu(db, 'Budjetti')
    ? muunnaBudjetit(
        db
          .prepare('SELECT tilikausi, kohdennus, tili, sentti FROM Budjetti')
          .all() as KitsasBudjettiRivi[],
      )
    : [];
  return { kohdennukset, merkkaukset, budjetit };
}
