import {
  type AlvErittely,
  type AlvIlmoitus,
  type AlvLaskelmaParams,
  type AlvLaskelmaTulos,
  type AlvTilitysSyote,
  type Asetukset,
  type EuMyyntiYhteenveto,
  type HyvityslaskuSyote,
  type InitBundle,
  type InitPatch,
  type IsoDate,
  type JaksotuksetParams,
  type JaksotuksetSyote,
  type Jaksotuslaskelma,
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
  type ResourceEnv,
  type SaldotParams,
  type SaldotTulos,
  type Storage,
  type StoredTosite,
  type SuoritusSyote,
  type TiliData,
  type Tilikausi,
  type TilinavausSyote,
  type TilinpaatosDoc,
  type TilinpaatosParams,
  type TositeFilter,
  type TositeSyote,
  type TositeVienti,
  type TuloveroSyote,
  type UusiKumppani,
  type UusiLiite,
  type VahvistusSyote,
  type VanhennusSyote,
  type Verolaskelma,
  type VerolaskelmaParams,
  avaaTilikausi,
  haeAlvErittely,
  haeAlvIlmoitus,
  haeAlvLaskelma,
  haeAsetukset,
  haeEuMyyntiYhteenveto,
  haeInit,
  haeJaksotukset,
  haeKumppanit,
  haeLiite,
  haeLiitteet,
  haePoistolaskelma,
  haeSaldot,
  haeTilikaudet,
  haeTosite,
  haeVerolaskelma,
  kirjaaMarginaalivero,
  laadiRaportti,
  laadiTilinpaatos,
  lisaaLiite,
  listaaMenot,
  listaaMyyntilaskut,
  listaaOstolaskut,
  listaaTositteet,
  listaaTulot,
  listaaViennit,
  luoTilinavaus,
  muutaTositteenTila,
  paataTilikausi,
  paivitaAsetukset,
  paivitaInit,
  peruVahvistus,
  poistaKumppani,
  poistaLiite,
  poistaTili,
  poistaTilikausi,
  poistaTosite,
  putTili,
  putTilikausi,
  tallennaAlvTilitys,
  tallennaHyvityslasku,
  tallennaJaksotukset,
  tallennaKumppani,
  tallennaLiite,
  tallennaLiitetiedot,
  tallennaMyyntilasku,
  tallennaOstolasku,
  tallennaPoistot,
  tallennaSuoritus,
  tallennaTosite,
  tallennaTulovero,
  vahvistaTilinpaatos,
  vanhennaMaksuperusteinenAlv,
} from '@penni/engine';
import type { AsetuksetPatch, KpClient, ViennitFilter } from './KpClient.js';

/** Wall clock for ResourceEnv.aika. Injectable so tests pin it deterministically. */
export type Kello = () => string;

/**
 * Local-first client: drives the pure engine resource handlers against an injected Storage.
 * Zero wire round-trip; returns rich domain types directly.
 */
export class InProcessClient implements KpClient {
  constructor(
    private readonly storage: Storage,
    private readonly kello: Kello = () => new Date().toISOString(),
    private readonly lahde?: string,
  ) {}

  private env(): ResourceEnv {
    return { aika: this.kello(), ...(this.lahde !== undefined ? { lahde: this.lahde } : {}) };
  }

  haeInit(): Promise<InitBundle> {
    return haeInit(this.storage);
  }
  haeTilikaudet(): Promise<Tilikausi[]> {
    return haeTilikaudet(this.storage);
  }
  haeAsetukset(): Promise<Asetukset> {
    return haeAsetukset(this.storage);
  }

  listaaTositteet(filter: TositeFilter): Promise<ListattuTosite[]> {
    return listaaTositteet(this.storage, filter);
  }
  haeTosite(id: number): Promise<StoredTosite | null> {
    return haeTosite(this.storage, id);
  }
  luoTosite(syote: TositeSyote): Promise<StoredTosite> {
    return tallennaTosite(this.storage, syote, this.env());
  }
  tallennaMyyntilasku(syote: MyyntilaskuSyote): Promise<StoredTosite> {
    return tallennaMyyntilasku(this.storage, syote, this.env());
  }
  listaaMyyntilaskut(suodatin: MyyntilaskuSuodatin): Promise<MyyntilaskuRivi[]> {
    return listaaMyyntilaskut(this.storage, suodatin);
  }
  tallennaOstolasku(syote: OstolaskuSyote): Promise<StoredTosite> {
    return tallennaOstolasku(this.storage, syote, this.env());
  }
  listaaOstolaskut(suodatin: OstolaskuListQuery): Promise<OstolaskuRivi[]> {
    return listaaOstolaskut(this.storage, suodatin);
  }
  listaaTulot(suodatin: RahavirtaSuodatin): Promise<RahavirtaRivi[]> {
    return listaaTulot(this.storage, suodatin);
  }
  listaaMenot(suodatin: RahavirtaSuodatin): Promise<RahavirtaRivi[]> {
    return listaaMenot(this.storage, suodatin);
  }
  tallennaHyvityslasku(syote: HyvityslaskuSyote): Promise<StoredTosite> {
    return tallennaHyvityslasku(this.storage, syote, this.env());
  }
  tallennaSuoritus(syote: SuoritusSyote): Promise<StoredTosite> {
    return tallennaSuoritus(this.storage, syote, this.env());
  }
  vanhennaMaksuperusteinenAlv(syote: VanhennusSyote): Promise<StoredTosite | null> {
    return vanhennaMaksuperusteinenAlv(this.storage, syote, this.env());
  }
  kirjaaMarginaalivero(params: MarginaaliverolaskelmaParams): Promise<StoredTosite | null> {
    return kirjaaMarginaalivero(this.storage, params, this.env());
  }
  async paataTilikausi(alkaa: IsoDate): Promise<void> {
    await paataTilikausi(this.storage, alkaa);
  }
  async avaaTilikausi(alkaa: IsoDate): Promise<void> {
    await avaaTilikausi(this.storage, alkaa);
  }
  luoTilinavaus(syote: TilinavausSyote): Promise<StoredTosite> {
    return luoTilinavaus(this.storage, syote, this.env());
  }
  haeTilinpaatos(params: TilinpaatosParams): Promise<TilinpaatosDoc> {
    return laadiTilinpaatos(this.storage, this.env(), params);
  }
  tallennaLiitetiedot(syote: LiitetiedotSyote): Promise<void> {
    return tallennaLiitetiedot(this.storage, syote);
  }
  vahvistaTilinpaatos(syote: VahvistusSyote): Promise<void> {
    return vahvistaTilinpaatos(this.storage, syote, this.env());
  }
  peruVahvistus(syote: VahvistusSyote): Promise<void> {
    return peruVahvistus(this.storage, syote);
  }
  haeAlvLaskelma(params: AlvLaskelmaParams): Promise<AlvLaskelmaTulos> {
    return haeAlvLaskelma(this.storage, params);
  }

