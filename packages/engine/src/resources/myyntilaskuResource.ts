import type { Cents } from '@penni/euro';
import { ViiteTyyppi, viiteEralle } from '@penni/validator';
import { Luonne } from '../accounts/luonne.js';
import { tiliTyypilla } from '../accounts/tili.js';
import { AlvKoodi } from '../alv/koodit.js';
import { generoiLaskunViennit } from '../laskutus/generoiLaskunViennit.js';
import { kasvataLaskunumeroa, lueSeuraavaLaskunumero } from '../laskutus/seuraavaLaskunumero.js';
import type { Kumppani } from '../partners/kumppani.js';
import {
  Maksutapa,
  TositeTila,
  TositeTyyppi,
  VientiTyyppi,
  onKirjanpidossa,
} from '../vouchers/enums.js';
import type { IsoDate, Tosite, TositeRivi, TositeVienti } from '../vouchers/types.js';
import { onkoMaksuperusteinenAlv } from './context.js';
import { ENNAKKO_ALV_LYKATTY, tunnistaVeroVienti } from './maksuperusteinenTunnistus.js';
import {
  type Asetukset,
  type ResourceEnv,
  ResourceError,
  type Storage,
  type StoredTosite,
} from './storage.js';
import { tallennaTosite } from './tositeResource.js';

export type MyyntilaskuSyote = {
  pvm: IsoDate;
  laskupvm?: IsoDate; // defaults to pvm
  erapvm?: IsoDate;
  kumppani?: number;
  otsikko?: string;
  maksutapa?: number; // defaults to Maksutapa.LASKU
  sarja?: string;
  rivit: TositeRivi[]; // required, >= 1
  jakso?: { alkaa: IsoDate; loppuu: IsoDate }; // laskutettava ajanjakso (valinnainen)
  info?: string; // vapaamuotoiset lisätiedot
  luonnos?: boolean; // true: tallenna luonnokseksi (ei numeroa, viitettä eikä vientejä)
  id?: number; // olemassa oleva luonnos, jota päivitetään / kirjataan
  toisto?: number; // Toisto.id, josta luonnos on luotu
  toistoPvm?: IsoDate;
  ryhma?: string; // ryhmälaskun tunniste
  viivkorko?: number; // viivästyskorko %
};

/** Hylkää jakson, jolta puuttuu päivä tai jonka loppu on ennen alkua. Puuttuva jakso kelpaa. */
export function validoiJakso(jakso: Tosite['jakso']): void {
  if (jakso === undefined) return;
  if (!jakso.alkaa || !jakso.loppuu)
    throw new ResourceError('EIJAKSO', 'Laskutusjaksolta puuttuu alku- tai loppupäivä');
  if (jakso.loppuu < jakso.alkaa)
    throw new ResourceError('EIJAKSO', 'Laskutusjakson loppu on ennen alkua');
}

