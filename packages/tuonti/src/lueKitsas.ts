import type { Asetukset, TiliData, Tilikausi, TositeVienti } from '@penni/engine';
import Database from 'better-sqlite3';
import {
  type KitsasKumppaniRivi,
  type KitsasLiiteRivi,
  type KitsasOtsikkoRivi,
  type KitsasTiliRivi,
  type KitsasTositeRivi,
  type KitsasVientiRivi,
  muunnaKumppani,
  muunnaLiite,
  muunnaOtsikko,
  muunnaTili,
  muunnaTosite,
  muunnaVienti,
  suodataAsetukset,
} from './muunna.js';
import type { KitsasKirja, KitsasTosite, KitsasYhteenveto } from './tyypit.js';

/** A user-facing import failure. `viesti` is Finnish and safe to show in a dialog. */
export class TuontiVirhe extends Error {
  /** Original driver/db error text, if any. For logs only — never shown to the user directly. */
  public alkuperainen?: string;

  constructor(
    public koodi: 'ei-tiedostoa' | 'ei-kitsas' | 'lukuvirhe',
    viesti: string,
    alkuperainen?: string,
  ) {
    super(viesti);
    this.name = 'TuontiVirhe';
    if (alkuperainen !== undefined) this.alkuperainen = alkuperainen;
  }
}

/** Tables Penni's Tier-0 model does not carry over; reported, never silently dropped. */
const OHITETTAVAT_TAULUT = [
  'Kohdennus',
  'Budjetti',
  'Tuote',
  'Vakioviite',
  'Merkkaus',
  'Ryhma',
  'KumppaniRyhmassa',
  'Tositeloki',
  'Rivi',
];

/** Tables that must exist for a file to count as a Kitsas book. */
const VAADITUT_TAULUT = ['Tili', 'Tosite', 'Vienti', 'Tilikausi', 'Asetus'];

function laske(db: Database.Database, taulu: string): number {
  try {
    return (db.prepare(`SELECT count(*) n FROM ${taulu}`).get() as { n: number }).n;
  } catch {
    return 0;
  }
}

/**
 * Read a `.kitsas` SQLite book into memory. The returned `KitsasKirja` holds no database
 * handles, so everything downstream is pure data. Throws `TuontiVirhe` on any failure.
 */
