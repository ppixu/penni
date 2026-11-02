/**
 * Kitsaksen laskutustietojen tuonti (spec §9): tuoterekisteri (`Tuote`), vakioviitteet
 * (`Vakioviite`), laskurivit (`Rivi`) sekä laskun json-lisätiedot (viivästyskorko,
 * maksumuistutuksen tiedot ja laskutusjakso). Lukijat palauttavat tyhjän, kun taulua ei ole.
 */
import {
  type IsoDate,
  type Muistutus,
  type TositeRivi,
  TositeTyyppi,
  type UusiTuote,
  type Vakioviite,
  onkoPvmValidi,
} from '@penni/engine';
import { type Cents, Euro } from '@penni/euro';
import type Database from 'better-sqlite3';
import { KASITELLYT_TOSITE_SISAKKAISET } from './muunna.js';
import type { KitsasTosite } from './tyypit.js';

type JsonOlio = Record<string, unknown>;

function lueOlio(json: string | null | undefined): JsonOlio {
  if (!json) return {};
  try {
    const arvo: unknown = JSON.parse(json);
    return arvo && typeof arvo === 'object' && !Array.isArray(arvo) ? (arvo as JsonOlio) : {};
  } catch {
    return {};
  }
}

function onTaulu(db: Database.Database, taulu: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(taulu) !== undefined
  );
}

