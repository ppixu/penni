import { parsiIlmoitusOtsikko } from '@/alv/alvKaudet';
import { useKpClient } from '@/app/KpClientProvider';
import type { AsetuksetPatch, KpClient } from '@penni/asiakas';
import type {
  AlvErittely,
  AlvLaskelmaParams,
  AlvLaskelmaTulos,
  BudjettiRivi,
  BudjettivertailuParams,
  BudjettivertailuRivi,
  EuMyyntiYhteenveto,
  HyvityslaskuSyote,
  InitBundle,
  IsoDate,
  Kohdennus,
  KohdennusKaytolla,
  KohdennusOsio,
  KohdennusRaporttiParams,
  Kumppani,
  LiiteMeta,
  LiitetiedotSyote,
  ListattuTosite,
  MyyntilaskuRivi,
  MyyntilaskuSuodatin,
  MyyntilaskuSyote,
  OstolaskuListQuery,
  OstolaskuRivi,
  OstolaskuSyote,
  RahavirtaRivi,
  RahavirtaSuodatin,
  RaporttiParams,
  RaporttiRivi,
  SaldotParams,
  SaldotTulos,
  StoredTosite,
  SuoritusSyote,
  Tilikausi,
  TilinpaatosDoc,
  TilinpaatosParams,
  TositeFilter,
  TositeVienti,
  UusiKohdennus,
  UusiKumppani,
  UusiLiite,
  VahvistusSyote,
} from '@penni/engine';
import { ResourceError, type TiliData, TositeTyyppi } from '@penni/engine';
import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';

/** Stable query keys (one place, so invalidation in 0E-2b matches). */
export const avaimet = {
  init: ['init'] as const,
  saldot: (params: SaldotParams) => ['saldot', params] as const,
  raportti: (params: RaporttiParams) => ['raportti', params] as const,
  tositteet: (filter: TositeFilter) => ['tositteet', filter] as const,
  tosite: (id: number) => ['tosite', id] as const,
  viennit: (tili: number) => ['viennit', tili] as const,
  myyntilaskut: (suodatin: MyyntilaskuSuodatin) => ['myyntilaskut', suodatin] as const,
  ostolaskut: (suodatin: OstolaskuListQuery) => ['ostolaskut', suodatin] as const,
  tulot: (suodatin: RahavirtaSuodatin) => ['tulot', suodatin] as const,
  menot: (suodatin: RahavirtaSuodatin) => ['menot', suodatin] as const,
  kumppanit: ['kumppanit'] as const,
  kohdennukset: ['kohdennukset'] as const,
  budjetti: (tilikausi: IsoDate) => ['budjetti', tilikausi] as const,
  kohdennusRaportti: (params: KohdennusRaporttiParams) => ['kohdennusRaportti', params] as const,
  budjettivertailu: (params: BudjettivertailuParams) => ['budjettivertailu', params] as const,
  alvLaskelma: (params: AlvLaskelmaParams) => ['alvLaskelma', params] as const,
  alvErittely: (params: AlvLaskelmaParams) => ['alvErittely', params] as const,
  euMyynti: (params: AlvLaskelmaParams) => ['euMyynti', params] as const,
  tilinpaatos: (params: TilinpaatosParams) => ['tilinpaatos', params] as const,
  liitteet: (tositeId: number) => ['liitteet', tositeId] as const,
};

export function useInit() {
  const client = useKpClient();
  return useQuery<InitBundle>({ queryKey: avaimet.init, queryFn: () => client.haeInit() });
}

export function useSaldot(params: SaldotParams, enabled = true) {
  const client = useKpClient();
  return useQuery<SaldotTulos>({
    queryKey: avaimet.saldot(params),
    queryFn: () => client.haeSaldot(params),
    enabled,
  });
}

export function useRaportti(params: RaporttiParams, enabled = true) {
  const client = useKpClient();
  return useQuery<RaporttiRivi[]>({
    queryKey: avaimet.raportti(params),
    queryFn: () => client.laadiRaportti(params),
    enabled,
  });
}

export function useTositteet(filter: TositeFilter, enabled = true) {
  const client = useKpClient();
  return useQuery<ListattuTosite[]>({
    queryKey: avaimet.tositteet(filter),
    queryFn: () => client.listaaTositteet(filter),
    enabled,
  });
}

function tositeKysely(client: KpClient, id: number) {
  return { queryKey: avaimet.tosite(id), queryFn: () => client.haeTosite(id) };
}

export function useTosite(id: number, enabled = true) {
  const client: KpClient = useKpClient();
  return useQuery<StoredTosite | null>({ ...tositeKysely(client, id), enabled });
}

/**
 * Editoriin avattava tosite haetaan avattaessa aina palvelimelta. Välimuistin ['tosite', id] voi
 * olla edellisen käynnin avaushetken versio (automaattiset tallennukset eivät päivitä sitä), ja
 * siitä avattu editori tallentaisi vanhan sisällön uudempien muutosten päälle. `haettu` kertoo,
 * että tuore haku on valmis (id puuttuu = ei haettavaa); vain avaus odottaa sitä, myöhemmät
 * uudelleenhaut eivät palauta latausnäkymää.
 */
