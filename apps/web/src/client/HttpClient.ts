import type { AsetuksetPatch, KpClient, ViennitFilter } from '@penni/asiakas';
import {
  contract,
  decodeAlvErittely,
  decodeAlvIlmoitus,
  decodeAlvLaskelma,
  decodeAsetukset,
  decodeBudjettiRivi,
  decodeBudjettivertailuRivi,
  decodeEuMyynti,
  decodeInit,
  decodeJaksotuslaskelma,
  decodeKohdennus,
  decodeKohdennusKaytolla,
  decodeKohdennusOsio,
  decodeKumppani,
  decodeLiite,
  decodeLiiteMeta,
  decodeListattuTosite,
  decodeMyyntilaskuRivi,
  decodeOstolaskuRivi,
  decodePoistolaskelma,
  decodeRahavirtaRivi,
  decodeRaporttiRivi,
  decodeSaldot,
  decodeTilikausi,
  decodeTilinpaatosDoc,
  decodeTosite,
  decodeVerolaskelma,
  decodeVienti,
  encodeAlvTilitysSyote,
  encodeBudjettiRivi,
  encodeHyvityslaskuSyote,
  encodeInit,
  encodeJaksotuksetSyote,
  encodeKohdennus,
  encodeKumppani,
  encodeLiite,
  encodeLiitetiedotSyote,
  encodeMarginaaliveroSyote,
  encodeMyyntilaskuSyote,
  encodeOstolaskuSyote,
  encodePoistotSyote,
  encodeSuoritusSyote,
  encodeTilikausi,
  encodeTilinavausSyote,
  encodeTosite,
  encodeTuloveroSyote,
  encodeVahvistusSyote,
  encodeVanhennusSyote,
} from '@penni/contract';
import {
  type AlvErittely,
  type AlvIlmoitus,
  type AlvLaskelmaParams,
  type AlvLaskelmaTulos,
  type AlvTilitysSyote,
  type Asetukset,
  type BudjettiRivi,
  type BudjettivertailuParams,
  type BudjettivertailuRivi,
  type EuMyyntiYhteenveto,
  type HyvityslaskuSyote,
  type InitBundle,
  type InitPatch,
  type IsoDate,
  type JaksotuksetParams,
  type JaksotuksetSyote,
  type Jaksotuslaskelma,
  type Kohdennus,
  type KohdennusKaytolla,
  type KohdennusOsio,
  type KohdennusRaporttiParams,
  type Kumppani,
  type Liite,
  type LiiteMeta,
  type LiitetiedotSyote,
  type ListattuTosite,
  type MarginaaliverolaskelmaParams,
  type MyyntilaskuRivi,
  type MyyntilaskuSuodatin,
  type MyyntilaskuSyote,
  type OstolaskuListQuery,
  type OstolaskuRivi,
  type OstolaskuSyote,
  type Poistolaskelma,
  type PoistolaskelmaParams,
  type PoistotSyote,
  type RahavirtaRivi,
  type RahavirtaSuodatin,
  type RaporttiParams,
  type RaporttiRivi,
  ResourceError,
  type SaldotParams,
  type SaldotTulos,
  type StoredTosite,
  type SuoritusSyote,
  type TiliData,
  type Tilikausi,
  type TilinavausSyote,
  type TilinpaatosDoc,
  type TilinpaatosParams,
  type Tosite,
  type TositeFilter,
  type TositeSyote,
  TositeTila,
  type TositeVienti,
  type TuloveroSyote,
  type UusiKohdennus,
  type UusiKumppani,
  type UusiLiite,
  type VahvistusSyote,
  type VanhennusSyote,
  type Verolaskelma,
  type VerolaskelmaParams,
} from '@penni/engine';
import { type ApiFetcher, initClient, tsRestFetchApi } from '@ts-rest/core';