  haeAlvErittely(params: AlvLaskelmaParams): Promise<AlvErittely> {
    return haeAlvErittely(this.storage, params);
  }
  tallennaAlvTilitys(syote: AlvTilitysSyote): Promise<StoredTosite> {
    return tallennaAlvTilitys(this.storage, syote, this.env());
  }
  haeAlvIlmoitus(params: AlvLaskelmaParams): Promise<AlvIlmoitus> {
    return haeAlvIlmoitus(this.storage, params);
  }
  haeEuMyyntiYhteenveto(params: AlvLaskelmaParams): Promise<EuMyyntiYhteenveto> {
    return haeEuMyyntiYhteenveto(this.storage, params);
  }
  haeVerolaskelma(params: VerolaskelmaParams): Promise<Verolaskelma> {
    return haeVerolaskelma(this.storage, params);
  }
  tallennaTulovero(syote: TuloveroSyote): Promise<StoredTosite> {
    return tallennaTulovero(this.storage, syote, this.env());
  }
  haePoistolaskelma(params: PoistolaskelmaParams): Promise<Poistolaskelma> {
    return haePoistolaskelma(this.storage, params);
  }
  tallennaPoistot(syote: PoistotSyote): Promise<StoredTosite> {
    return tallennaPoistot(this.storage, syote, this.env());
  }
  haeJaksotukset(params: JaksotuksetParams): Promise<Jaksotuslaskelma> {
    return haeJaksotukset(this.storage, params);
  }
  tallennaJaksotukset(syote: JaksotuksetSyote): Promise<StoredTosite> {
    return tallennaJaksotukset(this.storage, syote, this.env());
  }
  paivitaTosite(id: number, syote: TositeSyote): Promise<StoredTosite> {
    return tallennaTosite(this.storage, { ...syote, id }, this.env());
  }
  async muutaTila(id: number, tila: number): Promise<void> {
    await muutaTositteenTila(this.storage, id, tila, this.env());
  }
  poistaTosite(id: number): Promise<void> {
    return poistaTosite(this.storage, id, this.env());
  }
  listaaViennit(filter: ViennitFilter): Promise<TositeVienti[]> {
    return listaaViennit(this.storage, filter);
  }

  haeSaldot(params: SaldotParams): Promise<SaldotTulos> {
    return haeSaldot(this.storage, this.env(), params);
  }

  laadiRaportti(params: RaporttiParams): Promise<RaporttiRivi[]> {
    return laadiRaportti(this.storage, this.env(), params);
  }

  paivitaInit(patch: InitPatch): Promise<void> {
    return paivitaInit(this.storage, patch);
  }
  tallennaTili(numero: number, data: TiliData): Promise<void> {
    return putTili(this.storage, numero, data);
  }
  poistaTili(numero: number, taso?: number): Promise<void> {
    return poistaTili(this.storage, numero, taso);
  }
  tallennaTilikausi(alkaa: IsoDate, kausi: Tilikausi): Promise<void> {
    return putTilikausi(this.storage, alkaa, kausi);
  }
  poistaTilikausi(alkaa: IsoDate): Promise<void> {
    return poistaTilikausi(this.storage, alkaa);
  }
  // The engine handler types its param as Asetukset (Record<string,string>) but treats a null
  // value as delete-key at runtime — mirror the server binding's documented cast.
  paivitaAsetukset(patch: AsetuksetPatch): Promise<void> {
    return paivitaAsetukset(this.storage, patch as unknown as Asetukset);
  }

  haeKumppanit(): Promise<Kumppani[]> {
    return haeKumppanit(this.storage);
  }
  tallennaKumppani(kumppani: UusiKumppani): Promise<Kumppani> {
    return tallennaKumppani(this.storage, kumppani);
  }
  poistaKumppani(id: number): Promise<void> {
    return poistaKumppani(this.storage, id);
  }

  haeLiitteet(tosite: number): Promise<LiiteMeta[]> {
    return haeLiitteet(this.storage, tosite);
  }
  haeLiite(id: number): Promise<Liite | null> {
    return haeLiite(this.storage, id);
  }
  tallennaLiite(liite: UusiLiite): Promise<LiiteMeta> {
    return tallennaLiite(this.storage, liite);
  }
  lisaaLiite(liite: UusiLiite): Promise<LiiteMeta> {
    return lisaaLiite(this.storage, liite, this.env());
  }
  poistaLiite(id: number): Promise<void> {
    return poistaLiite(this.storage, id);
  }
}