export function useAvattavaTosite(id: number | undefined) {
  const client: KpClient = useKpClient();
  const kysely = useQuery<StoredTosite | null>({
    ...tositeKysely(client, id ?? 0),
    enabled: id !== undefined,
    refetchOnMount: 'always',
  });
  return { tosite: kysely.data, haettu: id === undefined || kysely.isFetchedAfterMount };
}

/** Tositteen liitteiden metatiedot (ei tavudataa) — käytetään liitelistassa. */
export function useLiitteet(tositeId: number, enabled = true) {
  const client = useKpClient();
  return useQuery<LiiteMeta[]>({
    queryKey: avaimet.liitteet(tositeId),
    queryFn: () => client.haeLiitteet(tositeId),
    enabled,
  });
}

/** Tallenna uusi liite tositteelle. Mitätöi tositteen liitelistan. */
export function useTallennaLiite() {
  const client = useKpClient();
  const qc = useQueryClient();
  const mutaatio = useMutation<LiiteMeta, unknown, UusiLiite>({
    mutationFn: (liite) => client.tallennaLiite(liite),
    onSuccess: (_r, liite) => {
      void qc.invalidateQueries({ queryKey: avaimet.liitteet(liite.tosite) });
    },
  });
  return { tallenna: (l: UusiLiite) => mutaatio.mutateAsync(l), tallentaa: mutaatio.isPending };
}

/**
 * Lisää liite vain-lisäävästi (`lisaaLiite`: auditoitu, tarkistaa kauden lukituksen, ei koskaan
 * korvaa olemassa olevaa). Mitätöi tositteen liitelistan.
 */
export function useLisaaLiite() {
  const client = useKpClient();
  const qc = useQueryClient();
  const mutaatio = useMutation<LiiteMeta, unknown, UusiLiite>({
    mutationFn: (liite) => client.lisaaLiite(liite),
    onSuccess: (_r, liite) => {
      void qc.invalidateQueries({ queryKey: avaimet.liitteet(liite.tosite) });
    },
  });
  return { lisaa: (l: UusiLiite) => mutaatio.mutateAsync(l), lisaamassa: mutaatio.isPending };
}

/** Poista liite. Mitätöi tositteen liitelistan. */
export function usePoistaLiite(tositeId: number) {
  const client = useKpClient();
  const qc = useQueryClient();
  const mutaatio = useMutation<void, unknown, number>({
    mutationFn: (id) => client.poistaLiite(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: avaimet.liitteet(tositeId) });
    },
  });
  return { poista: (id: number) => mutaatio.mutateAsync(id), poistaa: mutaatio.isPending };
}

export function useViennit(tili: number, enabled = true) {
  const client = useKpClient();
  return useQuery<TositeVienti[]>({
    queryKey: avaimet.viennit(tili),
    queryFn: () => client.listaaViennit({ tili }),
    enabled,
  });
}

/** Map a thrown engine ResourceError to a Finnish inline message for chart mutations. */
function tiliVirheViesti(e: unknown): string {
  if (e instanceof ResourceError) {
    switch (e.code) {
      case 'EITILIKAUTTA':
        return 'Päivälle ei ole avointa tilikautta.';
      default:
        return e.message || 'Tilin tallennus epäonnistui.';
    }
  }
  return 'Tilin tallennus epäonnistui.';
}

/** Save (create/edit) a leaf account. Invalidates the init + saldot caches; surfaces a Finnish error. */
export function useTallennaTili() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);

  const mutaatio = useMutation<void, unknown, { numero: number; data: TiliData }>({
    mutationFn: ({ numero, data }) => client.tallennaTili(numero, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['init'] });
      void qc.invalidateQueries({ queryKey: ['saldot'] });
    },
  });

  async function tallenna(numero: number, data: TiliData): Promise<boolean> {
    setVirheviesti(null);
    try {
      await mutaatio.mutateAsync({ numero, data });
      return true;
    } catch (e) {
      setVirheviesti(tiliVirheViesti(e));
      return false;
    }
  }

  return { tallenna, virheviesti, tallentaa: mutaatio.isPending };
}

/** Delete a leaf account (the engine also drops its budget rows). Invalidates the init, saldot
 *  and budget caches; surfaces a Finnish error. */
export function usePoistaTili() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);

  const mutaatio = useMutation<void, unknown, number>({
    mutationFn: (numero) => client.poistaTili(numero),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['init'] });
      void qc.invalidateQueries({ queryKey: ['saldot'] });
      void qc.invalidateQueries({ queryKey: ['budjetti'] });
      void qc.invalidateQueries({ queryKey: ['budjettivertailu'] });
    },
  });

  async function poista(numero: number): Promise<boolean> {
    setVirheviesti(null);
    try {
      await mutaatio.mutateAsync(numero);
      return true;
    } catch (e) {
      setVirheviesti(tiliVirheViesti(e));
      return false;
    }
  }

  return { poista, virheviesti, poistaa: mutaatio.isPending };
}

