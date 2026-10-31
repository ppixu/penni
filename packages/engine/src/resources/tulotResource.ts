import { type Cents, Euro } from '@penni/euro';
import { Luonne, type LuonneArvo, onko } from '../accounts/luonne.js';
import { type Alkupera, tositteenAlkupera } from '../alv/alkupera.js';
import { onKirjanpidossa } from '../vouchers/enums.js';
import type { IsoDate } from '../vouchers/types.js';
import { normalisoiSaldo } from './saldot.js';
import type { Storage, StoredTosite, TositeBucket } from './storage.js';

export interface RahavirtaSuodatin {
  // NOTE: bounds the voucher's own `pvm` (posting date) — NOT `laskupvm ?? pvm` like
  // listaaMyyntilaskut/listaaOstolaskut do. For a voucher whose laskupvm differs from pvm,
  // the identical alkupvm/loppupvm range can therefore select a different set of rows here
  // than on the Myyntilaskut/Ostolaskut lists.
  alkupvm?: IsoDate; // pvm >=
  loppupvm?: IsoDate; // pvm <=
  kumppani?: number;
  avoin?: boolean; // only rows with avoin !== 0
  eraantynyt?: IsoDate; // only rows with erapvm < this AND avoin !== 0
  saldopvm?: IsoDate; // era balance as of this date
  /** Yksi tilaryhmä (kuten tositelistassa); oletus = kirjatut + luonnokset. */
  bucket?: TositeBucket;
}

export interface RahavirtaRivi {
  tosite: number;
  pvm: IsoDate;
  tunniste: number;
  sarja: string;
  tyyppi: number;
  /** Tositteen tila: luonnokset (TositeTila.LUONNOS, esim. täsmäytyksen kuittitositteet)
   *  listataan kirjattujen rinnalla, ja UI merkitsee ne tämän perusteella. */
  tila: number;
  netto: Cents; // Σ over the matching-nature legs
  alv: Cents; // Σ over the voucher's ALV legs
  summa: Cents; // netto + alv (gross)
  avoin: Cents; // 0 when the voucher carries no era
  liitteita: number; // attachment count (0 = no receipt)
  alkupera?: Alkupera; // kotimaa / EU / EU:n ulkopuoli (tositteenAlkupera); absent when unknown
  otsikko?: string;
  kumppani?: number;
  kumppaniNimi?: string;
  era?: number;
  erapvm?: IsoDate;
  numero?: string; // invoice number (SuoritusDialog's default Kirjaa maksu -otsikko)
  viite?: string;
  /** True iff the era leg's own balance sits on the kredit side (a payable/AP-style era —
   *  matches listaaOstolaskut's own predicate, ostolaskuResource.ts:159-162). Menot's
   *  onkoLasku uses `era !== undefined && eraKredit` to identify a real ostolasku: a purchase
   *  credit note keeps era (hyvityslaskuResource.ts's wholesale debet/kredit swap preserves
   *  it) but flips the AP leg's kredit to 0, so `era !== undefined` alone would misclassify
   *  it as a purchase invoice and route to a document view listaaOstolaskut can't find. */
  eraKredit?: boolean;
  /** Hyvityslaskun (214) hyvitettävän tositteen id; puuttuu, jos tositteella ei ole alkuperäistä
   *  (esim. Kitsas-tuonnin hyvityslasku). UI reitittää hyvityslaskun dokumenttinäkymään vain,
   *  kun tämä on olemassa — dokumentti tulostaa alkuperäisen rivit. */
  alkuperainenTosite?: number;
}

/**
 * Fold the legs whose account luonne matches `mask`. `kreditPositiivinen` picks the sign
 * convention: income accumulates on the credit side, expense on the debit side, so both
 * lists report a positive figure for the ordinary case and a negative one for a credit note.
 */
function summaaLuonteella(
  tosite: StoredTosite,
  luonteet: ReadonlyMap<number, LuonneArvo>,
  mask: LuonneArvo,
  kreditPositiivinen: boolean,
): Cents {
  let summa = Euro.fromCents(0);
  for (const v of tosite.viennit) {
    const luonne = luonteet.get(v.tili);
    if (luonne === undefined || !onko(luonne, mask)) continue;
    summa = Euro.add(
      summa,
      kreditPositiivinen ? Euro.sub(v.kredit, v.debet) : Euro.sub(v.debet, v.kredit),
    );
  }
  return summa;
}

