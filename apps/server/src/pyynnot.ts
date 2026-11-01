import { wireToCents } from '@penni/contract';
import type {
  AlvLaskelmaParams,
  BudjettivertailuParams,
  JaksotuksetParams,
  KohdennusRaporttiParams,
  MyyntilaskuSuodatin,
  OstolaskuListQuery,
  PoistolaskelmaParams,
  RahavirtaSuodatin,
  RaporttiParams,
  SaldotParams,
  TositeFilter,
  VerolaskelmaParams,
} from '@penni/engine';

/** A presence flag: true unless absent, 'false', '0', or ''. */
function lippu(v: string | undefined): boolean {
  return v !== undefined && v !== 'false' && v !== '0' && v !== '';
}

/**
 * A numeric query param, or undefined when absent, empty, or not a finite number.
 *
 * Kelvoton luku pudotetaan koko suodattimesta sen sijaan, että NaN välitettäisiin ajurille:
 * muistilla ja SQLitellä NaN-vertailu on aina epätosi (tyhjä tulos), mutta Postgresissa
 * INTEGER-sarakkeen sidonta kaatuu ("invalid input syntax for type integer: NaN") ja pyyntö
 * palauttaa paljaan 500:n. Ajureiden on täytettävä sama sopimus, joten sama syöte ei saa
 * käyttäytyä eri tavoin niiden välillä.
 */