/** Map a thrown engine error to a Finnish inline message for settings/fiscal-year mutations. */
function asetusVirheViesti(e: unknown): string {
  if (e instanceof ResourceError) return e.message || 'Tallennus epäonnistui.';
  return 'Tallennus epäonnistui.';
}

/** Save org settings (sparse PATCH). Invalidates the init cache; surfaces a Finnish error. */
export function usePaivitaAsetukset() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);

  const mutaatio = useMutation<void, unknown, AsetuksetPatch>({
    mutationFn: (patch) => client.paivitaAsetukset(patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['init'] });
    },
  });

  async function tallenna(patch: AsetuksetPatch): Promise<boolean> {
    setVirheviesti(null);
    try {
      await mutaatio.mutateAsync(patch);
      return true;
    } catch (e) {
      setVirheviesti(asetusVirheViesti(e));
      return false;
    }
  }

  return { tallenna, virheviesti, tallentaa: mutaatio.isPending };
}

/** Save (append/create) a fiscal year. Invalidates the init cache; surfaces a Finnish error. */
export function useTallennaTilikausi() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);

  const mutaatio = useMutation<void, unknown, { alkaa: IsoDate; kausi: Tilikausi }>({
    mutationFn: ({ alkaa, kausi }) => client.tallennaTilikausi(alkaa, kausi),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['init'] });
    },
  });

  async function tallenna(alkaa: IsoDate, kausi: Tilikausi): Promise<boolean> {
    setVirheviesti(null);
    try {
      await mutaatio.mutateAsync({ alkaa, kausi });
      return true;
    } catch (e) {
      setVirheviesti(asetusVirheViesti(e));
      return false;
    }
  }

  return { tallenna, virheviesti, tallentaa: mutaatio.isPending };
}

export function useMyyntilaskut(suodatin: MyyntilaskuSuodatin) {
  const client = useKpClient();
  return useQuery<MyyntilaskuRivi[]>({
    queryKey: avaimet.myyntilaskut(suodatin),
    queryFn: () => client.listaaMyyntilaskut(suodatin),
  });
}

export function useOstolaskut(suodatin: OstolaskuListQuery) {
  const client = useKpClient();
  return useQuery<OstolaskuRivi[]>({
    queryKey: avaimet.ostolaskut(suodatin),
    queryFn: () => client.listaaOstolaskut(suodatin),
  });
}

export function useTulot(suodatin: RahavirtaSuodatin, enabled = true) {
  const client = useKpClient();
  return useQuery<RahavirtaRivi[]>({
    queryKey: avaimet.tulot(suodatin),
    queryFn: () => client.listaaTulot(suodatin),
    enabled,
  });
}

export function useMenot(suodatin: RahavirtaSuodatin, enabled = true) {
  const client = useKpClient();
  return useQuery<RahavirtaRivi[]>({
    queryKey: avaimet.menot(suodatin),
    queryFn: () => client.listaaMenot(suodatin),
    enabled,
  });
}

export function useKumppanit() {
  const client = useKpClient();
  return useQuery<Kumppani[]>({
    queryKey: avaimet.kumppanit,
    queryFn: () => client.haeKumppanit(),
  });
}

/** Kohdennukset käyttömäärineen (`lkm`). */
export function useKohdennukset() {
  const client = useKpClient();
  return useQuery<KohdennusKaytolla[]>({
    queryKey: avaimet.kohdennukset,
    queryFn: () => client.haeKohdennukset(),
  });
}

/** Kohdennusten muutos vaikuttaa listaan, tuloslaskelman suodattimeen ja kaikkiin kohdennus-/budjettinäkymiin. */
function mitatoiKohdennusvaikutukset(qc: ReturnType<typeof useQueryClient>) {
  for (const avain of [
    'kohdennukset',
    'raportti',
    'kohdennusRaportti',
    'budjetti',
    'budjettivertailu',
  ])
    void qc.invalidateQueries({ queryKey: [avain] });
}

/** Luo/päivitä kohdennus. Virhe (ResourceError) jää mutaation `error`-kenttään. */
export function useTallennaKohdennus() {
  const client = useKpClient();
  const qc = useQueryClient();
  return useMutation<Kohdennus, Error, UusiKohdennus>({
    mutationFn: (k) => client.tallennaKohdennus(k),
    onSuccess: () => mitatoiKohdennusvaikutukset(qc),
  });
}

/** Poista kohdennus (ja sen budjettirivit). Estetty käytössä olevalta ja projekteja sisältävältä. */
export function usePoistaKohdennus() {
  const client = useKpClient();
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: (id) => client.poistaKohdennus(id),
    onSuccess: () => mitatoiKohdennusvaikutukset(qc),
  });
}