async function listaa(
  storage: Storage,
  suodatin: RahavirtaSuodatin,
  nettoMask: LuonneArvo,
  kreditPositiivinen: boolean,
): Promise<RahavirtaRivi[]> {
  const rajaus = {
    ...(suodatin.alkupvm !== undefined ? { alkupvm: suodatin.alkupvm } : {}),
    ...(suodatin.loppupvm !== undefined ? { loppupvm: suodatin.loppupvm } : {}),
    ...(suodatin.kumppani !== undefined ? { kumppani: suodatin.kumppani } : {}),
  };
  // Luonnokset listataan mukana (merkitään rivin tilalla), jotta täsmäytyksessä luonnokseksi
  // kirjatut kuitit näkyvät Menoissa/Tuloissa. Ne eivät silti ole kirjanpidossa: queryErat
  // laskee vain kirjatut, joten luonnoksen avoin on 0 eikä se päädy Avoimet/Erääntyneet-
  // suodattimiin; raportit ja alv lukevat omat, kirjattuihin rajatut kyselynsä.
  const bucketit: TositeBucket[] =
    suodatin.bucket !== undefined ? [suodatin.bucket] : ['kirjanpidossa', 'luonnos'];
  const [liitteita, ...listat] = await Promise.all([
    storage.laskeLiitteet(),
    ...bucketit.map((bucket) => storage.listTositteet({ bucket, ...rajaus })),
  ]);
  const tositteet = listat.flat();
  const chart = await storage.getChart();
  const luonteet = new Map<number, LuonneArvo>(chart.map((t) => [t.numero, t.luonne]));
  const eraMap = await storage.queryErat(
    suodatin.saldopvm !== undefined ? { saldopvm: suodatin.saldopvm } : {},
  );
  const kumppanit = new Map((await storage.getKumppanit()).map((k) => [k.id, k]));

  const rivit: RahavirtaRivi[] = [];
  for (const t of tositteet) {
    // A voucher that never touches the nature we are listing is not ours, even if some
    // other leg (bank, equity, VAT) would look like money moving.
    if (
      !t.viennit.some((v) => {
        const l = luonteet.get(v.tili);
        return l !== undefined && onko(l, nettoMask);
      })
    )
      continue;

    const netto = summaaLuonteella(t, luonteet, nettoMask, kreditPositiivinen);
    // Fold BOTH VAT natures with the list's own sign convention. A reverse-charge purchase
    // (EU acquisition, rakennuspalvelu, imported services — generoiVeroviennit.ts:126-201)
    // posts a deductible ALVSAATAVA leg AND a self-assessed-output ALVVELKA leg for the SAME
    // invoice; folding only one side (the previous behaviour) overstates or misstates the
    // row's summa relative to what listaaOstolaskut reports for the identical invoice. The
    // two masks are disjoint chart natures (asset vs liability), so folding both never
    // double-counts a single leg — verified against all four generoiVeroviennit VAT
    // outcomes: domestic purchase (255+0), reverse charge with deduction (255−255=0),
    // reverse charge without deduction (0−255=−255, VAT capitalised into netto instead),
    // normal sale (255+0), zero-rated (0+0).
    const alv = Euro.add(
      summaaLuonteella(t, luonteet, Luonne.ALVSAATAVA, kreditPositiivinen),
      summaaLuonteella(t, luonteet, Luonne.ALVVELKA, kreditPositiivinen),
    );
    const eraLeg = t.viennit.find((v) => v.era !== undefined);
    const era = eraLeg?.era;
    // queryErat returns raw Σ(debet − kredit), which is only debit-positive-correct for
    // asset-side eras (see storage.ts:118-119). Normalize by the era leg's own account so a
    // liability-side era (ostovelka, ...) reports its open balance as positive too — mirrors
    // listaaOstolaskut (ostolaskuResource.ts:176-178).
    // Luonnos ei ole kirjanpidossa, joten sillä ei ole avointa saldoa, vaikka sen era-tunnus
    // osuisi kirjatun erän kanssa yhteen.
    const avoin = (
      era !== undefined && eraLeg && onKirjanpidossa(t.tila)
        ? normalisoiSaldo(eraLeg.tili, eraMap.get(era) ?? Euro.fromCents(0))
        : Euro.fromCents(0)
    ) as Cents;

    if (suodatin.avoin && avoin === Euro.fromCents(0)) continue;
    if (
      suodatin.eraantynyt !== undefined &&
      !(t.erapvm != null && t.erapvm < suodatin.eraantynyt && avoin !== Euro.fromCents(0))
    )
      continue;

    const rivi: RahavirtaRivi = {
      tosite: t.id,
      pvm: t.pvm,
      tunniste: t.tunniste,
      sarja: t.sarja,
      tyyppi: t.tyyppi,
      tila: t.tila,
      netto,
      alv,
      summa: Euro.add(netto, alv),
      avoin,
      liitteita: liitteita.get(t.id) ?? 0,
    };
    if (t.otsikko !== undefined) rivi.otsikko = t.otsikko;
    if (t.erapvm !== undefined) rivi.erapvm = t.erapvm;
    if (era !== undefined) rivi.era = era;
    if (era !== undefined && eraLeg) rivi.eraKredit = eraLeg.kredit > 0;
    if (t.alkuperainenTosite !== undefined) rivi.alkuperainenTosite = t.alkuperainenTosite;
    if (t.numero !== undefined) rivi.numero = t.numero;
    if (t.viite !== undefined) rivi.viite = t.viite;
    if (t.kumppani !== undefined) {
      rivi.kumppani = t.kumppani;
      const k = kumppanit.get(t.kumppani);
      if (k) rivi.kumppaniNimi = k.nimi;
    }
    const alkupera = tositteenAlkupera(
      t.viennit,
      t.kumppani !== undefined ? kumppanit.get(t.kumppani)?.maa : undefined,
    );
    if (alkupera !== undefined) rivi.alkupera = alkupera;
    rivit.push(rivi);
  }

  rivit.sort((a, b) => (a.pvm === b.pvm ? a.tosite - b.tosite : a.pvm < b.pvm ? -1 : 1));
  return rivit;
}

/** All income: every posted or draft voucher touching an account whose luonne is TULO. */
export function listaaTulot(
  storage: Storage,
  suodatin: RahavirtaSuodatin,
): Promise<RahavirtaRivi[]> {
  return listaa(storage, suodatin, Luonne.TULO, true);
}

/** All expense: every posted or draft voucher touching an account whose luonne is MENO. */
export function listaaMenot(
  storage: Storage,
  suodatin: RahavirtaSuodatin,
): Promise<RahavirtaRivi[]> {
  return listaa(storage, suodatin, Luonne.MENO, false);
}