/** Parse a positive account number from a settings key; undefined if missing/blank/invalid. */
export function tiliAsetuksesta(asetukset: Asetukset, avain: string): number | undefined {
  const arvo = asetukset[avain];
  if (arvo === undefined || arvo === '') return undefined;
  const n = Number(arvo);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Erää kantava vienti (spec §4.5): myyntisaatava (tyyppi 202, debet) ensin, muuten ensimmäinen
 * erällinen vienti. Tuoduilla Kitsaksen ennakkolaskuilla on kaksi erällistä vientiä.
 */
export function eranVienti(viennit: readonly TositeVienti[]): TositeVienti | undefined {
  return (
    viennit.find(
      (v) =>
        v.era != null &&
        v.tyyppi === VientiTyyppi.MYYNTI + VientiTyyppi.VASTAKIRJAUS &&
        v.debet > 0,
    ) ?? viennit.find((v) => v.era != null && (v.debet > 0 || v.kredit > 0))
  );
}

/** Kirjattu (ei luonnos eikä poistettu) maksumuistutus. */
function onKirjattuMuistutus(t: StoredTosite): boolean {
  return t.tyyppi === TositeTyyppi.MAKSUMUISTUTUS && onKirjanpidossa(t.tila);
}

/** Muistutuksen veloitus: maksu + korko; tuodulla muistutuksella ilman tietoja erävientin debet. */
export function muistutuksenSumma(t: StoredTosite): Cents {
  if (t.muistutus) return (t.muistutus.maksu + t.muistutus.korko) as Cents;
  return (eranVienti(t.viennit)?.debet ?? 0) as Cents;
}

/**
 * Erälle kirjattujen maksumuistutusten kulut: Σ(maksu + korko) kirjatuista muistutuksista, joiden
 * `alkuperainenTosite === era` (erän id = laskun id). Maksuperusteisen alv:n suoritusosuus
 * lasketaan pääomasta näiden kulujen ohi (spec §4.4).
 */
export async function muistutusKulut(storage: Storage, era: number): Promise<Cents> {
  const muistutukset = await storage.listTositteet({ tyyppi: TositeTyyppi.MAKSUMUISTUTUS });
  let kulut = 0;
  for (const m of muistutukset)
    if (m.alkuperainenTosite === era && onKirjattuMuistutus(m)) kulut += muistutuksenSumma(m);
  return kulut as Cents;
}

/** Kirjattujen muistutusten lukumäärä alkuperäisen laskun id:n mukaan. */
export function muistutustenMaarat(tositteet: readonly StoredTosite[]): Map<number, number> {
  const maarat = new Map<number, number>();
  for (const t of tositteet)
    if (onKirjattuMuistutus(t) && t.alkuperainenTosite !== undefined)
      maarat.set(t.alkuperainenTosite, (maarat.get(t.alkuperainenTosite) ?? 0) + 1);
  return maarat;
}

/** Avaako maksutapa saatavaerän: lasku ja ennakkolasku kyllä, käteis- ja korttimyynti ei. */
function avaaEran(maksutapa: number): boolean {
  return maksutapa === Maksutapa.LASKU || maksutapa === Maksutapa.ENNAKKOLASKU;
}

/** Luonnoksen tilat: 50 (tuotu Kitsas-luonnos) .. 99 (VALMISLASKU 80). */
function onLuonnosTila(tila: number): boolean {
  return tila >= TositeTila.LUONNOS && tila < TositeTila.KIRJANPIDOSSA;
}

/** Hakee päivitettävän/kirjattavan luonnoksen; kirjattu, poistettu tai muuntyyppinen id → EILUONNOS. */
async function haeMyyntilaskuluonnos(storage: Storage, id: number): Promise<StoredTosite> {
  const vanha = await storage.getTosite(id);
  if (!vanha || vanha.tyyppi !== TositeTyyppi.MYYNTILASKU || !onLuonnosTila(vanha.tila))
    throw new ResourceError('EILUONNOS', `Tosite ${id} ei ole myyntilaskuluonnos`);
  return vanha;
}

/**
 * Tarkistaa rivit ja tilit (asetuksista) ja palauttaa kirjaukseen tarvittavat tilit. Sama tarkistus
 * ajetaan luonnoksille, jotta puuttuva tiliasetus paljastuu jo tallennettaessa eikä vasta kirjatessa.
 */
async function ratkaiseLaskunTilit(storage: Storage, syote: MyyntilaskuSyote) {
  if (!syote.rivit || syote.rivit.length === 0)
    throw new ResourceError('EIRIVEJA', 'Myyntilaskulla on oltava vähintään yksi rivi');

  validoiJakso(syote.jakso);

  const maksutapa = syote.maksutapa ?? Maksutapa.LASKU;
  const ennakko = maksutapa === Maksutapa.ENNAKKOLASKU;
  const asetukset = await storage.getAsetukset();

  const oletusMyynti = tiliAsetuksesta(asetukset, 'OletusMyyntitili');
  const alvVelka = tiliAsetuksesta(asetukset, 'AlvVelkaTili');
  const saatava = tiliAsetuksesta(asetukset, 'LaskuSaatavaTili');
  const kateinen = tiliAsetuksesta(asetukset, 'LaskuKateistili');
  const kortti = tiliAsetuksesta(asetukset, 'LaskuKorttitili');
  const ennakkosaatavat = tiliAsetuksesta(asetukset, 'LaskuEnnakkosaatavat');
  const ennakkotili = tiliAsetuksesta(asetukset, 'LaskuEnnakkotili');
  const ennakkoAlv = tiliAsetuksesta(asetukset, 'LaskuEnnakkoALV');

  if (ennakko) {
    // Ennakkolasku kirjataan aina ennakkotileille (rivin oma tili ohitetaan, spec §6.1).
    if (ennakkosaatavat === undefined || ennakkotili === undefined || ennakkoAlv === undefined)
      throw new ResourceError(
        'EILASKUTILIA',
        'Ennakkolaskun tili puuttuu (LaskuEnnakkosaatavat / LaskuEnnakkotili / LaskuEnnakkoALV)',
      );
  } else {
    // Every row needs a resolvable revenue account; an advance deduction row its own (2861).
    for (const r of syote.rivit) {
      const tili = r.ennakkoTosite != null ? (r.tili ?? ennakkotili) : (r.tili ?? oletusMyynti);
      if (tili === undefined)
        throw new ResourceError(
          'EILASKUTILIA',
          r.ennakkoTosite != null
            ? 'Ennakon hyvitysriviltä puuttuu tili (aseta LaskuEnnakkotili)'
            : 'Riviltä puuttuu myyntitili (aseta OletusMyyntitili)',
        );
    }
    // VAT rows need the payable account.
    const onAlvia = syote.rivit.some(
      (r) => r.alvKoodi === AlvKoodi.MYYNNIT_NETTO && r.alvProsentti > 0,
    );
    if (onAlvia && alvVelka === undefined)
      throw new ResourceError('EILASKUTILIA', 'AlvVelkaTili puuttuu');
  }
  // Counter account per payment method.
  const vastatili =
    maksutapa === Maksutapa.KATEINEN
      ? kateinen
      : maksutapa === Maksutapa.KORTTIMAKSU
        ? kortti
        : ennakko
          ? ennakkosaatavat
          : saatava;
  if (vastatili === undefined)
    throw new ResourceError(
      'EILASKUTILIA',
      'Vastatili puuttuu (LaskuSaatavaTili / LaskuKateistili / LaskuKorttitili)',
    );

  // Maksuperusteinen alv koskee vain LASKU-myyntiä (käteis-/korttimyynti pysyy suoriteperusteisena).
  // Ennakkolasku ei koskaan käytä 418-lykkäystä: sen alv lykätään aina koodilla 451 (spec §6.1).
  const maksuperusteinen =
    onkoMaksuperusteinenAlv(asetukset, syote.pvm) && maksutapa === Maksutapa.LASKU;
  let kohdentamatonAlvVelka = 0;
  if (maksuperusteinen) {
    const chart = await storage.getChart();
    const tili = tiliTyypilla(chart, Luonne.KOHDENTAMATONALVVELKA);
    if (!tili)
      throw new ResourceError(
        'EIKOHDENTAMATONTILIA',
        'Maksuperusteisen alv:n kohdentamaton velkatili puuttuu tilikartasta',
      );
    kohdentamatonAlvVelka = tili.numero;
  }

  return {
    maksutapa,
    asetukset,
    maksuperusteinen,
    tilit: {
      saatava: saatava ?? 0,
      kateinen: kateinen ?? 0,
      kortti: kortti ?? 0,
      oletusMyynti: oletusMyynti ?? 0,
      alvVelka: alvVelka ?? 0,
      kohdentamatonAlvVelka,
      ennakkosaatavat: ennakkosaatavat ?? 0,
      ennakkotili: ennakkotili ?? 0,
      ennakkoAlv: ennakkoAlv ?? 0,
    },
  };
}

/** Kentät, jotka luonnos ja kirjattu lasku jakavat (ei numeroa, viitettä, vientejä eikä tilaa). */
function laskunYhteisetKentat(syote: MyyntilaskuSyote, maksutapa: number) {
  return {
    pvm: syote.pvm,
    tyyppi: TositeTyyppi.MYYNTILASKU,
    sarja: syote.sarja ?? '',
    laskupvm: syote.laskupvm ?? syote.pvm,
    maksutapa,
    rivit: syote.rivit,
    ...(syote.jakso !== undefined ? { jakso: syote.jakso } : {}),
    ...(syote.kumppani !== undefined ? { kumppani: syote.kumppani } : {}),
    ...(syote.erapvm !== undefined ? { erapvm: syote.erapvm } : {}),
    ...(syote.otsikko !== undefined ? { otsikko: syote.otsikko } : {}),
    ...(syote.info !== undefined ? { info: syote.info } : {}),
    ...(syote.viivkorko !== undefined ? { viivkorko: syote.viivkorko } : {}),
    ...(syote.toisto !== undefined ? { toisto: syote.toisto } : {}),
    ...(syote.toistoPvm !== undefined ? { toistoPvm: syote.toistoPvm } : {}),
    ...(syote.ryhma !== undefined ? { ryhma: syote.ryhma } : {}),
  };
}

/**
 * Tallentaa myyntilaskun. `luonnos: true` tallentaa luonnoksen (tila 80, ei numeroa, viitettä eikä
 * vientejä; `id` päivittää olemassa olevaa luonnosta), muuten laskun kirjataan (tila 100).
 */
export async function tallennaMyyntilasku(
  storage: Storage,
  syote: MyyntilaskuSyote,
  env: ResourceEnv,
): Promise<StoredTosite> {
  if (!syote.luonnos) return kirjaaMyyntilaskuYdin(storage, syote, env, syote.id);

  const { maksutapa } = await ratkaiseLaskunTilit(storage, syote);
  const vanha = syote.id !== undefined ? await haeMyyntilaskuluonnos(storage, syote.id) : null;
  return tallennaTosite(
    storage,
    {
      ...laskunYhteisetKentat(syote, maksutapa),
      ...(vanha ? { id: vanha.id } : {}),
      tila: vanha?.tila ?? TositeTila.VALMISLASKU,
      viennit: [],
    },
    env,
  );
}

/**
 * Kirjauksen ydin: ratkaisee tilit ja numeroinnin asetuksista, generoi kolmen vientirivin
 * kirjaukset ja delegoi tunnisteen, validoinnin ja tallennuksen tallennaTositteelle. Annettu `id`
 * kirjaa olemassa olevan luonnoksen samalla id:llä (saveTosite upsertaa), jolloin eräavain
 * (tosite.id) pysyy luonnoksen id:nä.
 */
export async function kirjaaMyyntilaskuYdin(
  storage: Storage,
  syote: MyyntilaskuSyote,
  env: ResourceEnv,
  id?: number,
): Promise<StoredTosite> {
  const { maksutapa, asetukset, maksuperusteinen, tilit } = await ratkaiseLaskunTilit(
    storage,
    syote,
  );
  if (id !== undefined) await haeMyyntilaskuluonnos(storage, id);
  if (maksutapa === Maksutapa.ENNAKKOLASKU && syote.kumppani === undefined)
    throw new ResourceError('EIKUMPPANIA', 'Ennakkolaskulla on oltava asiakas');

  // Invoice number + reference (mirrors tositeroute.cpp:235-265).
  const numero = lueSeuraavaLaskunumero(asetukset);
  const viite = viiteEralle(ViiteTyyppi.LASKU, Number(numero));

  const viennit = generoiLaskunViennit({
    rivit: syote.rivit,
    maksutapa,
    pvm: syote.pvm,
    tilit,
    maksuperusteinen,
    ...(syote.otsikko !== undefined ? { otsikko: syote.otsikko } : {}),
    ...(syote.jakso !== undefined ? { jakso: syote.jakso } : {}),
  });
  // Loppulasku, jolla on ennakon vähennys: saatava = normaalit rivit − vähennys > 0 (spec §6.1).
  if (
    maksutapa !== Maksutapa.ENNAKKOLASKU &&
    syote.rivit.some((r) => r.ennakkoTosite != null) &&
    (viennit[0]?.debet ?? 0) <= 0
  )
    throw new ResourceError(
      'EISUMMAA',
      'Ennakon hyvitys on suurempi kuin lasku: laskun loppusumman on oltava positiivinen',
    );

  const posted = await tallennaTosite(
    storage,
    {
      ...laskunYhteisetKentat(syote, maksutapa),
      ...(id !== undefined ? { id } : {}),
      tila: TositeTila.KIRJANPIDOSSA,
      numero,
      viite,
      viennit,
    },
    env,
  );
  // Laskuri etenee heti numeron antaneen tallennuksen jälkeen: hylätty kirjaus ei polta numeroa,
  // mutta myöhempi erän patch ei voi jättää numeroa käyttöön uudelle laskulle.
  await kasvataLaskunumeroa(storage, numero);

  // Lasku (LASKU) ja ennakkolasku (ENNAKKOLASKU): avaa erä (myynti- tai ennakko)saatavariville
  // käyttäen tosite.id:tä globaalisti uniikkina eräavaimena (sama kaksivaiheinen tallennus kuin
  // ostolaskussa). Käteis-/korttimyynti ei avaa erää.
  if (!avaaEran(maksutapa)) return posted;
  const viennitEralla = posted.viennit.map((v) =>
    v.tyyppi === VientiTyyppi.MYYNTI + VientiTyyppi.VASTAKIRJAUS && v.debet > 0
      ? { ...v, era: posted.id }
      : v,
  );
  return tallennaTosite(storage, { ...posted, viennit: viennitEralla }, env);
}

export interface MyyntilaskuSuodatin {
  alkupvm?: IsoDate; // laskupvm >=
  loppupvm?: IsoDate; // laskupvm <=
  eraalkupvm?: IsoDate; // erapvm >=
  eraloppupvm?: IsoDate; // erapvm <=
  avoin?: boolean; // only rows with avoin !== 0
  eraantynyt?: IsoDate; // only rows with erapvm < this AND avoin !== 0 (overdue)
  saldopvm?: IsoDate; // era balance as of this date
}

export interface MyyntilaskuRivi {
  tosite: number; // invoice tosite id
  pvm?: IsoDate; // laskupvm (falls back to pvm)
  erapvm?: IsoDate;
  viite?: string;
  numero?: string;
  asiakas?: string; // kumppani.nimi
  asiakasId?: number;
  summa: Cents; // invoice total = the era leg's debet (muistutus: maksu + korko)
  avoin: Cents; // open balance for this era (0 if no era / fully paid; aina 0 muistutukselle)
  era?: number;
  tili?: number; // AR account of the era leg
  tyyppi: number;
  tunniste: number;
  sarja: string;
  tila: number;
  maksutapa?: number;
  /** Maksumuistutus (216): erän avoin saldo kuuluu vain alkuperäisen laskun riville. */
  muistutus?: true;
  /** Laskulle kirjattujen maksumuistutusten määrä; puuttuu, jos muistutuksia ei ole. */
  muistutettu?: number;
}

/**
 * List sales invoices with a live open balance per invoice. Each invoice's open item is its
 * era leg (`eranVienti`, else the first debit leg, for summa/erä/tili); `avoin` comes from
 * queryErat (Σdebet − Σkredit over the era). Cash/card invoices have no era leg and show
 * avoin = 0 (paid). Payment vouchers are TILIOTE, never MYYNTILASKU, so they never appear here.
 * Kirjatut maksumuistutukset listataan omina riveinään (`muistutus: true`, summa = maksu + korko,
 * avoin 0): yhteisen erän avoin saldo näkyy vain alkuperäisellä laskulla, jolle lasketaan
 * `muistutettu` (laatijanlaskut.cpp:96-97).
 */
export async function listaaMyyntilaskut(
  storage: Storage,
  suodatin: MyyntilaskuSuodatin,
): Promise<MyyntilaskuRivi[]> {
  const [laskut, muistutukset] = await Promise.all([
    storage.listTositteet({ bucket: 'kirjanpidossa', tyyppi: TositeTyyppi.MYYNTILASKU }),
    storage.listTositteet({ bucket: 'kirjanpidossa', tyyppi: TositeTyyppi.MAKSUMUISTUTUS }),
  ]);
  const tositteet = [...laskut, ...muistutukset];
  const muistutettu = muistutustenMaarat(muistutukset);
  const eraMap = await storage.queryErat(
    suodatin.saldopvm !== undefined ? { saldopvm: suodatin.saldopvm } : {},
  );
  const kumppanit = new Map<number, Kumppani>((await storage.getKumppanit()).map((k) => [k.id, k]));

  const rivit: MyyntilaskuRivi[] = [];
  for (const t of tositteet) {
    const laskupvm = t.laskupvm ?? t.pvm;
    if (suodatin.alkupvm !== undefined && !(laskupvm >= suodatin.alkupvm)) continue;
    if (suodatin.loppupvm !== undefined && !(laskupvm <= suodatin.loppupvm)) continue;
    if (suodatin.eraalkupvm !== undefined && !(t.erapvm != null && t.erapvm >= suodatin.eraalkupvm))
      continue;
    if (
      suodatin.eraloppupvm !== undefined &&
      !(t.erapvm != null && t.erapvm <= suodatin.eraloppupvm)
    )
      continue;

    const onMuistutus = t.tyyppi === TositeTyyppi.MAKSUMUISTUTUS;
    const eraLeg = eranVienti(t.viennit) ?? t.viennit.find((v) => v.debet > 0);
    const summa = onMuistutus ? muistutuksenSumma(t) : ((eraLeg?.debet ?? 0) as Cents);
    const era = eraLeg?.era;
    const tili = eraLeg?.tili;
    const avoin = (era != null && !onMuistutus ? (eraMap.get(era) ?? 0) : 0) as Cents;

    if (suodatin.avoin && avoin === 0) continue;
    if (
      suodatin.eraantynyt !== undefined &&
      !(t.erapvm != null && t.erapvm < suodatin.eraantynyt && avoin !== 0)
    )
      continue;

    const k = t.kumppani != null ? kumppanit.get(t.kumppani) : undefined;
    const rivi: MyyntilaskuRivi = {
      tosite: t.id,
      pvm: laskupvm,
      summa,
      avoin,
      tyyppi: t.tyyppi,
      tunniste: t.tunniste,
      sarja: t.sarja,
      tila: t.tila,
    };
    if (t.erapvm !== undefined) rivi.erapvm = t.erapvm;
    if (t.viite !== undefined) rivi.viite = t.viite;
    if (t.numero !== undefined) rivi.numero = t.numero;
    if (era !== undefined) rivi.era = era;
    if (tili !== undefined) rivi.tili = tili;
    if (t.maksutapa !== undefined) rivi.maksutapa = t.maksutapa;
    if (onMuistutus) rivi.muistutus = true;
    const maara = muistutettu.get(t.id);
    if (maara !== undefined && !onMuistutus) rivi.muistutettu = maara;
    if (k) {
      rivi.asiakas = k.nimi;
      rivi.asiakasId = k.id;
    }
    rivit.push(rivi);
  }

  rivit.sort((a, b) => {
    const ap = a.pvm ?? '';
    const bp = b.pvm ?? '';
    if (ap !== bp) return ap < bp ? -1 : 1;
    const av = a.viite ?? '';
    const bv = b.viite ?? '';
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  return rivit;
}

export interface SuoritusSyote {
  tosite: number; // the invoice being paid
  pvm: IsoDate;
  summa: Cents; // payment amount (> 0)
  rahatili?: number; // bank/cash account; defaults to the LaskuMaksutili setting
  otsikko?: string;
}

/**
 * Record a payment against an invoice's open item (era) — sales (AR) or purchase (AP). Loads the
 * invoice, finds its era leg regardless of side, and posts a balanced two-leg TILIOTE voucher:
 * for AR (era leg debit) bank debit + AR credit carrying the era; for AP (era leg credit) bank
 * credit + AP debit carrying the era (both SUORITUS+VASTAKIRJAUS / SUORITUS+KIRJAUS). Partial and
 * over-payment are allowed; the voucher always balances so tarkasta passes. Paid stays derived
 * (no tila transition).
 */
export async function tallennaSuoritus(
  storage: Storage,
  syote: SuoritusSyote,
  env: ResourceEnv,
): Promise<StoredTosite> {
  if (syote.summa <= 0)
    throw new ResourceError('EISUMMAA', 'Suorituksen summan on oltava positiivinen');

  const lasku = await storage.getTosite(syote.tosite);
  if (!lasku) throw new ResourceError('EITOSITETTA', `Tositetta ${syote.tosite} ei ole`);

  // Maksumuistutus maksetaan alkuperäisen laskun erälle; erän avannut lasku on myös lykätyn
  // alv:n lähde. Nollamuistutuksella ei ole erävientiä, joten erä tulee laskulta (spec §4.5).
  let alkuperainen = lasku;
  if (lasku.tyyppi === TositeTyyppi.MAKSUMUISTUTUS && lasku.alkuperainenTosite !== undefined) {
    const a = await storage.getTosite(lasku.alkuperainenTosite);
    if (a) alkuperainen = a;
  }
  const eraLeg = eranVienti(lasku.viennit) ?? eranVienti(alkuperainen.viennit);
  if (!eraLeg || eraLeg.era == null)
    throw new ResourceError('EIAVOINTAERAA', 'Laskulla ei ole avointa erää');
  const era: number = eraLeg.era;
  const eratili = eraLeg.tili;
  const saatavaPuoli = eraLeg.debet > 0; // true: myyntisaatava (AR); false: ostovelka (AP)

  const asetukset = await storage.getAsetukset();
  const rahatili = syote.rahatili ?? tiliAsetuksesta(asetukset, 'LaskuMaksutili');
  if (rahatili === undefined)
    throw new ResourceError('EILASKUTILIA', 'Maksutili puuttuu (aseta LaskuMaksutili)');

  const nolla = 0 as Cents;
  // AR: pankki debet + saatava kredit. AP: pankki kredit + velka debet.
  const pankki: TositeVienti = {
    tili: rahatili,
    debet: saatavaPuoli ? syote.summa : nolla,
    kredit: saatavaPuoli ? nolla : syote.summa,
    pvm: syote.pvm,
    alvKoodi: 0,
    alvProsentti: 0,
    tyyppi: VientiTyyppi.SUORITUS + VientiTyyppi.VASTAKIRJAUS, // 302
  };
  const era_: TositeVienti = {
    tili: eratili,
    debet: saatavaPuoli ? nolla : syote.summa,
    kredit: saatavaPuoli ? syote.summa : nolla,
    pvm: syote.pvm,
    alvKoodi: 0,
    alvProsentti: 0,
    era,
    tyyppi: VientiTyyppi.SUORITUS + VientiTyyppi.KIRJAUS, // 301
  };
  if (syote.otsikko !== undefined) {
    pankki.selite = syote.otsikko;
    era_.selite = syote.otsikko;
  }

  const viennit: TositeVienti[] = [pankki, era_];

  // Maksuperusteinen alv: tunnista lykätyt alv-viennit (koodi 418 myynti / 428 osto) ja
  // kirjaa suoritusosuutta vastaava osuus verosta kohdentamattomalta tililtä oikealle
  // alv-tilille. Pyöristys kumulatiivista maksettua osuutta vasten -> ei kertymävirhettä.
  // Vain jos laskulla on lykättyä alv:ta, tarkistetaan onko se jo vanhennettu (skannaus
  // vältetään suoriteperusteisilla/tavallisilla laskuilla).
  const omatLykatyt = alkuperainen.viennit.filter((v) => v.alvKoodi === 418 || v.alvKoodi === 428);
  let maksuperusteiset = omatLykatyt;
  if (omatLykatyt.length > 0) {
    const kirjanpidossa = await storage.listTositteet({ bucket: 'kirjanpidossa' });
    const joVanhennettu = kirjanpidossa.some((tt) =>
      tt.viennit.some((v) => v.maksuperusteinenTosite === alkuperainen.id),
    );
    if (joVanhennettu) maksuperusteiset = [];
  }
  // Ennakkolaskun alv (451) tunnistetaan maksettaessa aina, maksuperusteisuudesta riippumatta
  // (spec §6.1, taydennysviennit.cpp:63-110); ennakon alv:ta ei vanhenneta.
  const lykatyt = [
    ...maksuperusteiset,
    ...alkuperainen.viennit.filter((v) => v.alvKoodi === ENNAKKO_ALV_LYKATTY),
  ];
  const alkuperainenEra = eranVienti(alkuperainen.viennit);
  if (lykatyt.length > 0 && alkuperainenEra) {
    // alkuperäinen bruttosumma (laskun erävienti, ei muistutuksen veloitus)
    const T = saatavaPuoli ? alkuperainenEra.debet : alkuperainenEra.kredit;
    const eraMap = await storage.queryErat({});
    const saldo = eraMap.get(era) ?? 0;
    // Suoritus kohdistuu ensin pääomaan: erälle kirjatut muistutuskulut eivät ole maksamatonta
    // laskun bruttoa (spec §4.4). Etumerkillinen; negatiivinen jos yli-/liikaa suoritettu.
    const avoinEnnen = saatavaPuoli ? saldo - (await muistutusKulut(storage, era)) : -saldo;
    const maksettuEnnen = Math.min(T, Math.max(0, T - avoinEnnen));
    const maksettuJalkeen = Math.min(T, maksettuEnnen + syote.summa);
    const chart = await storage.getChart();
    const alvVelka = tiliTyypilla(chart, Luonne.ALVVELKA);
    const alvSaatava = tiliTyypilla(chart, Luonne.ALVSAATAVA);

    for (const l of lykatyt) {
      viennit.push(
        ...tunnistaVeroVienti(
          l,
          T,
          maksettuEnnen,
          maksettuJalkeen,
          alvVelka,
          alvSaatava,
          syote.pvm,
          syote.otsikko,
        ),
      );
    }
  }

  return tallennaTosite(
    storage,
    {
      pvm: syote.pvm,
      tyyppi: TositeTyyppi.TILIOTE,
      tila: TositeTila.KIRJANPIDOSSA,
      sarja: '',
      viennit,
      ...(lasku.kumppani !== undefined ? { kumppani: lasku.kumppani } : {}),
      ...(syote.otsikko !== undefined ? { otsikko: syote.otsikko } : {}),
    },
    env,
  );
}