/** Tilikauden budjettirivit (kaikki kohdennukset); ei kyselyä ennen kuin tilikausi tiedetään. */
export function useBudjetti(tilikausi: IsoDate | undefined) {
  const client = useKpClient();
  return useQuery<BudjettiRivi[]>({
    queryKey: avaimet.budjetti(tilikausi ?? ''),
    queryFn: () => client.haeBudjetti(tilikausi as IsoDate),
    enabled: tilikausi !== undefined,
  });
}

/**
 * Kohdennukset, joilla on budjettia jollakin annetuista tilikausista (moottori estää niiden
 * tyypin vaihdon). Jakaa välimuistin useBudjetin kanssa; undefined, kunnes kaikki on ladattu.
 */
export function useBudjetoidutKohdennukset(kaudet: readonly IsoDate[]): Set<number> | undefined {
  const client = useKpClient();
  const tulokset = useQueries({
    queries: kaudet.map((alkaa) => ({
      queryKey: avaimet.budjetti(alkaa),
      queryFn: () => client.haeBudjetti(alkaa),
    })),
  });
  if (tulokset.some((t) => t.data === undefined)) return undefined;
  return new Set(tulokset.flatMap((t) => (t.data ?? []).map((r) => r.kohdennus)));
}

/** Korvaa koko tilikauden budjetin. */
export function useTallennaBudjetti() {
  const client = useKpClient();
  const qc = useQueryClient();
  return useMutation<void, Error, { tilikausi: IsoDate; rivit: BudjettiRivi[] }>({
    mutationFn: ({ tilikausi, rivit }) => client.tallennaBudjetti(tilikausi, rivit),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['budjetti'] });
      void qc.invalidateQueries({ queryKey: ['budjettivertailu'] });
    },
  });
}

export function useKohdennusRaportti(params: KohdennusRaporttiParams, enabled = true) {
  const client = useKpClient();
  return useQuery<KohdennusOsio[]>({
    queryKey: avaimet.kohdennusRaportti(params),
    queryFn: () => client.laadiKohdennusRaportti(params),
    enabled,
  });
}

export function useBudjettivertailu(params: BudjettivertailuParams, enabled = true) {
  const client = useKpClient();
  return useQuery<BudjettivertailuRivi[]>({
    queryKey: avaimet.budjettivertailu(params),
    queryFn: () => client.laadiBudjettivertailu(params),
    enabled,
  });
}

/** Laskutuksen virhekartta (spec §8): ResourceError.code → suomi. Koodi-virhebody-
 *  interluden ansiosta koodit ovat identtiset InProcess- ja HTTP-transporteilla. */
function laskuVirheViesti(e: unknown): string {
  if (e instanceof ResourceError) {
    switch (e.code) {
      case 'EIRIVEJA':
        return 'Laskulla ei ole rivejä';
      case 'EILASKUTILIA':
        return 'Laskutuksen tili puuttuu asetuksista';
      case 'EIKOHDENTAMATONTILIA':
        return 'Maksuperusteisen alv:n tili puuttuu tilikartasta';
      case 'PVMLUKITTU':
        return 'Tilikausi on lukittu tälle päivälle';
      case 'EITILIKAUTTA':
        return 'Päivälle ei ole tilikautta';
      case 'EIVALMISTU':
        return 'Lasku ei läpäise tarkastusta';
      case 'EISUMMAA':
        return 'Summa puuttuu tai on nolla';
      case 'EITOSITETTA':
        return 'Laskua ei löydy';
      case 'EIAVOINTAERAA':
        return 'Laskulla ei ole avointa saatavaa';
      case 'EIOSTOVELKATILIA':
        return 'Ostovelkatili puuttuu asetuksista';
      case 'EIMENOTILIA':
        return 'Menotili puuttuu asetuksista';
      case 'EIALVTILIA':
        return 'ALV-tili puuttuu tilikartasta';
      case 'EIHYVITETTAVAA':
        return 'Laskua ei voi hyvittää (ei erää)';
      default:
        return `Tallennus epäonnistui (${e.code})`;
    }
  }
  return 'Tallennus epäonnistui';
}

/** Laskun kirjaus muuttaa kohdennusten käyttömäärät (lkm) ja kohdennus-/budjettiraporttien
 *  toteuman. */
function mitatoiKohdennustenToteuma(qc: ReturnType<typeof useQueryClient>) {
  for (const avain of ['kohdennukset', 'kohdennusRaportti', 'budjettivertailu'])
    void qc.invalidateQueries({ queryKey: [avain] });
}

/** Tallenna myyntilasku. Palauttaa StoredTositen (dokumenttiin navigointia varten)
 *  tai undefined virheessä; invalidoi laskulistan, tositteet ja saldot. */
export function useTallennaMyyntilasku() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);

  const mutaatio = useMutation<StoredTosite, unknown, MyyntilaskuSyote>({
    mutationFn: (syote) => client.tallennaMyyntilasku(syote),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['myyntilaskut'] });
      void qc.invalidateQueries({ queryKey: ['tositteet'] });
      void qc.invalidateQueries({ queryKey: ['saldot'] });
      void qc.invalidateQueries({ queryKey: ['tulot'] });
      void qc.invalidateQueries({ queryKey: ['menot'] });
      mitatoiKohdennustenToteuma(qc);
    },
  });

  async function tallenna(syote: MyyntilaskuSyote): Promise<StoredTosite | undefined> {
    setVirheviesti(null);
    try {
      return await mutaatio.mutateAsync(syote);
    } catch (e) {
      setVirheviesti(laskuVirheViesti(e));
      return undefined;
    }
  }

  return { tallenna, virheviesti, tallentaa: mutaatio.isPending };
}