/** Luku luvusta tai numeerisesta merkkijonosta; muuten undefined. */
function luku(arvo: unknown): number | undefined {
  if (typeof arvo === 'number') return Number.isFinite(arvo) ? arvo : undefined;
  if (typeof arvo === 'string' && arvo.trim() !== '') {
    const n = Number(arvo);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Nollasta poikkeava luku (Kitsaksen 0 = "ei asetettu" tilille, kohdennukselle ja tuotteelle). */
function nollaton(arvo: unknown): number | undefined {
  const n = luku(arvo);
  return n === undefined || n === 0 ? undefined : n;
}

/** Sisällöllinen arvo samassa merkityksessä kuin kattavuusauditissa (laskeKattamattomat). */
function onArvo(arvo: unknown): boolean {
  return !(
    arvo === undefined ||
    arvo === null ||
    arvo === '' ||
    (typeof arvo === 'object' && Object.keys(arvo).length === 0)
  );
}

function teksti(arvo: unknown): string | undefined {
  return typeof arvo === 'string' && arvo !== '' ? arvo : undefined;
}

/**
 * Euromäärä senteiksi ilman liukulukulaskentaa: Kitsas tallentaa muistutuksen summat joko
 * merkkijonona ("5.00", Lasku::setMuistutusmaksu, model/lasku.h:118) tai doublena (korko,
 * lasku.h:121), ja molemmat jäsennetään merkkijonona `Euro.fromString`illa.
 */
function sentit(arvo: unknown): Cents | undefined {
  if (typeof arvo !== 'number' && typeof arvo !== 'string') return undefined;
  if (typeof arvo === 'number' && !Number.isFinite(arvo)) return undefined;
  try {
    return Euro.fromString(String(arvo));
  } catch {
    return undefined;
  }
}

function pvm(arvo: unknown): IsoDate | undefined {
  return typeof arvo === 'string' && onkoPvmValidi(arvo) ? arvo : undefined;
}

// --- Tuote ---

/** Kitsaksen tuotteen json-avaimet (laskutus/tuote.cpp:24-62), joilla on Penni-vastine. */
const TUOTTEEN_KITSAS_AVAIMET = ['id', 'nimike', 'UNkoodi', 'ahinta', 'alvkoodi', 'alvprosentti'];

/**
 * Tuoterekisteri (`Tuote(id, nimike, json)`). Kitsas-id säilyy, jotta laskurivien `tuote`
 * osoittaa yhä oikeaan tuotteeseen. Tuntemattomat avaimet (`nimi`, …) säilyvät sellaisinaan.
 */
export function lueTuotteet(db: Database.Database): UusiTuote[] {
  if (!onTaulu(db, 'Tuote')) return [];
  const rivit = db.prepare('SELECT id, nimike, json FROM Tuote ORDER BY id').all() as {
    id: number;
    nimike: string | null;
    json: string | null;
  }[];
  return rivit.map((r) => {
    const json = lueOlio(r.json);
    const muut: JsonOlio = { ...json };
    for (const avain of [...TUOTTEEN_KITSAS_AVAIMET, 'yksikko', 'tili', 'kohdennus', 'koodi'])
      delete muut[avain];
    const tuote: UusiTuote = {
      ...muut,
      id: r.id,
      nimike: r.nimike ?? teksti(json.nimike) ?? '',
      aNetto: luku(json.ahinta) ?? 0,
      alvKoodi: luku(json.alvkoodi) ?? 0,
      alvProsentti: luku(json.alvprosentti) ?? 0,
    };
    const unKoodi = teksti(json.UNkoodi);
    if (unKoodi) tuote.unKoodi = unKoodi;
    const yksikko = teksti(json.yksikko);
    if (yksikko) tuote.yksikko = yksikko;
    const tili = nollaton(json.tili);
    if (tili !== undefined) tuote.tili = tili;
    const kohdennus = nollaton(json.kohdennus);
    if (kohdennus !== undefined) tuote.kohdennus = kohdennus;
    const koodi = teksti(json.koodi);
    if (koodi) tuote.koodi = koodi;
    return tuote;
  });
}

// --- Vakioviite ---

/**
 * Vakioviitteet (`Vakioviite(viite, tili, kohdennus, otsikko, alkaen, paattyen, json)`).
 * Sarakkeita `alkaen` ja `paattyen` Kitsas ei käytä, eikä niitä tuoda (spec §8.1). Viite luetaan tekstinä sellaisenaan (myös käsin syötettävän 4–7 numeron muodon ulkopuoliset;
 * kokonaisluku voi ylittää JS:n tarkan rajan). Json säilyy. Rivi ilman tiliä ei voi ohjata
 * maksua mihinkään: se jätetään pois ja lasketaan `kattamattomat`-raporttiin.
 */
export function lueVakioviitteet(
  db: Database.Database,
  kattamattomat?: Record<string, number>,
): Vakioviite[] {
  if (!onTaulu(db, 'Vakioviite')) return [];
  const rivit = db
    .prepare(
      'SELECT CAST(viite AS TEXT) AS viite, tili, kohdennus, otsikko, json FROM Vakioviite ORDER BY viite',
    )
    .all() as {
    viite: string;
    tili: number | null;
    kohdennus: number | null;
    otsikko: string | null;
    json: string | null;
  }[];
  const tulos: Vakioviite[] = [];
  for (const r of rivit) {
    const json = lueOlio(r.json);
    const tili = nollaton(r.tili) ?? nollaton(json.tili);
    if (tili === undefined) {
      if (kattamattomat)
        kattamattomat['Vakioviite (ei tiliä)'] = (kattamattomat['Vakioviite (ei tiliä)'] ?? 0) + 1;
      continue;
    }
    const { kohdennus: _k, tili: _t, viite: _v, otsikko: _o, ...muut } = json;
    const viite: Vakioviite = {
      ...muut,
      viite: r.viite,
      tili,
      otsikko: r.otsikko ?? teksti(json.otsikko) ?? '',
    };
    const kohdennus = nollaton(r.kohdennus) ?? nollaton(json.kohdennus);
    if (kohdennus !== undefined) viite.kohdennus = kohdennus;
    tulos.push(viite);
  }
  return tulos;
}

// --- Rivi ---

/** Rivin json-avaimet, joilla on Penni-vastine (tai jotka ovat sarakkeiden kopioita). */
const KASITELLYT_RIVI_JSON = new Set([
  'tosite',
  'rivi',
  'tuote',
  'myyntikpl',
  'ahinta',
  'alvkoodi',
  'alvprosentti',
  'aleprosentti',
  'euroalennus',
  'unkoodi',
  'yksikko',
  'nimike',
  'kuvaus',
  'tili',
  'kohdennus',
]);

interface KitsasRiviRivi {
  tosite: number;
  rivi: number;
  tuote: number | string | null;
  myyntikpl: number | null;
  ostokpl: number | null;
  ahinta: number | null;
  json: string | null;
}

/**
 * Yhdistä sarakkeet jsonin päälle kuten Kitsaksen `resultList` (sqlite/sqliteroute.cpp:91-133):
 * ensin json, sitten jokainen sarake, jonka arvo ei ole tyhjä eikä "0".
 */
function yhdistaSarakkeet(r: KitsasRiviRivi): JsonOlio {
  const tulos: JsonOlio = lueOlio(r.json);
  const { json: _json, ...sarakkeet } = r;
  for (const [nimi, arvo] of Object.entries(sarakkeet)) {
    if (arvo === null || String(arvo) === '' || String(arvo) === '0') continue;
    tulos[nimi] = arvo;
  }
  return tulos;
}

function muunnaRivi(r: KitsasRiviRivi): TositeRivi {
  const m = yhdistaSarakkeet(r);
  // Määrä ja hinta suoraan sarakkeesta, myös nolla: resultList pudottaa nollan, ja Kitsaksen
  // TositeRivi lukee puuttuvan määrän nollaksi (model/tositerivi.h:32), ei ykköseksi.
  const rivi: TositeRivi = {
    myyntiKpl: r.myyntikpl ?? luku(m.myyntikpl) ?? 1,
    aNetto: r.ahinta ?? luku(m.ahinta) ?? 0,
    alvKoodi: luku(m.alvkoodi) ?? 0,
    alvProsentti: luku(m.alvprosentti) ?? 0,
  };
  const ale = nollaton(m.aleprosentti);
  if (ale !== undefined) rivi.aleProsentti = ale;
  const euroAlennus = nollaton(m.euroalennus);
  if (euroAlennus !== undefined) rivi.euroAlennus = euroAlennus;
  const unKoodi = teksti(m.unkoodi);
  if (unKoodi) rivi.unKoodi = unKoodi;
  const yksikko = teksti(m.yksikko);
  if (yksikko) rivi.yksikko = yksikko;
  const selite = [teksti(m.nimike), teksti(m.kuvaus)].filter(Boolean).join(' – ');
  if (selite) rivi.selite = selite;
  const tili = nollaton(m.tili);
  if (tili !== undefined) rivi.tili = tili;
  const kohdennus = nollaton(m.kohdennus);
  if (kohdennus !== undefined) rivi.kohdennus = kohdennus;
  const tuote = nollaton(m.tuote);
  if (tuote !== undefined) rivi.tuote = tuote;
  return rivi;
}

/**
 * Laskurivit (`Rivi`, luo.sql:181-193) Kitsas-tositteen id:n mukaan, rivinumerojärjestyksessä
 * (Kitsas itse lukee ilman ORDER BY:tä, tositeroute.cpp:486-489). `pudotetut` laskee rivien
 * tiedot, joita ei tuoda, muodossa `Rivi.json.<avain>` → esiintymät: `ennakkoera` (Kitsaksen
 * erämalli eroaa Pennin ennakkolaskuista) ja muut tuntemattomat avaimet, sekä `Rivi.ostokpl`.
 *
 * Maksumuistutuksen (216) rivejä ei lueta: Kitsas kirjoittaa niihin vain näyttörivit (aiempi
 * saldo, muistutusmaksu, korko), jotka Pennissä korvaa tositteen `muistutus` (spec §4.2).
 * Ne ovat siis katettuja eivätkä näy `pudotetut`-laskennassa.
 */
export function lueRivit(db: Database.Database): {
  rivit: Map<number, TositeRivi[]>;
  pudotetut: Record<string, number>;
} {
  const rivit = new Map<number, TositeRivi[]>();
  const pudotetut: Record<string, number> = {};
  if (!onTaulu(db, 'Rivi')) return { rivit, pudotetut };
  const laske = (nimi: string): void => {
    pudotetut[nimi] = (pudotetut[nimi] ?? 0) + 1;
  };
  for (const r of db
    .prepare(
      `SELECT Rivi.tosite, Rivi.rivi, Rivi.tuote, Rivi.myyntikpl, Rivi.ostokpl, Rivi.ahinta,
              Rivi.json
       FROM Rivi LEFT JOIN Tosite ON Tosite.id = Rivi.tosite
       WHERE Tosite.tyyppi IS NOT ${TositeTyyppi.MAKSUMUISTUTUS}
       ORDER BY Rivi.tosite, Rivi.rivi`,
    )
    .all() as KitsasRiviRivi[]) {
    const lista = rivit.get(r.tosite) ?? [];
    lista.push(muunnaRivi(r));
    rivit.set(r.tosite, lista);
    if (nollaton(r.ostokpl) !== undefined) laske('Rivi.ostokpl');
    for (const [avain, arvo] of Object.entries(lueOlio(r.json))) {
      if (KASITELLYT_RIVI_JSON.has(avain) || !onArvo(arvo)) continue;
      laske(`Rivi.json.${avain}`);
    }
  }
  return { rivit, pudotetut };
}

/**
 * Liitä luetut rivit tositteisiinsa Kitsas-tosite-id:llä ja lisää pudotetut kattavuusraporttiin.
 * Maksumuistutukselle (216) ei liitetä rivejä (ks. `lueRivit`).
 */
export function liitaRivit(
  tositteet: KitsasTosite[],
  luetut: ReturnType<typeof lueRivit>,
  kattamattomat: Record<string, number>,
): void {
  for (const tosite of tositteet) {
    if (tosite.tyyppi === TositeTyyppi.MAKSUMUISTUTUS) continue;
    const rivit = luetut.rivit.get(tosite.id);
    if (rivit) tosite.rivit = rivit;
  }
  for (const [nimi, maara] of Object.entries(luetut.pudotetut))
    kattamattomat[nimi] = (kattamattomat[nimi] ?? 0) + maara;
}

// --- Laskun lisätiedot ---

/** Maksumuistutuksen avaimet tositteen json `lasku`-kartassa (model/lasku.h:90-127). */
const MUISTUTUKSEN_AVAIMET = [
  'muistutusmaksu',
  'korko',
  'korkoalkaa',
  'korkoloppuu',
  'aiempisaldo',
] as const;

/** Tositteen json `lasku`-kartta tositteittain (Kitsas-id → kartta); vain tositteet, joilla se on. */
export function lueLaskut(
  tositeRivit: readonly { id: number; json: string | null }[],
): Map<number, JsonOlio> {
  const laskut = new Map<number, JsonOlio>();
  for (const rivi of tositeRivit) {
    const lasku = lueOlio(rivi.json).lasku;
    if (lasku && typeof lasku === 'object' && !Array.isArray(lasku))
      laskut.set(rivi.id, lasku as JsonOlio);
  }
  return laskut;
}

/** Laskun numero Kitsaksen `alkupNro`sta (luku tai merkkijono), kuten hyvityslaskuilla. */
function alkupNro(lasku: JsonOlio): string | undefined {
  const nro = lasku.alkupNro;
  return typeof nro === 'number' || (typeof nro === 'string' && nro !== '')
    ? String(nro)
    : undefined;
}

/**
 * Laskutusjakso json `lasku`-kartasta: kelvollinen `jaksopvm` loppuna, alkuna `toimituspvm`,
 * sen puuttuessa laskupäivä (tositteen `laskupvm`, json `pvm`, tositteen `pvm`). Jos alku on
 * lopun jälkeen, jaksoa ei ole.
 */
function laskunJakso(
  lasku: JsonOlio,
  laskupvm: string | null | undefined,
  tositePvm: string,
): { alkaa: IsoDate; loppuu: IsoDate } | undefined {
  const loppuu = pvm(lasku.jaksopvm);
  if (!loppuu) return undefined;
  const alkaa = pvm(lasku.toimituspvm) ?? (laskupvm || undefined) ?? pvm(lasku.pvm) ?? tositePvm;
  return alkaa <= loppuu ? { alkaa, loppuu } : undefined;
}

/**
 * Täydennä tuodut tositteet laskun lisätiedoilla (`lasku` = Kitsas-tosite-id → json `lasku`):
 * - `viivkorko` säilyy tositteella (muistutuksen korkoprosentti haetaan siitä);
 * - kelvollinen jakso (`laskunJakso`) → `jakso`;
 * - `alkupNro` liitetään laskuun sen numerolla kuten hyvityslaskut (`alkuperainenTosite`). Jos
 *   laskua ei löydy, viittaus jää asettamatta;
 * - maksumuistutuksella (216), jolla on jokin muistutusavaimista, → `muistutus` (summat
 *   sentteinä, `aiemmat` = alkuperäinen lasku). Korkoprosentti on muistutuksen oma `viivkorko`,
 *   muuten alkuperäisen laskun. Jos kumpaakaan ei ole, `muistutus` jää asettamatta (prosenttia
 *   ei keksitä): luonnos ei silloin kirjaudu (EIMUISTUTUSTIETOJA), ja Pennissä uudelleen luotu
 *   muistutus käyttää moottorin oletuskorkoa. Tuomatta jääneet muistutusavaimet lasketaan
 *   `kattamattomat`-raporttiin, kun se annetaan.
 */
export function taydennaLaskutiedot(
  tositteet: KitsasTosite[],
  lasku: Map<number, Record<string, unknown>>,
  kattamattomat?: Record<string, number>,
): void {
  const tositeNumerolla = new Map<string, number>();
  for (const t of tositteet) if (t.numero) tositeNumerolla.set(t.numero, t.id);

  for (const tosite of tositteet) {
    const tiedot = lasku.get(tosite.id);
    if (!tiedot) continue;

    const viivkorko = luku(tiedot.viivkorko);
    if (viivkorko !== undefined) tosite.viivkorko = viivkorko;

    const jakso = laskunJakso(tiedot, tosite.laskupvm, tosite.pvm);
    if (jakso) tosite.jakso = jakso;

    const nro = alkupNro(tiedot);
    const alkuperainen = nro !== undefined ? tositeNumerolla.get(nro) : undefined;
    if (alkuperainen !== undefined && alkuperainen !== tosite.id)
      tosite.alkuperainenTosite = alkuperainen;

    if (tosite.tyyppi !== TositeTyyppi.MAKSUMUISTUTUS) continue;
    const muistutusavaimet = MUISTUTUKSEN_AVAIMET.filter((avain) => onArvo(tiedot[avain]));
    if (muistutusavaimet.length === 0) continue;
    const korkoprosentti =
      viivkorko ??
      (tosite.alkuperainenTosite !== undefined
        ? luku(lasku.get(tosite.alkuperainenTosite)?.viivkorko)
        : undefined);
    if (korkoprosentti === undefined) {
      if (kattamattomat)
        for (const avain of muistutusavaimet) {
          const nimi = `Tosite.json.lasku.${avain}`;
          kattamattomat[nimi] = (kattamattomat[nimi] ?? 0) + 1;
        }
      continue;
    }
    tosite.muistutus = {
      maksu: sentit(tiedot.muistutusmaksu) ?? Euro.fromCents(0),
      korko: sentit(tiedot.korko) ?? Euro.fromCents(0),
      viivkorko: korkoprosentti,
      korkoalkaa: pvm(tiedot.korkoalkaa) ?? tosite.pvm,
      korkoloppuu: pvm(tiedot.korkoloppuu) ?? tosite.pvm,
      aiempiSaldo: sentit(tiedot.aiempisaldo) ?? Euro.fromCents(0),
      aiemmat: tosite.alkuperainenTosite !== undefined ? [tosite.alkuperainenTosite] : [],
    } satisfies Muistutus;
  }
}

/**
 * Tositteen json-kattavuusauditin sisäkkäiset avaimet laskutustiedot huomioiden: `viivkorko`
 * katetaan aina, `jaksopvm` ja `toimituspvm` vain kun niistä syntyy jakso (`laskunJakso`), ja
 * muistutusavaimet maksumuistutuksella. Pelkkä `toimituspvm` ilman jaksoa jää raporttiin
 * (spec §1). Muistutusavaimet, joita ei voitu tuoda korkoprosentin puuttuessa, raportoi
 * `taydennaLaskutiedot`.
 */
export function laskutusSisakkaiset(rivi: {
  tyyppi: number;
  json: string | null;
  pvm?: string;
  laskupvm?: string | null;
}): Record<string, ReadonlySet<string>> {
  const lasku = lueOlio(rivi.json).lasku;
  const avaimet = new Set(KASITELLYT_TOSITE_SISAKKAISET.lasku);
  avaimet.add('viivkorko');
  if (
    lasku &&
    typeof lasku === 'object' &&
    !Array.isArray(lasku) &&
    laskunJakso(lasku as JsonOlio, rivi.laskupvm, rivi.pvm ?? '')
  ) {
    avaimet.add('jaksopvm');
    avaimet.add('toimituspvm');
  }
  if (rivi.tyyppi === TositeTyyppi.MAKSUMUISTUTUS)
    for (const avain of MUISTUTUKSEN_AVAIMET) avaimet.add(avain);
  return { ...KASITELLYT_TOSITE_SISAKKAISET, lasku: avaimet };
}