export function lueKitsas(polku: string): KitsasKirja {
  let db: Database.Database;
  try {
    db = new Database(polku, { readonly: true, fileMustExist: true });
  } catch (virhe) {
    throw new TuontiVirhe(
      'ei-tiedostoa',
      `Tiedostoa ei voitu avata: ${polku}`,
      (virhe as Error).message,
    );
  }

  try {
    // better-sqlite3 does not throw on open for a non-SQLite file — SQLite validates lazily,
    // so a garbage file only fails here, on the first query. Caught separately so that case
    // reports 'ei-kitsas' rather than falling through to the generic 'lukuvirhe' below.
    let taulut: Set<string>;
    try {
      taulut = new Set(
        (
          db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
            name: string;
          }[]
        ).map((r) => r.name),
      );
    } catch (virhe) {
      throw new TuontiVirhe(
        'ei-kitsas',
        `Tiedosto ei ole kelvollinen SQLite-tietokanta: ${polku}`,
        (virhe as Error).message,
      );
    }
    const puuttuvat = VAADITUT_TAULUT.filter((t) => !taulut.has(t));
    if (puuttuvat.length > 0) {
      throw new TuontiVirhe(
        'ei-kitsas',
        `Tiedosto ei ole Kitsas-kirjanpito: puuttuvat taulut ${puuttuvat.join(', ')}`,
      );
    }

    // --- master data ---
    const tilit: TiliData[] = (
      db
        .prepare('SELECT numero, tyyppi, iban, json FROM Tili ORDER BY numero')
        .all() as KitsasTiliRivi[]
    ).map(muunnaTili);
    for (const rivi of db
      .prepare('SELECT numero, taso, json FROM Otsikko ORDER BY numero, taso')
      .all() as KitsasOtsikkoRivi[]) {
      tilit.push(muunnaOtsikko(rivi));
    }

    const tilikaudet: Tilikausi[] = (
      db.prepare('SELECT alkaa, loppuu, json FROM Tilikausi ORDER BY alkaa').all() as {
        alkaa: string;
        loppuu: string;
        json: string | null;
      }[]
    ).map((r) => {
      let extra: Record<string, unknown> = {};
      try {
        const arvo: unknown = r.json ? JSON.parse(r.json) : {};
        if (arvo && typeof arvo === 'object') extra = arvo as Record<string, unknown>;
      } catch {
        extra = {};
      }
      return { ...extra, alkaa: r.alkaa, loppuu: r.loppuu };
    });

    const kaikkiAsetukset: Asetukset = {};
    for (const r of db.prepare('SELECT avain, arvo FROM Asetus').all() as {
      avain: string;
      arvo: string | null;
    }[]) {
      kaikkiAsetukset[r.avain] = r.arvo ?? '';
    }
    const kpVersio = kaikkiAsetukset.KpVersio ?? '';
    const asetukset = suodataAsetukset(kaikkiAsetukset);

    // --- kumppanit + ibanit ---
    const ibanit = new Map<number, string[]>();
    for (const r of db.prepare('SELECT iban, kumppani FROM KumppaniIban').all() as {
      iban: string;
      kumppani: number | null;
    }[]) {
      if (r.kumppani === null) continue;
      const lista = ibanit.get(r.kumppani) ?? [];
      lista.push(r.iban);
      ibanit.set(r.kumppani, lista);
    }
    const kumppanit = (
      db
        .prepare('SELECT id, nimi, alvtunnus, json FROM Kumppani ORDER BY id')
        .all() as KitsasKumppaniRivi[]
    ).map((r) => muunnaKumppani(r, ibanit.get(r.id) ?? []));

    // --- tositteet + viennit ---
    const viennitTositteittain = new Map<number, TositeVienti[]>();
    const vientiRivit = db
      .prepare(
        `SELECT tosite, tili, debetsnt, kreditsnt, alvkoodi, alvprosentti, kohdennus, eraid,
                selite, tyyppi, pvm, jaksoalkaa, jaksoloppuu, json
         FROM Vienti ORDER BY tosite, rivi`,
      )
      .all() as (KitsasVientiRivi & { tosite: number })[];

    const tositeRivit = db
      .prepare(
        `SELECT id, pvm, tyyppi, tila, tunniste, sarja, otsikko, kumppani,
                laskupvm, erapvm, viite, json
         FROM Tosite ORDER BY id`,
      )
      .all() as KitsasTositeRivi[];
    const pvmTositteella = new Map(tositeRivit.map((t) => [t.id, t.pvm]));

    for (const rivi of vientiRivit) {
      const lista = viennitTositteittain.get(rivi.tosite) ?? [];
      lista.push(muunnaVienti(rivi, pvmTositteella.get(rivi.tosite) ?? rivi.pvm ?? ''));
      viennitTositteittain.set(rivi.tosite, lista);
    }

    const tositteet: KitsasTosite[] = tositeRivit.map((rivi) =>
      muunnaTosite(rivi, viennitTositteittain.get(rivi.id) ?? []),
    );

    // --- liitteet ---
    const liitteet = (
      db
        .prepare('SELECT tosite, nimi, roolinimi, tyyppi, sha, luotu, data FROM Liite ORDER BY id')
        .all() as (KitsasLiiteRivi & { tosite: number | null })[]
    )
      .filter((r) => r.tosite !== null)
      .map((r) => muunnaLiite(r, r.tosite as number));

    // --- ohitetut taulut ---
    const ohitetut: Record<string, number> = {};
    for (const taulu of OHITETTAVAT_TAULUT) {
      const n = laske(db, taulu);
      if (n > 0) ohitetut[taulu] = n;
    }

    return { tilit, tilikaudet, asetukset, kumppanit, tositteet, liitteet, kpVersio, ohitetut };
  } catch (virhe) {
    if (virhe instanceof TuontiVirhe) throw virhe;
    throw new TuontiVirhe('lukuvirhe', 'Kirjanpidon luku epäonnistui.', (virhe as Error).message);
  } finally {
    db.close();
  }
}

/** Condense a read book into the numbers the preview screen shows. */
export function yhteenveto(kirja: KitsasKirja): KitsasYhteenveto {
  return {
    nimi: kirja.asetukset.Nimi ?? '(nimetön)',
    kpVersio: kirja.kpVersio,
    tilikaudet: kirja.tilikaudet.map((k) => ({ alkaa: k.alkaa, loppuu: k.loppuu })),
    tilit: kirja.tilit.length,
    tositteet: kirja.tositteet.length,
    viennit: kirja.tositteet.reduce((summa, t) => summa + t.viennit.length, 0),
    liitteet: kirja.liitteet.length,
    kumppanit: kirja.kumppanit.length,
    ohitetut: kirja.ohitetut,
  };
}