export interface HttpClientOptions {
  baseUrl: string;
  baseHeaders?: Record<string, string>;
  /** Test-only: route through fastify.inject() instead of fetch. */
  api?: ApiFetcher;
  /** Kutsutaan kun MIKÄ TAHANSA kutsu saa 401-vastauksen (istunto vanhentunut/puuttuu). */
  onTunnistusVanheni?: () => void;
}

/** Build the ts-rest client; its inferred return type backs the HttpClient.tsr field. */
function luoTsr(options: HttpClientOptions) {
  const pohja = options.api ?? tsRestFetchApi;
  const api: ApiFetcher = async (args) => {
    const vastaus = await pohja(args);
    if (vastaus.status === 401) options.onTunnistusVanheni?.();
    return vastaus;
  };
  return initClient(contract, {
    baseUrl: options.baseUrl,
    baseHeaders: options.baseHeaders ?? {},
    api,
  });
}
type Tsr = ReturnType<typeof luoTsr>;

/** Map an HTTP error response (status + { virhe, koodi? }) to a domain ResourceError. */
function virhe(status: number, body: unknown): ResourceError {
  const viesti =
    body && typeof body === 'object' && 'virhe' in body
      ? String((body as { virhe: unknown }).virhe)
      : '';
  // Hyväksy koodi vain aitona merkkijonona: null/luku/puuttuva -> status-varajako (ei 'null'-koodia).
  const raakaKoodi =
    body && typeof body === 'object' && 'koodi' in body
      ? (body as { koodi: unknown }).koodi
      : undefined;
  const koodi = typeof raakaKoodi === 'string' ? raakaKoodi : '';
  if (koodi) return new ResourceError(koodi, viesti || koodi);
  switch (status) {
    case 404:
      return new ResourceError('EITOSITETTA', viesti || 'Ei löytynyt');
    case 409:
      return new ResourceError('PVMLUKITTU', viesti || 'Lukittu kausi');
    case 422:
      return new ResourceError('EIVALMISTU', viesti || 'Ei voi kirjata');
    default:
      return new ResourceError('EITILIKAUTTA', viesti || `HTTP ${status}`);
  }
}

/** Build a complete wire Tosite from a (possibly tila-less) syote, defaulting like the engine. */
function syoteWireksi(syote: TositeSyote) {
  const valmis = {
    ...syote,
    tila: syote.tila ?? TositeTila.KIRJANPIDOSSA,
    tunniste: syote.tunniste ?? 0,
  } as Tosite & { id?: number };
  return encodeTosite(valmis);
}

function rahavirtaQuery(suodatin: RahavirtaSuodatin): Record<string, string> {
  const query: Record<string, string> = {};
  if (suodatin.alkupvm !== undefined) query.alkupvm = suodatin.alkupvm;
  if (suodatin.loppupvm !== undefined) query.loppupvm = suodatin.loppupvm;
  if (suodatin.kumppani !== undefined) query.kumppani = String(suodatin.kumppani);
  if (suodatin.avoin) query.avoin = 'true';
  if (suodatin.eraantynyt !== undefined) query.eraantynyt = suodatin.eraantynyt;
  if (suodatin.saldopvm !== undefined) query.saldopvm = suodatin.saldopvm;
  if (suodatin.bucket !== undefined) query.bucket = suodatin.bucket;
  return query;
}

/** Cloud client: typed ts-rest calls over @penni/contract, decoding wire->rich. */
export class HttpClient implements KpClient {
  private readonly tsr: Tsr;

  constructor(options: HttpClientOptions) {
    this.tsr = luoTsr(options);
  }

  async haeInit(): Promise<InitBundle> {
    const r = await this.tsr.haeInit();
    if (r.status === 200) return decodeInit(r.body as Parameters<typeof decodeInit>[0]);
    throw virhe(r.status, r.body);
  }
  async haeTilikaudet(): Promise<Tilikausi[]> {
    const r = await this.tsr.haeTilikaudet();
    if (r.status === 200) return (r.body as Record<string, unknown>[]).map(decodeTilikausi);
    throw virhe(r.status, r.body);
  }
  async haeAsetukset(): Promise<Asetukset> {
    const r = await this.tsr.haeAsetukset();
    if (r.status === 200) return decodeAsetukset(r.body as Record<string, unknown>);
    throw virhe(r.status, r.body);
  }

