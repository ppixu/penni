import {
  type Asetukset,
  type AuditEntry,
  type TiliData,
  type Tilikausi,
  TositeTyyppi,
  type TositeVienti,
} from '@penni/engine';
import { Euro } from '@penni/euro';
import Database from 'better-sqlite3';
import { lueKohdennukset } from './kohdennukset.js';
import {
  KASITELLYT_TOSITE_JSON,
  KASITELLYT_TOSITE_SISAKKAISET,
  KASITELLYT_VIENTI_JSON,
  KITSAS_LAHDE,
  type KitsasKumppaniRivi,
  type KitsasLiiteRivi,
  type KitsasOtsikkoRivi,
  type KitsasTiliRivi,
  type KitsasTositeRivi,
  type KitsasVientiRivi,
  laskeKattamattomat,
  luoEraKartta,
  muunnaKumppani,
  muunnaLiite,
  muunnaOtsikko,
  muunnaTili,
  muunnaTosite,
  muunnaVienti,
  suodataAsetukset,
} from './muunna.js';
import type { KitsasAlvIlmoitus, KitsasKirja, KitsasTosite, KitsasYhteenveto } from './tyypit.js';

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
const OHITETTAVAT_TAULUT = ['Tuote', 'Vakioviite', 'Ryhma', 'KumppaniRyhmassa', 'Rivi'];

/**
 * Kitsas writes `aika` with SQLite's `current_timestamp` ('YYYY-MM-DD HH:MM:SS', UTC). Penni's
 * audit log holds ISO instants, so the space becomes 'T' and the zone is made explicit.
 */