/** Kirjaa suoritus laskun erälle. Invalidoi laskulistan, tositteet ja saldot. */
export function useTallennaSuoritus() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);

  const mutaatio = useMutation<StoredTosite, unknown, SuoritusSyote>({
    mutationFn: (syote) => client.tallennaSuoritus(syote),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['myyntilaskut'] });
      void qc.invalidateQueries({ queryKey: ['ostolaskut'] });
      void qc.invalidateQueries({ queryKey: ['tositteet'] });
      void qc.invalidateQueries({ queryKey: ['saldot'] });
      void qc.invalidateQueries({ queryKey: ['tulot'] });
      void qc.invalidateQueries({ queryKey: ['menot'] });
      mitatoiKohdennustenToteuma(qc);
    },
  });

  async function tallenna(syote: SuoritusSyote): Promise<StoredTosite | undefined> {
    setVirheviesti(null);
    try {
      return await mutaatio.mutateAsync(syote);
    } catch (e) {
      setVirheviesti(laskuVirheViesti(e));
      return undefined;
    }
  }

  return { tallenna, virheviesti, tallentaa: mutaatio.isPending };
}

/** Tallenna ostolasku. Palauttaa StoredTositen (näkymään navigointia varten) tai undefined
 *  virheessä; invalidoi ostolaskulistan, tositteet ja saldot. */
export function useTallennaOstolasku() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);

  const mutaatio = useMutation<StoredTosite, unknown, OstolaskuSyote>({
    mutationFn: (syote) => client.tallennaOstolasku(syote),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ostolaskut'] });
      void qc.invalidateQueries({ queryKey: ['tositteet'] });
      void qc.invalidateQueries({ queryKey: ['saldot'] });
      void qc.invalidateQueries({ queryKey: ['tulot'] });
      void qc.invalidateQueries({ queryKey: ['menot'] });
      mitatoiKohdennustenToteuma(qc);
    },
  });

  async function tallenna(syote: OstolaskuSyote): Promise<StoredTosite | undefined> {
    setVirheviesti(null);
    try {
      return await mutaatio.mutateAsync(syote);
    } catch (e) {
      setVirheviesti(laskuVirheViesti(e));
      return undefined;
    }
  }
  return { tallenna, virheviesti, tallentaa: mutaatio.isPending };
}

/** Hyvitä lasku (osto tai myynti). Invalidoi molemmat laskulistat, tositteet ja saldot. */
export function useTallennaHyvityslasku() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);

  const mutaatio = useMutation<StoredTosite, unknown, HyvityslaskuSyote>({
    mutationFn: (syote) => client.tallennaHyvityslasku(syote),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ostolaskut'] });
      void qc.invalidateQueries({ queryKey: ['myyntilaskut'] });
      void qc.invalidateQueries({ queryKey: ['tositteet'] });
      void qc.invalidateQueries({ queryKey: ['saldot'] });
      void qc.invalidateQueries({ queryKey: ['tulot'] });
      void qc.invalidateQueries({ queryKey: ['menot'] });
      mitatoiKohdennustenToteuma(qc);
    },
  });

  async function tallenna(syote: HyvityslaskuSyote): Promise<StoredTosite | undefined> {
    setVirheviesti(null);
    try {
      return await mutaatio.mutateAsync(syote);
    } catch (e) {
      setVirheviesti(laskuVirheViesti(e));
      return undefined;
    }
  }
  return { tallenna, virheviesti, tallentaa: mutaatio.isPending };
}

/** Tallenna (luo/päivitä) kumppani. Palauttaa Kumppanin (automaattivalintaa varten). */
export function useTallennaKumppani() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);

  const mutaatio = useMutation<Kumppani, unknown, UusiKumppani>({
    mutationFn: (kumppani) => client.tallennaKumppani(kumppani),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kumppanit'] });
    },
  });

  async function tallenna(kumppani: UusiKumppani): Promise<Kumppani | undefined> {
    setVirheviesti(null);
    try {
      return await mutaatio.mutateAsync(kumppani);
    } catch (e) {
      setVirheviesti(asetusVirheViesti(e));
      return undefined;
    }
  }

  return { tallenna, virheviesti, tallentaa: mutaatio.isPending };
}