  async listaaTositteet(filter: TositeFilter): Promise<ListattuTosite[]> {
    const query: Record<string, string> = {};
    if (filter.bucket !== undefined) query.bucket = filter.bucket;
    if (filter.alkupvm !== undefined) query.alkupvm = filter.alkupvm;
    if (filter.loppupvm !== undefined) query.loppupvm = filter.loppupvm;
    if (filter.pvm !== undefined) query.pvm = filter.pvm;
    if (filter.kumppani !== undefined) query.kumppani = String(filter.kumppani);
    if (filter.tyyppi !== undefined) query.tyyppi = String(filter.tyyppi);
    if (filter.viite !== undefined) query.viite = filter.viite;
    const r = await this.tsr.listaaTositteet({ query });
    if (r.status === 200)
      return (r.body as Parameters<typeof decodeListattuTosite>[0][]).map(decodeListattuTosite);
    throw virhe(r.status, r.body);
  }
  async haeTosite(id: number): Promise<StoredTosite | null> {
    const r = await this.tsr.haeTosite({ params: { id: String(id) } });
    if (r.status === 200)
      return decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite;
    if (r.status === 404) return null;
    throw virhe(r.status, r.body);
  }
  async luoTosite(syote: TositeSyote): Promise<StoredTosite> {
    const r = await this.tsr.luoTosite({ body: syoteWireksi(syote) });
    if (r.status === 200 || r.status === 201)
      return decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite;
    throw virhe(r.status, r.body);
  }
  async tallennaMyyntilasku(syote: MyyntilaskuSyote): Promise<StoredTosite> {
    const r = await this.tsr.luoMyyntilasku({
      body: encodeMyyntilaskuSyote(syote) as Parameters<Tsr['luoMyyntilasku']>[0]['body'],
    });
    if (r.status === 200 || r.status === 201)
      return decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite;
    throw virhe(r.status, r.body);
  }
  async listaaMyyntilaskut(suodatin: MyyntilaskuSuodatin): Promise<MyyntilaskuRivi[]> {
    const query: Record<string, string> = {};
    if (suodatin.alkupvm !== undefined) query.alkupvm = suodatin.alkupvm;
    if (suodatin.loppupvm !== undefined) query.loppupvm = suodatin.loppupvm;
    if (suodatin.eraalkupvm !== undefined) query.eraalkupvm = suodatin.eraalkupvm;
    if (suodatin.eraloppupvm !== undefined) query.eraloppupvm = suodatin.eraloppupvm;
    if (suodatin.avoin) query.avoin = 'true';
    if (suodatin.eraantynyt !== undefined) query.eraantynyt = suodatin.eraantynyt;
    if (suodatin.saldopvm !== undefined) query.saldopvm = suodatin.saldopvm;
    const r = await this.tsr.listaaMyyntilaskut({ query });
    if (r.status === 200)
      return (r.body as Parameters<typeof decodeMyyntilaskuRivi>[0][]).map(decodeMyyntilaskuRivi);
    throw virhe(r.status, r.body);
  }
  async tallennaOstolasku(syote: OstolaskuSyote): Promise<StoredTosite> {
    const r = await this.tsr.tallennaOstolasku({
      body: encodeOstolaskuSyote(syote) as Parameters<Tsr['tallennaOstolasku']>[0]['body'],
    });
    if (r.status === 200 || r.status === 201)
      return decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite;
    throw virhe(r.status, r.body);
  }
  async listaaOstolaskut(suodatin: OstolaskuListQuery): Promise<OstolaskuRivi[]> {
    const r = await this.tsr.listaaOstolaskut({ query: suodatin as never });
    if (r.status === 200)
      return (r.body as Parameters<typeof decodeOstolaskuRivi>[0][]).map(decodeOstolaskuRivi);
    throw virhe(r.status, r.body);
  }
  async listaaTulot(suodatin: RahavirtaSuodatin): Promise<RahavirtaRivi[]> {
    const r = await this.tsr.listaaTulot({ query: rahavirtaQuery(suodatin) });
    if (r.status === 200)
      return (r.body as Parameters<typeof decodeRahavirtaRivi>[0][]).map(decodeRahavirtaRivi);
    throw virhe(r.status, r.body);
  }
  async listaaMenot(suodatin: RahavirtaSuodatin): Promise<RahavirtaRivi[]> {
    const r = await this.tsr.listaaMenot({ query: rahavirtaQuery(suodatin) });
    if (r.status === 200)
      return (r.body as Parameters<typeof decodeRahavirtaRivi>[0][]).map(decodeRahavirtaRivi);
    throw virhe(r.status, r.body);
  }
  async tallennaHyvityslasku(syote: HyvityslaskuSyote): Promise<StoredTosite> {
    const r = await this.tsr.tallennaHyvityslasku({
      body: encodeHyvityslaskuSyote(syote) as Parameters<Tsr['tallennaHyvityslasku']>[0]['body'],
    });
    if (r.status === 200 || r.status === 201)
      return decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite;
    throw virhe(r.status, r.body);
  }
  async tallennaSuoritus(syote: SuoritusSyote): Promise<StoredTosite> {
    const r = await this.tsr.luoSuoritus({
      body: encodeSuoritusSyote(syote) as Parameters<Tsr['luoSuoritus']>[0]['body'],
    });
    if (r.status === 200 || r.status === 201)
      return decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite;
    throw virhe(r.status, r.body);
  }
  async vanhennaMaksuperusteinenAlv(syote: VanhennusSyote): Promise<StoredTosite | null> {
    const r = await this.tsr.tallennaMaksuperusteisenAlvVanhennus({
      body: encodeVanhennusSyote(syote) as Parameters<
        Tsr['tallennaMaksuperusteisenAlvVanhennus']
      >[0]['body'],
    });
    if (r.status === 200)
      return r.body == null
        ? null
        : (decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite);
    throw virhe(r.status, r.body);
  }
  async kirjaaMarginaalivero(params: MarginaaliverolaskelmaParams): Promise<StoredTosite | null> {
    const r = await this.tsr.kirjaaMarginaalivero({
      body: encodeMarginaaliveroSyote(params) as Parameters<Tsr['kirjaaMarginaalivero']>[0]['body'],
    });
    if (r.status === 200)
      return r.body == null
        ? null
        : (decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite);
    throw virhe(r.status, r.body);
  }
  async paataTilikausi(alkaa: IsoDate): Promise<void> {
    const r = await this.tsr.paataTilikausi({ params: { alkaa }, body: {} });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async avaaTilikausi(alkaa: IsoDate): Promise<void> {
    const r = await this.tsr.avaaTilikausi({ params: { alkaa } });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async luoTilinavaus(syote: TilinavausSyote): Promise<StoredTosite> {
    const r = await this.tsr.luoTilinavaus({
      body: encodeTilinavausSyote(syote) as Parameters<Tsr['luoTilinavaus']>[0]['body'],
    });
    if (r.status === 200 || r.status === 201)
      return decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite;
    throw virhe(r.status, r.body);
  }
  async haeTilinpaatos(params: TilinpaatosParams): Promise<TilinpaatosDoc> {
    const r = await this.tsr.haeTilinpaatos({
      query: {
        alkaa: params.alkaa,
        ...(params.muoto ? { muoto: params.muoto } : {}),
      } as Parameters<Tsr['haeTilinpaatos']>[0]['query'],
    });
    if (r.status === 200)
      return decodeTilinpaatosDoc(r.body as Parameters<typeof decodeTilinpaatosDoc>[0]);
    throw virhe(r.status, r.body);
  }
  async tallennaLiitetiedot(syote: LiitetiedotSyote): Promise<void> {
    const r = await this.tsr.tallennaLiitetiedot({ body: encodeLiitetiedotSyote(syote) });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async vahvistaTilinpaatos(syote: VahvistusSyote): Promise<void> {
    const r = await this.tsr.vahvistaTilinpaatos({ body: encodeVahvistusSyote(syote) });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async peruVahvistus(syote: VahvistusSyote): Promise<void> {
    const r = await this.tsr.peruVahvistus({ body: encodeVahvistusSyote(syote) });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async haeAlvLaskelma(params: AlvLaskelmaParams): Promise<AlvLaskelmaTulos> {
    const r = await this.tsr.haeAlvLaskelma({
      query: { alkupvm: params.alkupvm, loppupvm: params.loppupvm },
    });
    if (r.status === 200)
      return decodeAlvLaskelma(r.body as Parameters<typeof decodeAlvLaskelma>[0]);
    throw virhe(r.status, r.body);
  }
  async haeAlvErittely(params: AlvLaskelmaParams): Promise<AlvErittely> {
    const r = await this.tsr.haeAlvErittely({
      query: { alkupvm: params.alkupvm, loppupvm: params.loppupvm },
    });
    if (r.status === 200)
      return decodeAlvErittely(r.body as Parameters<typeof decodeAlvErittely>[0]);
    throw virhe(r.status, r.body);
  }
  async tallennaAlvTilitys(syote: AlvTilitysSyote): Promise<StoredTosite> {
    const r = await this.tsr.tallennaAlvTilitys({
      body: encodeAlvTilitysSyote(syote) as Parameters<Tsr['tallennaAlvTilitys']>[0]['body'],
    });
    if (r.status === 200 || r.status === 201)
      return decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite;
    throw virhe(r.status, r.body);
  }
  async haeAlvIlmoitus(params: AlvLaskelmaParams): Promise<AlvIlmoitus> {
    const r = await this.tsr.haeAlvIlmoitus({
      query: { alkupvm: params.alkupvm, loppupvm: params.loppupvm },
    });
    if (r.status === 200)
      return decodeAlvIlmoitus(r.body as Parameters<typeof decodeAlvIlmoitus>[0]);
    throw virhe(r.status, r.body);
  }
  async haeEuMyyntiYhteenveto(params: AlvLaskelmaParams): Promise<EuMyyntiYhteenveto> {
    const r = await this.tsr.haeEuMyyntiYhteenveto({
      query: { alkupvm: params.alkupvm, loppupvm: params.loppupvm },
    });
    if (r.status === 200) return decodeEuMyynti(r.body as Parameters<typeof decodeEuMyynti>[0]);
    throw virhe(r.status, r.body);
  }
  async haeVerolaskelma(params: VerolaskelmaParams): Promise<Verolaskelma> {
    // aiempiTappio?: string | undefined (eikä pelkkä `string`), jotta kentän asettaminen
    // encodeTuloveroSyoten optionaalisesta paluuarvosta ei riko exactOptionalPropertyTypesiä.
    const query: { alkupvm: string; loppupvm: string; aiempiTappio?: string | undefined } = {
      alkupvm: params.alkupvm,
      loppupvm: params.loppupvm,
    };
    if (params.aiempiTappio !== undefined)
      query.aiempiTappio = encodeTuloveroSyote({
        alkupvm: params.alkupvm,
        loppupvm: params.loppupvm,
        aiempiTappio: params.aiempiTappio,
      }).aiempiTappio;
    const r = await this.tsr.haeVerolaskelma({ query });
    if (r.status === 200)
      return decodeVerolaskelma(r.body as Parameters<typeof decodeVerolaskelma>[0]);
    throw virhe(r.status, r.body);
  }
  async tallennaTulovero(syote: TuloveroSyote): Promise<StoredTosite> {
    const r = await this.tsr.tallennaTulovero({
      body: encodeTuloveroSyote(syote) as Parameters<Tsr['tallennaTulovero']>[0]['body'],
    });
    if (r.status === 200 || r.status === 201)
      return decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite;
    throw virhe(r.status, r.body);
  }
  async haePoistolaskelma(params: PoistolaskelmaParams): Promise<Poistolaskelma> {
    const r = await this.tsr.haePoistolaskelma({ query: { loppupvm: params.loppupvm } });
    if (r.status === 200)
      return decodePoistolaskelma(r.body as Parameters<typeof decodePoistolaskelma>[0]);
    throw virhe(r.status, r.body);
  }
  async tallennaPoistot(syote: PoistotSyote): Promise<StoredTosite> {
    const r = await this.tsr.tallennaPoistot({
      body: encodePoistotSyote(syote) as Parameters<Tsr['tallennaPoistot']>[0]['body'],
    });
    if (r.status === 200 || r.status === 201)
      return decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite;
    throw virhe(r.status, r.body);
  }
  async haeJaksotukset(params: JaksotuksetParams): Promise<Jaksotuslaskelma> {
    const r = await this.tsr.haeJaksotukset({ query: { loppupvm: params.loppupvm } });
    if (r.status === 200)
      return decodeJaksotuslaskelma(r.body as Parameters<typeof decodeJaksotuslaskelma>[0]);
    throw virhe(r.status, r.body);
  }
  async tallennaJaksotukset(syote: JaksotuksetSyote): Promise<StoredTosite> {
    const r = await this.tsr.tallennaJaksotukset({
      body: encodeJaksotuksetSyote(syote) as Parameters<Tsr['tallennaJaksotukset']>[0]['body'],
    });
    if (r.status === 200 || r.status === 201)
      return decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite;
    throw virhe(r.status, r.body);
  }
  async paivitaTosite(id: number, syote: TositeSyote): Promise<StoredTosite> {
    const r = await this.tsr.paivitaTosite({
      params: { id: String(id) },
      body: syoteWireksi(syote),
    });
    if (r.status === 200)
      return decodeTosite(r.body as Parameters<typeof decodeTosite>[0]) as StoredTosite;
    throw virhe(r.status, r.body);
  }
  async muutaTila(id: number, tila: number): Promise<void> {
    const r = await this.tsr.muutaTila({ params: { id: String(id) }, body: { tila } });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async poistaTosite(id: number): Promise<void> {
    const r = await this.tsr.poistaTosite({ params: { id: String(id) } });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async listaaViennit(filter: ViennitFilter): Promise<TositeVienti[]> {
    const query: Record<string, string> = {};
    if (filter.alkupvm !== undefined) query.alkupvm = filter.alkupvm;
    if (filter.loppupvm !== undefined) query.loppupvm = filter.loppupvm;
    if (filter.tili !== undefined) query.tili = String(filter.tili);
    const r = await this.tsr.listaaViennit({ query });
    if (r.status === 200) return (r.body as Parameters<typeof decodeVienti>[0][]).map(decodeVienti);
    throw virhe(r.status, r.body);
  }

  async haeSaldot(params: SaldotParams): Promise<SaldotTulos> {
    const query: Record<string, string> = { pvm: params.pvm };
    if (params.alkupvm !== undefined) query.alkupvm = params.alkupvm;
    if (params.alkusaldot) query.alkusaldot = 'true';
    if (params.tase) query.tase = 'true';
    if (params.tuloslaskelma) query.tuloslaskelma = 'true';
    if (params.tili !== undefined) query.tili = String(params.tili);
    if (params.kohdennus !== undefined) query.kohdennus = String(params.kohdennus);
    // The contract's zod query type requires `pvm`; our string-bag carries it. Cast bridges the
    // wire-string impedance (same pattern as the decode casts).
    const r = await this.tsr.haeSaldot({
      query: query as Parameters<Tsr['haeSaldot']>[0]['query'],
    });
    if (r.status === 200) return decodeSaldot(r.body as Record<string, string | number>);
    throw virhe(r.status, r.body);
  }

  async laadiRaportti(params: RaporttiParams): Promise<RaporttiRivi[]> {
    const query: Record<string, string> = { muoto: params.muoto, pvm: params.pvm };
    if (params.alkupvm !== undefined) query.alkupvm = params.alkupvm;
    if (params.erittelyt) query.erittelyt = 'true';
    if (params.kaikkiRivit) query.kaikkiRivit = 'true';
    if (params.kohdennus !== undefined) query.kohdennus = String(params.kohdennus);
    const r = await this.tsr.laadiRaportti({
      query: query as Parameters<Tsr['laadiRaportti']>[0]['query'],
    });
    if (r.status === 200)
      return (r.body as { rivit: Parameters<typeof decodeRaporttiRivi>[0][] }).rivit.map(
        decodeRaporttiRivi,
      );
    if (r.status === 404) throw new ResourceError('EIRAPORTTIA', 'Raporttia ei löytynyt');
    throw virhe(r.status, r.body);
  }

  async laadiKohdennusRaportti(p: KohdennusRaporttiParams): Promise<KohdennusOsio[]> {
    const query: Record<string, string> = {
      muoto: p.muoto,
      alkupvm: p.alkupvm,
      pvm: p.pvm,
      laji: p.laji,
    };
    if (p.kustannuspaikka !== undefined) query.kustannuspaikka = String(p.kustannuspaikka);
    const r = await this.tsr.laadiKohdennusRaportti({
      query: query as Parameters<Tsr['laadiKohdennusRaportti']>[0]['query'],
    });
    if (r.status === 200) return r.body.map(decodeKohdennusOsio);
    throw virhe(r.status, r.body);
  }

  async laadiBudjettivertailu(p: BudjettivertailuParams): Promise<BudjettivertailuRivi[]> {
    const query: Record<string, string> = { muoto: p.muoto, tilikausi: p.tilikausi };
    if (p.pvm !== undefined) query.pvm = p.pvm;
    if (p.kohdennus !== undefined) query.kohdennus = String(p.kohdennus);
    const r = await this.tsr.laadiBudjettivertailu({
      query: query as Parameters<Tsr['laadiBudjettivertailu']>[0]['query'],
    });
    if (r.status === 200) return r.body.map(decodeBudjettivertailuRivi);
    throw virhe(r.status, r.body);
  }

  async paivitaInit(patch: InitPatch): Promise<void> {
    // encodeInit emits the full bundle shape; the PATCH body accepts the asetukset/tilit subset.
    const body = encodeInit({
      asetukset: patch.asetukset ?? {},
      tilit: patch.tilit ?? [],
      tilikaudet: [],
      tositesarjat: [],
      kohdennukset: [],
    });
    const r = await this.tsr.paivitaInit({
      body: body as unknown as Parameters<Tsr['paivitaInit']>[0]['body'],
    });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async tallennaTili(numero: number, data: TiliData): Promise<void> {
    const r = await this.tsr.tallennaTili({
      params: { numero: String(numero) },
      body: data as Parameters<Tsr['tallennaTili']>[0]['body'],
    });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async poistaTili(numero: number, taso?: number): Promise<void> {
    const r =
      taso === undefined
        ? await this.tsr.poistaTili({ params: { numero: String(numero) } })
        : await this.tsr.poistaOtsikko({ params: { numero: String(numero), taso: String(taso) } });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async tallennaTilikausi(alkaa: IsoDate, kausi: Tilikausi): Promise<void> {
    const r = await this.tsr.tallennaTilikausi({
      params: { alkaa },
      body: encodeTilikausi(kausi) as Parameters<Tsr['tallennaTilikausi']>[0]['body'],
    });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async poistaTilikausi(alkaa: IsoDate): Promise<void> {
    const r = await this.tsr.poistaTilikausi({ params: { alkaa } });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async paivitaAsetukset(patch: AsetuksetPatch): Promise<void> {
    const r = await this.tsr.paivitaAsetukset({ body: patch });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }

  async haeKumppanit(): Promise<Kumppani[]> {
    const r = await this.tsr.haeKumppanit();
    if (r.status === 200) return (r.body as Record<string, unknown>[]).map(decodeKumppani);
    throw virhe(r.status, r.body);
  }
  async tallennaKumppani(kumppani: UusiKumppani): Promise<Kumppani> {
    const r = await this.tsr.tallennaKumppani({
      body: encodeKumppani(kumppani) as Parameters<Tsr['tallennaKumppani']>[0]['body'],
    });
    if (r.status === 200 || r.status === 201)
      return decodeKumppani(r.body as Record<string, unknown>);
    throw virhe(r.status, r.body);
  }
  async poistaKumppani(id: number): Promise<void> {
    const r = await this.tsr.poistaKumppani({ params: { id: String(id) } });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }

  async haeKohdennukset(): Promise<KohdennusKaytolla[]> {
    const r = await this.tsr.haeKohdennukset();
    if (r.status === 200) return (r.body as Record<string, unknown>[]).map(decodeKohdennusKaytolla);
    throw virhe(r.status, r.body);
  }
  async tallennaKohdennus(k: UusiKohdennus): Promise<Kohdennus> {
    const r = await this.tsr.tallennaKohdennus({
      body: encodeKohdennus(k) as Parameters<Tsr['tallennaKohdennus']>[0]['body'],
    });
    if (r.status === 200 || r.status === 201)
      return decodeKohdennus(r.body as Record<string, unknown>);
    throw virhe(r.status, r.body);
  }
  async poistaKohdennus(id: number): Promise<void> {
    const r = await this.tsr.poistaKohdennus({ params: { id: String(id) } });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
  async haeBudjetti(tilikausi: IsoDate): Promise<BudjettiRivi[]> {
    const r = await this.tsr.haeBudjetti({ params: { tilikausi } });
    if (r.status === 200) return r.body.map(decodeBudjettiRivi);
    throw virhe(r.status, r.body);
  }
  async tallennaBudjetti(tilikausi: IsoDate, rivit: BudjettiRivi[]): Promise<void> {
    const r = await this.tsr.tallennaBudjetti({
      params: { tilikausi },
      body: rivit.map(encodeBudjettiRivi),
    });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }

  async haeLiitteet(tosite: number): Promise<LiiteMeta[]> {
    const r = await this.tsr.haeLiitteet({ params: { tosite: String(tosite) } });
    if (r.status === 200) return (r.body as Record<string, unknown>[]).map(decodeLiiteMeta);
    throw virhe(r.status, r.body);
  }
  async haeLiite(id: number): Promise<Liite | null> {
    const r = await this.tsr.haeLiite({ params: { id: String(id) } });
    if (r.status === 200) return decodeLiite(r.body as Record<string, unknown>);
    if (r.status === 404) return null;
    throw virhe(r.status, r.body);
  }
  async tallennaLiite(liite: UusiLiite): Promise<LiiteMeta> {
    const r = await this.tsr.tallennaLiite({
      body: encodeLiite(liite) as Parameters<Tsr['tallennaLiite']>[0]['body'],
    });
    if (r.status === 200 || r.status === 201)
      return decodeLiiteMeta(r.body as Record<string, unknown>);
    throw virhe(r.status, r.body);
  }
  async lisaaLiite(liite: UusiLiite): Promise<LiiteMeta> {
    const r = await this.tsr.lisaaLiite({
      params: { tosite: String(liite.tosite) },
      body: encodeLiite(liite) as Parameters<Tsr['lisaaLiite']>[0]['body'],
    });
    if (r.status === 200) return decodeLiiteMeta(r.body as Record<string, unknown>);
    throw virhe(r.status, r.body);
  }
  async poistaLiite(id: number): Promise<void> {
    const r = await this.tsr.poistaLiite({ params: { id: String(id) } });
    if (r.status === 200) return;
    throw virhe(r.status, r.body);
  }
}
