import type { AsetuksetPatch } from '@penni/contract';
import type {
  AlvErittely,
  AlvIlmoitus,
  AlvLaskelmaParams,
  AlvLaskelmaTulos,
  AlvTilitysSyote,
  Asetukset,
  BudjettiRivi,
  BudjettivertailuParams,
  BudjettivertailuRivi,
  EuMyyntiYhteenveto,
  HyvityslaskuSyote,
  InitBundle,
  InitPatch,
  IsoDate,
  JaksotuksetParams,
  JaksotuksetSyote,
  Jaksotuslaskelma,
  Kohdennus,
  KohdennusKaytolla,
  KohdennusOsio,
  KohdennusRaporttiParams,
  Kumppani,
  Liite,
  LiiteMeta,
  LiitetiedotSyote,
  ListattuTosite,
  MarginaaliverolaskelmaParams,
  MyyntilaskuRivi,
  MyyntilaskuSuodatin,
  MyyntilaskuSyote,
  OstolaskuListQuery,
  OstolaskuRivi,
  OstolaskuSyote,
  Poistolaskelma,
  PoistolaskelmaParams,
  PoistotSyote,
  RahavirtaRivi,
  RahavirtaSuodatin,
  RaporttiParams,
  RaporttiRivi,
  SaldotParams,
  SaldotTulos,
  StoredTosite,
  SuoritusSyote,
  TiliData,
  Tilikausi,
  TilinavausSyote,
  TilinpaatosDoc,
  TilinpaatosParams,
  TositeFilter,
  TositeSyote,
  TositeVienti,
  TuloveroSyote,
  UusiKohdennus,
  UusiKumppani,
  UusiLiite,
  VahvistusSyote,
  VanhennusSyote,
  Verolaskelma,
  VerolaskelmaParams,
} from '@penni/engine';

export type { AsetuksetPatch } from '@penni/contract';

/** Filter for listing ledger entries (matches the engine Storage.listViennit shape). */
export interface ViennitFilter {
  alkupvm?: IsoDate;
  loppupvm?: IsoDate;
  tili?: number;
}

/**
 * The single data-access seam. Two implementations — InProcessClient (engine over a Storage)
 * and HttpClient (ts-rest over the contract) — both speak these RICH engine types and are
 * proven behaviorally identical by runClientConformance. The clock/userId (ResourceEnv) is
 * supplied internally by each impl; it is NOT part of this UI-facing surface.
 */
export interface KpClient {
  // bootstrap / master data (read)
  haeInit(): Promise<InitBundle>;
  haeTilikaudet(): Promise<Tilikausi[]>;
  haeAsetukset(): Promise<Asetukset>;

  // vouchers
  /** Tositelista; jokainen rivi kantaa liitemääränsä (`liitteita`). */
  listaaTositteet(filter: TositeFilter): Promise<ListattuTosite[]>;
  haeTosite(id: number): Promise<StoredTosite | null>;
  luoTosite(syote: TositeSyote): Promise<StoredTosite>;
  tallennaMyyntilasku(syote: MyyntilaskuSyote): Promise<StoredTosite>;
  listaaMyyntilaskut(suodatin: MyyntilaskuSuodatin): Promise<MyyntilaskuRivi[]>;
  tallennaOstolasku(syote: OstolaskuSyote): Promise<StoredTosite>;
  listaaOstolaskut(suodatin: OstolaskuListQuery): Promise<OstolaskuRivi[]>;
  listaaTulot(suodatin: RahavirtaSuodatin): Promise<RahavirtaRivi[]>;
  listaaMenot(suodatin: RahavirtaSuodatin): Promise<RahavirtaRivi[]>;
  tallennaHyvityslasku(syote: HyvityslaskuSyote): Promise<StoredTosite>;
  tallennaSuoritus(syote: SuoritusSyote): Promise<StoredTosite>;
  vanhennaMaksuperusteinenAlv(syote: VanhennusSyote): Promise<StoredTosite | null>;
  kirjaaMarginaalivero(params: MarginaaliverolaskelmaParams): Promise<StoredTosite | null>;
  // tilikauden lukitus + tilinavaus
  paataTilikausi(alkaa: IsoDate): Promise<void>;
  avaaTilikausi(alkaa: IsoDate): Promise<void>;
  luoTilinavaus(syote: TilinavausSyote): Promise<StoredTosite>;
  // tilinpäätös
  haeTilinpaatos(params: TilinpaatosParams): Promise<TilinpaatosDoc>;
  tallennaLiitetiedot(syote: LiitetiedotSyote): Promise<void>;
  vahvistaTilinpaatos(syote: VahvistusSyote): Promise<void>;
  peruVahvistus(syote: VahvistusSyote): Promise<void>;
  // alv
  haeAlvLaskelma(params: AlvLaskelmaParams): Promise<AlvLaskelmaTulos>;
  haeAlvErittely(params: AlvLaskelmaParams): Promise<AlvErittely>;
  tallennaAlvTilitys(syote: AlvTilitysSyote): Promise<StoredTosite>;
  haeAlvIlmoitus(params: AlvLaskelmaParams): Promise<AlvIlmoitus>;
  haeEuMyyntiYhteenveto(params: AlvLaskelmaParams): Promise<EuMyyntiYhteenveto>;
  haeVerolaskelma(params: VerolaskelmaParams): Promise<Verolaskelma>;
  tallennaTulovero(syote: TuloveroSyote): Promise<StoredTosite>;
  haePoistolaskelma(params: PoistolaskelmaParams): Promise<Poistolaskelma>;
  tallennaPoistot(syote: PoistotSyote): Promise<StoredTosite>;
  haeJaksotukset(params: JaksotuksetParams): Promise<Jaksotuslaskelma>;
  tallennaJaksotukset(syote: JaksotuksetSyote): Promise<StoredTosite>;
  paivitaTosite(id: number, syote: TositeSyote): Promise<StoredTosite>;
  muutaTila(id: number, tila: number): Promise<void>;
  poistaTosite(id: number): Promise<void>;
  listaaViennit(filter: ViennitFilter): Promise<TositeVienti[]>;