function numero(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const BUCKETIT: ReadonlyArray<NonNullable<TositeFilter['bucket']>> = [
  'kirjanpidossa',
  'luonnos',
  'saapuneet',
  'malli',
  'poistetut',
];

export interface TositeKysely {
  bucket?: string;
  alkupvm?: string;
  loppupvm?: string;
  pvm?: string;
  kumppani?: string;
  tyyppi?: string;
  viite?: string;
}

export function tositeSuodatin(q: TositeKysely): TositeFilter {
  const f: TositeFilter = {};
  if (q.bucket && (BUCKETIT as readonly string[]).includes(q.bucket))
    f.bucket = q.bucket as NonNullable<TositeFilter['bucket']>;
  if (q.alkupvm) f.alkupvm = q.alkupvm;
  if (q.loppupvm) f.loppupvm = q.loppupvm;
  if (q.pvm) f.pvm = q.pvm;
  const k = numero(q.kumppani);
  if (k !== undefined) f.kumppani = k;
  const t = numero(q.tyyppi);
  if (t !== undefined) f.tyyppi = t;
  if (q.viite) f.viite = q.viite;
  return f;
}

export interface ViennitKysely {
  alkupvm?: string;
  loppupvm?: string;
  tili?: string;
}

export function viennitSuodatin(q: ViennitKysely): {
  alkupvm?: string;
  loppupvm?: string;
  tili?: number;
} {
  const f: { alkupvm?: string; loppupvm?: string; tili?: number } = {};
  if (q.alkupvm) f.alkupvm = q.alkupvm;
  if (q.loppupvm) f.loppupvm = q.loppupvm;
  const t = numero(q.tili);
  if (t !== undefined) f.tili = t;
  return f;
}

export interface SaldotKysely {
  pvm: string;
  alkupvm?: string;
  tase?: string;
  tuloslaskelma?: string;
  tili?: string;
  kohdennus?: string;
  alkusaldot?: string;
}

export function saldotParametrit(q: SaldotKysely): SaldotParams {
  const p: SaldotParams = { pvm: q.pvm };
  if (q.alkupvm) p.alkupvm = q.alkupvm;
  if (lippu(q.alkusaldot)) p.alkusaldot = true;
  if (lippu(q.tase)) p.tase = true;
  if (lippu(q.tuloslaskelma)) p.tuloslaskelma = true;
  const t = numero(q.tili);
  if (t !== undefined) p.tili = t;
  const k = numero(q.kohdennus);
  if (k !== undefined) p.kohdennus = k;
  return p;
}

/** Map the /raportit query string to engine RaporttiParams. */
export function raporttiParametrit(q: {
  muoto: string;
  pvm: string;
  alkupvm?: string;
  erittelyt?: string;
  kaikkiRivit?: string;
  kohdennus?: string;
}): RaporttiParams {
  const kohdennus = numero(q.kohdennus);
  return {
    muoto: q.muoto,
    pvm: q.pvm,
    ...(q.alkupvm !== undefined ? { alkupvm: q.alkupvm } : {}),
    ...(lippu(q.erittelyt) ? { erittelyt: true } : {}),
    ...(lippu(q.kaikkiRivit) ? { kaikkiRivit: true } : {}),
    ...(kohdennus !== undefined ? { kohdennus } : {}),
  };
}

/** Map the /raportti/kohdennukset query string to engine KohdennusRaporttiParams. */
export function kohdennusRaporttiParametrit(q: {
  muoto: string;
  alkupvm: string;
  pvm: string;
  laji: 'kustannuspaikat' | 'projektit';
  kustannuspaikka?: string;
}): KohdennusRaporttiParams {
  const kustannuspaikka = numero(q.kustannuspaikka);
  return {
    muoto: q.muoto,
    alkupvm: q.alkupvm,
    pvm: q.pvm,
    laji: q.laji,
    ...(kustannuspaikka !== undefined ? { kustannuspaikka } : {}),
  };
}

/** Map the /raportti/budjettivertailu query string to engine BudjettivertailuParams. */
export function budjettivertailuParametrit(q: {
  muoto: string;
  tilikausi: string;
  pvm?: string;
  kohdennus?: string;
}): BudjettivertailuParams {
  const kohdennus = numero(q.kohdennus);
  return {
    muoto: q.muoto,
    tilikausi: q.tilikausi,
    ...(q.pvm ? { pvm: q.pvm } : {}),
    ...(kohdennus !== undefined ? { kohdennus } : {}),
  };
}

export interface MyyntilaskuKysely {
  alkupvm?: string;
  loppupvm?: string;
  eraalkupvm?: string;
  eraloppupvm?: string;
  avoin?: string;
  eraantynyt?: string;
  saldopvm?: string;
}

export function myyntilaskuSuodatin(q: MyyntilaskuKysely): MyyntilaskuSuodatin {
  const f: MyyntilaskuSuodatin = {};
  if (q.alkupvm) f.alkupvm = q.alkupvm;
  if (q.loppupvm) f.loppupvm = q.loppupvm;
  if (q.eraalkupvm) f.eraalkupvm = q.eraalkupvm;
  if (q.eraloppupvm) f.eraloppupvm = q.eraloppupvm;
  if (lippu(q.avoin)) f.avoin = true;
  if (q.eraantynyt) f.eraantynyt = q.eraantynyt;
  if (q.saldopvm) f.saldopvm = q.saldopvm;
  return f;
}

export interface RahavirtaKysely {
  alkupvm?: string;
  loppupvm?: string;
  kumppani?: string;
  avoin?: string;
  eraantynyt?: string;
  saldopvm?: string;
  bucket?: string;
}

export function rahavirtaSuodatin(q: RahavirtaKysely): RahavirtaSuodatin {
  const f: RahavirtaSuodatin = {};
  if (q.alkupvm) f.alkupvm = q.alkupvm;
  if (q.loppupvm) f.loppupvm = q.loppupvm;
  const kumppani = numero(q.kumppani);
  if (kumppani !== undefined) f.kumppani = kumppani;
  if (lippu(q.avoin)) f.avoin = true;
  if (q.eraantynyt) f.eraantynyt = q.eraantynyt;
  if (q.saldopvm) f.saldopvm = q.saldopvm;
  if (q.bucket && (BUCKETIT as readonly string[]).includes(q.bucket))
    f.bucket = q.bucket as NonNullable<RahavirtaSuodatin['bucket']>;
  return f;
}

export interface OstolaskuKysely {
  alkupvm?: string;
  loppupvm?: string;
  eraalkupvm?: string;
  eraloppupvm?: string;
  avoin?: string;
  eraantynyt?: string;
  saldopvm?: string;
}

export function ostolaskuSuodatin(q: OstolaskuKysely): OstolaskuListQuery {
  const f: OstolaskuListQuery = {};
  if (q.alkupvm) f.alkupvm = q.alkupvm;
  if (q.loppupvm) f.loppupvm = q.loppupvm;
  if (q.eraalkupvm) f.eraalkupvm = q.eraalkupvm;
  if (q.eraloppupvm) f.eraloppupvm = q.eraloppupvm;
  if (lippu(q.avoin)) f.avoin = true;
  if (q.eraantynyt) f.eraantynyt = q.eraantynyt;
  if (q.saldopvm) f.saldopvm = q.saldopvm;
  return f;
}

/** Kuvaa /alv-kyselyparametrit moottorin AlvLaskelmaParams-muotoon. */
export function alvLaskelmaParametrit(q: { alkupvm: string; loppupvm: string }): AlvLaskelmaParams {
  return { alkupvm: q.alkupvm, loppupvm: q.loppupvm };
}

/** Kuvaa /tulovero-kyselyparametrit moottorin VerolaskelmaParams-muotoon. */
export function verolaskelmaParametrit(q: {
  alkupvm: string;
  loppupvm: string;
  aiempiTappio?: string;
}): VerolaskelmaParams {
  const p: VerolaskelmaParams = { alkupvm: q.alkupvm, loppupvm: q.loppupvm };
  if (q.aiempiTappio !== undefined) p.aiempiTappio = wireToCents(q.aiempiTappio);
  return p;
}

/** Kuvaa /poistot-kyselyparametrit moottorin PoistolaskelmaParams-muotoon. */
export function poistotParametrit(q: { loppupvm: string }): PoistolaskelmaParams {
  return { loppupvm: q.loppupvm };
}

/** Kuvaa /jaksotukset-kyselyparametrit moottorin JaksotuksetParams-muotoon. */
export function jaksotuksetParametrit(q: { loppupvm: string }): JaksotuksetParams {
  return { loppupvm: q.loppupvm };
}