/** Poista kumppani. Palauttaa true onnistuessa, false virheessä (virheviesti asetetaan). */
export function usePoistaKumppani() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);

  const mutaatio = useMutation<void, unknown, number>({
    mutationFn: (id) => client.poistaKumppani(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kumppanit'] });
      void qc.invalidateQueries({ queryKey: ['myyntilaskut'] });
      void qc.invalidateQueries({ queryKey: ['ostolaskut'] });
      void qc.invalidateQueries({ queryKey: ['tulot'] });
      void qc.invalidateQueries({ queryKey: ['menot'] });
    },
  });

  async function poista(id: number): Promise<boolean> {
    setVirheviesti(null);
    try {
      await mutaatio.mutateAsync(id);
      return true;
    } catch (e) {
      setVirheviesti(asetusVirheViesti(e));
      return false;
    }
  }

  return { poista, virheviesti, poistaa: mutaatio.isPending };
}

export function useAlvLaskelma(params: AlvLaskelmaParams, enabled = true) {
  const client = useKpClient();
  return useQuery<AlvLaskelmaTulos>({
    queryKey: avaimet.alvLaskelma(params),
    queryFn: () => client.haeAlvLaskelma(params),
    enabled,
  });
}

export function useEuMyynti(params: AlvLaskelmaParams, enabled = true) {
  const client = useKpClient();
  return useQuery<EuMyyntiYhteenveto>({
    queryKey: avaimet.euMyynti(params),
    queryFn: () => client.haeEuMyyntiYhteenveto(params),
    enabled,
  });
}

export function useAlvErittely(params: AlvLaskelmaParams, enabled = true) {
  const client = useKpClient();
  return useQuery<AlvErittely>({
    queryKey: avaimet.alvErittely(params),
    queryFn: () => client.haeAlvErittely(params),
    enabled,
  });
}

/** Alv-toimintojen virhekartta (spec §7): ResourceError.code → suomi. Koodi-virhebodyn
 *  ansiosta koodit ovat identtiset InProcess- ja HTTP-transporteilla. */
export function alvVirheViesti(e: unknown): string {
  if (e instanceof ResourceError) {
    switch (e.code) {
      case 'JOILMOITETTU':
        return 'Kausi on jo ilmoitettu';
      case 'EITILITYSTA':
        return 'Kaudella ei ole tilitettävää arvonlisäveroa';
      case 'EIALVTILIA':
        return 'ALV-tili puuttuu tilikartasta';
      case 'PVMLUKITTU':
        return 'Tilikausi on lukittu tälle päivälle';
      case 'EIVALMISTU':
        return 'Kirjaus ei läpäise tarkastusta';
      case 'EITILIKAUTTA':
        return 'Päivälle ei ole tilikautta';
      case 'EITOSITETTA':
        return 'Tositetta ei löydy';
      default:
        return `Toiminto epäonnistui (${e.code})`;
    }
  }
  return 'Toiminto epäonnistui';
}

/** Nielaise ResourceError annetuilla koodeilla (esikirjausvaiheiden odotetut ei-virheet). */
function nielaise(e: unknown, koodit: readonly string[]): void {
  if (e instanceof ResourceError && koodit.includes(e.code)) return;
  throw e;
}

export interface AlvValmistelu {
  /** Tuore laskelma esikirjausten JÄLKEEN — täsmälleen ne luvut, jotka tilitetään. */
  laskelma: AlvLaskelmaTulos;
  /** Valmistelun kirjaamat tositteet (vanhennus/marginaalivero). Ne jäävät voimaan vaikka
   *  tilitys peruttaisiin: idempotentteja, lakisääteisiä kauden päätöskirjauksia. */
  esikirjaukset: StoredTosite[];
}

/**
 * Tilityksen valmistelu (spec P2): moottori EI valvo esikirjausjärjestystä ja väärä
 * järjestys kaatuu kovaa (r1 gotcha 2) — tämä funktio on ainoa valvoja.
 * 1) Maksuperusteisen alv:n vanhennus — EIMAKSUPERUSTEINEN nielaistaan (ei käytössä).
 * 2) Marginaalivero — EIVEROVELVOLLINEN ja JOMARGINAALILASKELMA nielaistaan.
 * 3) Tuore laskelma esikirjausten jälkeen.
 * Uusinta-ajo on turvallista: vanhennus on laskukohtaisesti idempotentti
 * (maksuperusteisenVanhennus.ts:42-46) ja marginaalivero torjuu toiston nielaistavalla
 * JOMARGINAALILASKELMA-koodilla (marginaalivero.ts:59-66).
 */
export async function valmisteleAlvTilitys(
  client: KpClient,
  params: AlvLaskelmaParams,
): Promise<AlvValmistelu> {
  const esikirjaukset: StoredTosite[] = [];
  try {
    const tosite = await client.vanhennaMaksuperusteinenAlv({ loppupvm: params.loppupvm });
    if (tosite) esikirjaukset.push(tosite);
  } catch (e) {
    nielaise(e, ['EIMAKSUPERUSTEINEN']);
  }
  try {
    const tosite = await client.kirjaaMarginaalivero({
      alkupvm: params.alkupvm,
      loppupvm: params.loppupvm,
    });
    if (tosite) esikirjaukset.push(tosite);
  } catch (e) {
    nielaise(e, ['EIVEROVELVOLLINEN', 'JOMARGINAALILASKELMA']);
  }
  const laskelma = await client.haeAlvLaskelma(params);
  return { laskelma, esikirjaukset };
}