  // saldot
  haeSaldot(params: SaldotParams): Promise<SaldotTulos>;

  // raportit
  /** Render a report (income statement / balance sheet) — rich rows (arvo is Cents | null). */
  laadiRaportti(params: RaporttiParams): Promise<RaporttiRivi[]>;
  /** Tuloslaskelma kohdennuksittain: osio per kustannuspaikka tai projekti. */
  laadiKohdennusRaportti(p: KohdennusRaporttiParams): Promise<KohdennusOsio[]>;
  /** Budjetti vs. toteuma raporttikaavan riveittäin. */
  laadiBudjettivertailu(p: BudjettivertailuParams): Promise<BudjettivertailuRivi[]>;

  // master data (write)
  paivitaInit(patch: InitPatch): Promise<void>;
  tallennaTili(numero: number, data: TiliData): Promise<void>;
  poistaTili(numero: number, taso?: number): Promise<void>;
  tallennaTilikausi(alkaa: IsoDate, kausi: Tilikausi): Promise<void>;
  poistaTilikausi(alkaa: IsoDate): Promise<void>;
  paivitaAsetukset(patch: AsetuksetPatch): Promise<void>;

  // kumppanit (partners)
  haeKumppanit(): Promise<Kumppani[]>;
  tallennaKumppani(kumppani: UusiKumppani): Promise<Kumppani>;
  poistaKumppani(id: number): Promise<void>;

  // kohdennukset (kustannuspaikat, projektit, merkkaukset) ja budjetti
  haeKohdennukset(): Promise<KohdennusKaytolla[]>;
  tallennaKohdennus(k: UusiKohdennus): Promise<Kohdennus>;
  /** Hylätään koodilla KOHDENNUSKAYTOSSA / KOHDENNUSPROJEKTEJA, kun poisto ei ole sallittu. */
  poistaKohdennus(id: number): Promise<void>;
  haeBudjetti(tilikausi: IsoDate): Promise<BudjettiRivi[]>;
  /** Korvaa tilikauden (alkupäivä) budjetin kokonaan. */
  tallennaBudjetti(tilikausi: IsoDate, rivit: BudjettiRivi[]): Promise<void>;

  // liitteet (attachments)
  haeLiitteet(tosite: number): Promise<LiiteMeta[]>;
  haeLiite(id: number): Promise<Liite | null>;
  tallennaLiite(liite: UusiLiite): Promise<LiiteMeta>;
  /**
   * Agenttipolku: lisää uuden liitteen luonnokselle tai lukitsemattoman kauden kirjatulle
   * tositteelle ja kirjaa lisäyksen tositteen lokiin (engine lisaaLiite). Lukitulla kaudella
   * PVMLUKITTU; muilla tiloilla LIITE_EI_SALLITTU.
   */
  lisaaLiite(liite: UusiLiite): Promise<LiiteMeta>;
  poistaLiite(id: number): Promise<void>;
}