export function kitsasAika(aika: string | null): string {
  if (!aika) return '1970-01-01T00:00:00Z';
  const iso = aika.includes('T') ? aika : aika.replace(' ', 'T');
  return /(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`;
}

/** Parse a filed VAT return out of an ALVLASKELMA voucher's json; undefined if it has none. */
function lueAlvIlmoitus(tosite: number, json: string | null): KitsasAlvIlmoitus | undefined {
  let arvo: unknown;
  try {
    arvo = json ? JSON.parse(json) : undefined;
  } catch {
    return undefined;
  }
  const alv = (arvo as { alv?: Record<string, unknown> } | undefined)?.alv;
  if (!alv || typeof alv.kausialkaa !== 'string' || typeof alv.kausipaattyy !== 'string')
    return undefined;
  const maksettava = Euro.fromString(String(alv.maksettava ?? '0'));
  const raaka: [number, number][] = [];
  if (alv.koodit && typeof alv.koodit === 'object') {
    for (const [koodi, arvo] of Object.entries(alv.koodit as Record<string, unknown>)) {
      // 337 is a cash-basis flag (value 1), not money (alvlaskelma.cpp:957-958).
      if (koodi === '337') continue;
      const n = Number(arvo);
      if (Number.isFinite(n)) raaka.push([Number(koodi), n]);
    }
  }
  // Current Kitsas stores koodit in cents (alvlaskelma.cpp:955); older books stored euros as
  // doubles (e.g. kitsas-source/unittest/data/oy.kitsas: {"308":58.16}, maksettava 58.16).
  // A non-zero code 308 equals `maksettava`, which is always euros, so it tells the units;
  // otherwise a fractional value can only be euros.
  const k308 = raaka.find(([koodi]) => koodi === 308)?.[1];
  const euroina =
    k308 !== undefined && k308 !== 0
      ? Math.abs(k308 * 100 - maksettava) < Math.abs(k308 - maksettava)
      : raaka.some(([, n]) => !Number.isInteger(n));
  const koodit: Record<number, number> = {};
  for (const [koodi, n] of raaka) {
    koodit[koodi] = euroina ? Euro.fromString(String(n)) : Math.trunc(n);
  }
  return { tosite, alkupvm: alv.kausialkaa, loppupvm: alv.kausipaattyy, maksettava, koodit };
}

/** Tables that must exist for a file to count as a Kitsas book. */
const VAADITUT_TAULUT = ['Tili', 'Tosite', 'Vienti', 'Tilikausi', 'Asetus'];

/** The credited invoice's number on a Kitsas credit note, as a string. */
function lueAlkupNro(json: string | null): string | undefined {
  try {
    const lasku = (json ? JSON.parse(json) : {})?.lasku;
    const nro = lasku?.alkupNro;
    return typeof nro === 'number' || (typeof nro === 'string' && nro !== '')
      ? String(nro)
      : undefined;
  } catch {
    return undefined;
  }
}

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

    // --- kohdennukset, merkkaukset (vientien tagit) ja budjetit ---
    const { kohdennukset, merkkaukset, budjetit } = lueKohdennukset(db);

    // --- tositteet + viennit ---
    const viennitTositteittain = new Map<number, TositeVienti[]>();
    const vientiRivit = db
      .prepare(
        `SELECT id, tosite, tili, debetsnt, kreditsnt, alvkoodi, alvprosentti, kohdennus, eraid,
                selite, tyyppi, pvm, jaksoalkaa, jaksoloppuu, kumppani, arkistotunnus, json
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
    const tositeIdlla = new Map(tositeRivit.map((t) => [t.id, t]));
    const eraAvain = luoEraKartta(vientiRivit);
    const kattamattomat: Record<string, number> = {};

    for (const rivi of vientiRivit) {
      const lahde = tositeIdlla.get(rivi.tosite);
      const vienti = muunnaVienti(rivi, lahde?.pvm ?? rivi.pvm ?? '', {
        kumppani: lahde?.kumppani ?? null,
        viite: lahde?.viite ?? null,
      });
      if (vienti.era !== undefined) vienti.era = eraAvain(vienti.era);
      const merkit = rivi.id === undefined ? undefined : merkkaukset.get(rivi.id);
      if (merkit) vienti.merkkaukset = merkit;
      laskeKattamattomat(rivi.json, KASITELLYT_VIENTI_JSON, 'Vienti.json', kattamattomat);
      const lista = viennitTositteittain.get(rivi.tosite) ?? [];
      lista.push(vienti);
      viennitTositteittain.set(rivi.tosite, lista);
    }

    const tositteet: KitsasTosite[] = tositeRivit.map((rivi) => {
      laskeKattamattomat(
        rivi.json,
        KASITELLYT_TOSITE_JSON,
        'Tosite.json',
        kattamattomat,
        KASITELLYT_TOSITE_SISAKKAISET,
      );
      return muunnaTosite(rivi, viennitTositteittain.get(rivi.id) ?? []);
    });

    // A credit note names the credited invoice by NUMBER (lasku.alkupNro, model/lasku.h:81);
    // Penni links it by voucher id (Tosite.alkuperainenTosite).
    const tositeNumerolla = new Map<string, number>();
    for (const t of tositteet) if (t.numero) tositeNumerolla.set(t.numero, t.id);
    for (const rivi of tositeRivit) {
      const alkupNro = lueAlkupNro(rivi.json);
      const alkuperainen = alkupNro ? tositeNumerolla.get(alkupNro) : undefined;
      const tosite = tositteet.find((t) => t.id === rivi.id);
      if (tosite && alkuperainen !== undefined && alkuperainen !== rivi.id)
        tosite.alkuperainenTosite = alkuperainen;
    }

    // Filed VAT returns (ALVLASKELMA = 9100) — finalized only, for the post-import check.
    const alvIlmoitukset: KitsasAlvIlmoitus[] = [];
    for (const rivi of tositeRivit) {
      if (rivi.tyyppi !== TositeTyyppi.ALVLASKELMA || rivi.tila < 100) continue;
      const ilmoitus = lueAlvIlmoitus(rivi.id, rivi.json);
      if (ilmoitus) alvIlmoitukset.push(ilmoitus);
    }

    // --- liitteet ---
    const liiteRivit = db
      .prepare(
        'SELECT tosite, nimi, roolinimi, tyyppi, sha, luotu, data, json FROM Liite ORDER BY id',
      )
      .all() as (KitsasLiiteRivi & { tosite: number | null; json: string | null })[];
    const liitteet = liiteRivit
      .filter((r) => r.tosite !== null)
      .map((r) => muunnaLiite(r, r.tosite as number));
    for (const r of liiteRivit) laskeKattamattomat(r.json, new Set(), 'Liite.json', kattamattomat);
    // Kitsas itself deletes voucherless attachments as garbage (sqlitemodel.cpp:346); reported.
    const orvot = liiteRivit.length - liitteet.length;
    if (orvot > 0) kattamattomat['Liite (ei tositetta)'] = orvot;

    // --- Tositeloki: the source book's change history, oldest first ---
    const loki: AuditEntry[] = [];
    if (taulut.has('Tositeloki')) {
      for (const r of db
        .prepare('SELECT tosite, aika, data, userid, tila FROM Tositeloki ORDER BY id')
        .all() as {
        tosite: number | null;
        aika: string | null;
        data: string | Buffer | null;
        userid: number | null;
        tila: number | null;
      }[]) {
        if (r.tosite === null) continue;
        const teksti = r.data === null ? null : String(r.data);
        let data: unknown = null;
        if (teksti !== null && teksti !== '') {
          try {
            data = JSON.parse(teksti);
          } catch {
            data = teksti;
          }
        }
        const merkinta: AuditEntry = {
          tosite: r.tosite,
          tila: r.tila ?? 0,
          aika: kitsasAika(r.aika),
          lahde: KITSAS_LAHDE,
          data,
        };
        if (r.userid !== null) merkinta.userId = r.userid;
        loki.push(merkinta);
      }
    }

    // --- ohitetut taulut ---
    const ohitetut: Record<string, number> = {};
    for (const taulu of OHITETTAVAT_TAULUT) {
      const n = laske(db, taulu);
      if (n > 0) ohitetut[taulu] = n;
    }

    return {
      tilit,
      tilikaudet,
      asetukset,
      kumppanit,
      kohdennukset,
      budjetit,
      tositteet,
      liitteet,
      kpVersio,
      ohitetut,
      loki,
      kattamattomat,
      alvIlmoitukset,
    };
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
