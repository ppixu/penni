import type { Cents } from '@penni/euro';
import { ViiteTyyppi, viiteEralle } from '@penni/validator';
import { Luonne } from '../accounts/luonne.js';
import { tiliTyypilla } from '../accounts/tili.js';
import { AlvKoodi } from '../alv/koodit.js';
import { generoiLaskunViennit } from '../laskutus/generoiLaskunViennit.js';
import { kasvataLaskunumeroa, lueSeuraavaLaskunumero } from '../laskutus/seuraavaLaskunumero.js';
import type { Kumppani } from '../partners/kumppani.js';
import { Maksutapa, TositeTila, TositeTyyppi, VientiTyyppi } from '../vouchers/enums.js';
import type { IsoDate, Tosite, TositeRivi, TositeVienti } from '../vouchers/types.js';
import { onkoMaksuperusteinenAlv } from './context.js';
import { tunnistaVeroVienti } from './maksuperusteinenTunnistus.js';
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
  const asetukset = await storage.getAsetukset();

  const oletusMyynti = tiliAsetuksesta(asetukset, 'OletusMyyntitili');
  const alvVelka = tiliAsetuksesta(asetukset, 'AlvVelkaTili');
  const saatava = tiliAsetuksesta(asetukset, 'LaskuSaatavaTili');
  const kateinen = tiliAsetuksesta(asetukset, 'LaskuKateistili');
  const kortti = tiliAsetuksesta(asetukset, 'LaskuKorttitili');

  // Every row needs a resolvable revenue account.
  for (const r of syote.rivit) {
    if ((r.tili ?? oletusMyynti) === undefined)
      throw new ResourceError(
        'EILASKUTILIA',
        'Riviltä puuttuu myyntitili (aseta OletusMyyntitili)',
      );
  }
  // VAT rows need the payable account.
  const onAlvia = syote.rivit.some(
    (r) => r.alvKoodi === AlvKoodi.MYYNNIT_NETTO && r.alvProsentti > 0,
  );
  if (onAlvia && alvVelka === undefined)
    throw new ResourceError('EILASKUTILIA', 'AlvVelkaTili puuttuu');
  // Counter account per payment method.
  const vastatili =
    maksutapa === Maksutapa.KATEINEN
      ? kateinen
      : maksutapa === Maksutapa.KORTTIMAKSU
        ? kortti
        : saatava;
  if (vastatili === undefined)
    throw new ResourceError(
      'EILASKUTILIA',
      'Vastatili puuttuu (LaskuSaatavaTili / LaskuKateistili / LaskuKorttitili)',
    );

  // Maksuperusteinen alv koskee vain LASKU-myyntiä (käteis-/korttimyynti pysyy suoriteperusteisena).
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

  // Lasku (LASKU): avaa erä myyntisaatavariville käyttäen tosite.id:tä globaalisti
  // uniikkina eräavaimena (sama kaksivaiheinen tallennus kuin ostolaskussa).
  // Käteis-/korttimyynti ei avaa erää.
  if (maksutapa !== Maksutapa.LASKU) return posted;
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
  summa: Cents; // invoice total = the debit leg's debet
  avoin: Cents; // open balance for this era (0 if no era / fully paid)
  era?: number;
  tili?: number; // AR account of the debit leg
  tyyppi: number;
  tunniste: number;
  sarja: string;
  tila: number;
  maksutapa?: number;
}

/**
 * List sales invoices with a live open balance per invoice. Each invoice's open item is its
 * single AR/era debit leg; `avoin` comes from queryErat (Σdebet − Σkredit over the era). Cash/card
 * invoices have no era leg and show avoin = 0 (paid). Payment vouchers are TILIOTE, never
 * MYYNTILASKU, so they never appear here. Relies on the invariant that a MYYNTILASKU has exactly
 * one debit leg (guaranteed by generoiLaskunViennit).
 */
export async function listaaMyyntilaskut(
  storage: Storage,
  suodatin: MyyntilaskuSuodatin,
): Promise<MyyntilaskuRivi[]> {
  const tositteet = await storage.listTositteet({
    bucket: 'kirjanpidossa',
    tyyppi: TositeTyyppi.MYYNTILASKU,
  });
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

    const debitLeg = t.viennit.find((v) => v.debet > 0);
    const summa = (debitLeg?.debet ?? 0) as Cents;
    const era = debitLeg?.era;
    const tili = debitLeg?.tili;
    const avoin = (era != null ? (eraMap.get(era) ?? 0) : 0) as Cents;

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

  const eraLeg = lasku.viennit.find((v) => v.era != null && (v.debet > 0 || v.kredit > 0));
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
  const omatLykatyt = lasku.viennit.filter((v) => v.alvKoodi === 418 || v.alvKoodi === 428);
  let lykatyt = omatLykatyt;
  if (omatLykatyt.length > 0) {
    const kirjanpidossa = await storage.listTositteet({ bucket: 'kirjanpidossa' });
    const joVanhennettu = kirjanpidossa.some((tt) =>
      tt.viennit.some((v) => v.maksuperusteinenTosite === lasku.id),
    );
    if (joVanhennettu) lykatyt = [];
  }
  if (lykatyt.length > 0) {
    const T = saatavaPuoli ? eraLeg.debet : eraLeg.kredit; // alkuperäinen bruttosumma
    const eraMap = await storage.queryErat({});
    const saldo = eraMap.get(era) ?? 0;
    const avoinEnnen = saatavaPuoli ? saldo : -saldo; // etumerkillinen; negatiivinen jos yli-/liikaa suoritettu
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