/** Tilitä kausi: esikirjaukset (uudelleenajo on idempotentti) + tilitystosite. Invalidoi
 *  initin (AlvIlmoitettu on asetus), tositteet, saldot ja alv-näkymien kyselyt. */
export function useTilitaAlv() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);

  const mutaatio = useMutation<StoredTosite, unknown, AlvLaskelmaParams>({
    mutationFn: async (params) => {
      // P2-järjestys myös vahvistushetkellä — moottorin JOILMOITETTU-frontier +
      // samakausisen ALVLASKELMA-tositteen backstop hoitavat kilpajuoksut, UI ei
      // rakenna omaa lukkoa (spec §4.2).
      await valmisteleAlvTilitys(client, params);
      return client.tallennaAlvTilitys(params);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['init'] });
      void qc.invalidateQueries({ queryKey: ['tositteet'] });
      void qc.invalidateQueries({ queryKey: ['saldot'] });
      void qc.invalidateQueries({ queryKey: ['alvLaskelma'] });
      void qc.invalidateQueries({ queryKey: ['alvErittely'] });
      void qc.invalidateQueries({ queryKey: ['euMyynti'] });
      // kirjaaMarginaalivero debitoi myyntitilejä (marginaalivero.ts) — ALV-tilitys voi siis
      // aidosti postata Tulot-rivin. Sama uniformi kuin joka muullakin mutaatiolla.
      void qc.invalidateQueries({ queryKey: ['tulot'] });
      void qc.invalidateQueries({ queryKey: ['menot'] });
    },
  });

  async function tilita(params: AlvLaskelmaParams): Promise<StoredTosite | undefined> {
    setVirheviesti(null);
    try {
      return await mutaatio.mutateAsync(params);
    } catch (e) {
      setVirheviesti(alvVirheViesti(e));
      return undefined;
    }
  }

  return { tilita, virheviesti, tilittaa: mutaatio.isPending };
}

/**
 * Poista alv-ilmoitus ja kelaa AlvIlmoitettu-raja taaksepäin (spec §6). Kaksivaiheisuus ei
 * ole atominen — sama sauma kuin moottorin tilitys-kirjoituksessa itsessään: jos rajan
 * siirto epäonnistuu, poiston uusinta-ajo korjaa rajan, koska tosite on jo poissa.
 * Kauden MARGINAALILASKELMA-/JARJESTELMATOSITE-esikirjauksia EI poisteta (itsenäisiä,
 * laillisia kirjauksia; marginaalialijaämän kanto elää MARGINAALILASKELMA-tositteilla,
 * joten poisto ei kadota sitä — parannus legacyyn, r2 §4). Rajan kelaus vapauttaa kauden
 * kirjaukset muokattaviksi (PVMALV-sääntö lukee asetusta suoraan).
 */
export function usePoistaAlvIlmoitus() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);

  const mutaatio = useMutation<void, unknown, number>({
    mutationFn: async (id) => {
      await client.poistaTosite(id);
      // Uusi raja = jäljellä olevien tilitystositteiden suurin parsittu loppupvm
      // (parsinnan epäonnistuessa tositepäivä, joka moottorin kirjoittamana == loppupvm),
      // tai avain kokonaan pois (null-patch) jos ilmoituksia ei jää.
      const jaljella = await client.listaaTositteet({ tyyppi: TositeTyyppi.ALVLASKELMA });
      let uusiRaja: string | null = null;
      for (const tosite of jaljella) {
        const kausi = tosite.otsikko === undefined ? null : parsiIlmoitusOtsikko(tosite.otsikko);
        const loppupvm = kausi?.loppupvm ?? tosite.pvm;
        if (uusiRaja === null || loppupvm > uusiRaja) uusiRaja = loppupvm;
      }
      await client.paivitaAsetukset({ AlvIlmoitettu: uusiRaja });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['init'] });
      void qc.invalidateQueries({ queryKey: ['tositteet'] });
      void qc.invalidateQueries({ queryKey: ['saldot'] });
      void qc.invalidateQueries({ queryKey: ['alvLaskelma'] });
      void qc.invalidateQueries({ queryKey: ['alvErittely'] });
      void qc.invalidateQueries({ queryKey: ['euMyynti'] });
      // poistaTosite(id) poistaa itse ALVLASKELMA-tositteen (ei koske marginaaliesikirjausta,
      // ks. yllä) — ei postaa tulo-/menotiliä sekään, mutta jokainen muu mutaatio invalidoi
      // Tulot/Menot uniformisti nyt, joten tämäkin tekee samoin ilman poikkeusta muistaa.
      void qc.invalidateQueries({ queryKey: ['tulot'] });
      void qc.invalidateQueries({ queryKey: ['menot'] });
    },
  });

  async function poista(id: number): Promise<boolean> {
    setVirheviesti(null);
    try {
      await mutaatio.mutateAsync(id);
      return true;
    } catch (e) {
      setVirheviesti(alvVirheViesti(e));
      return false;
    }
  }

  return { poista, virheviesti, poistaa: mutaatio.isPending };
}

/** Tilinpäätöstoimintojen virhekartta: ResourceError.code → suomi (koodi-virhebody takaa
 *  identtiset koodit molemmilla transporteilla). */
export function tilinpaatosVirheViesti(e: unknown): string {
  if (e instanceof ResourceError) {
    switch (e.code) {
      case 'EIPAATETTY':
        return 'Tilikausi on lukittava ennen vahvistusta.';
      case 'JOVAHVISTETTU':
        return 'Tilinpäätös on jo vahvistettu.';
      case 'JOLUKITTU':
        return 'Tilikausi on jo lukittu.';
      case 'JOAUKI':
        return 'Tilikausi on jo auki.';
      case 'EDELLINENAUKI':
        return 'Aiempi tilikausi on vielä auki.';
      case 'SEURAAVALUKITTU':
        return 'Myöhempi tilikausi on lukittu.';
      case 'VAHVISTETTU':
        return 'Vahvistettua tilikautta ei voi avata (peru vahvistus ensin).';
      case 'EITILIKAUTTA':
        return 'Tilikautta ei löytynyt.';
      case 'EIRAPORTTIA':
        return 'Tilinpäätöskaavaa ei löytynyt.';
      default:
        return `Toiminto epäonnistui (${e.code}).`;
    }
  }
  return 'Toiminto epäonnistui.';
}

export function useTilinpaatos(params: TilinpaatosParams, enabled = true) {
  const client = useKpClient();
  return useQuery<TilinpaatosDoc>({
    queryKey: avaimet.tilinpaatos(params),
    queryFn: () => client.haeTilinpaatos(params),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useTallennaLiitetiedot() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);
  const mutaatio = useMutation<void, unknown, LiitetiedotSyote>({
    mutationFn: (s) => client.tallennaLiitetiedot(s),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tilinpaatos'] });
    },
  });
  async function tallenna(s: LiitetiedotSyote): Promise<boolean> {
    setVirheviesti(null);
    try {
      await mutaatio.mutateAsync(s);
      return true;
    } catch (e) {
      setVirheviesti(tilinpaatosVirheViesti(e));
      return false;
    }
  }
  return { tallenna, virheviesti, tallentaa: mutaatio.isPending };
}

export function useVahvistaTilinpaatos() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);
  const mutaatio = useMutation<void, unknown, VahvistusSyote>({
    mutationFn: (s) => client.vahvistaTilinpaatos(s),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tilinpaatos'] });
    },
  });
  async function vahvista(s: VahvistusSyote): Promise<boolean> {
    setVirheviesti(null);
    try {
      await mutaatio.mutateAsync(s);
      return true;
    } catch (e) {
      setVirheviesti(tilinpaatosVirheViesti(e));
      return false;
    }
  }
  return { vahvista, virheviesti, vahvistaa: mutaatio.isPending };
}

export function usePeruVahvistus() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);
  const mutaatio = useMutation<void, unknown, VahvistusSyote>({
    mutationFn: (s) => client.peruVahvistus(s),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tilinpaatos'] });
    },
  });
  async function peru(s: VahvistusSyote): Promise<boolean> {
    setVirheviesti(null);
    try {
      await mutaatio.mutateAsync(s);
      return true;
    } catch (e) {
      setVirheviesti(tilinpaatosVirheViesti(e));
      return false;
    }
  }
  return { peru, virheviesti, peruu: mutaatio.isPending };
}

export function usePaataTilikausi() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);
  const mutaatio = useMutation<void, unknown, IsoDate>({
    mutationFn: (alkaa) => client.paataTilikausi(alkaa),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['init'] });
      void qc.invalidateQueries({ queryKey: ['tilinpaatos'] });
      void qc.invalidateQueries({ queryKey: ['saldot'] });
    },
  });
  async function lukitse(alkaa: IsoDate): Promise<boolean> {
    setVirheviesti(null);
    try {
      await mutaatio.mutateAsync(alkaa);
      return true;
    } catch (e) {
      setVirheviesti(tilinpaatosVirheViesti(e));
      return false;
    }
  }
  return { lukitse, virheviesti, lukitsee: mutaatio.isPending };
}

export function useAvaaTilikausi() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);
  const mutaatio = useMutation<void, unknown, IsoDate>({
    mutationFn: (alkaa) => client.avaaTilikausi(alkaa),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['init'] });
      void qc.invalidateQueries({ queryKey: ['tilinpaatos'] });
      void qc.invalidateQueries({ queryKey: ['saldot'] });
    },
  });
  async function avaa(alkaa: IsoDate): Promise<boolean> {
    setVirheviesti(null);
    try {
      await mutaatio.mutateAsync(alkaa);
      return true;
    } catch (e) {
      setVirheviesti(tilinpaatosVirheViesti(e));
      return false;
    }
  }
  return { avaa, virheviesti, avataan: mutaatio.isPending };
}
