import {
  decodeAlvTilitysSyote,
  decodeHyvityslaskuSyote,
  decodeJaksotuksetSyote,
  decodeKumppani,
  decodeLiite,
  decodeLiitetiedotSyote,
  decodeMarginaaliveroSyote,
  decodeMyyntilaskuSyote,
  decodeOstolaskuSyote,
  decodePoistotSyote,
  decodeSuoritusSyote,
  decodeTili,
  decodeTilikausi,
  decodeTilinavausSyote,
  decodeTosite,
  decodeTuloveroSyote,
  decodeVahvistusSyote,
  decodeVanhennusSyote,
  encodeAlvErittely,
  encodeAlvIlmoitus,
  encodeAlvLaskelma,
  encodeEuMyynti,
  encodeInit,
  encodeJaksotuslaskelma,
  encodeKumppani,
  encodeLiite,
  encodeLiiteMeta,
  encodeListattuTosite,
  encodeMyyntilaskuRivi,
  encodeOstolaskuRivi,
  encodePoistolaskelma,
  encodeRahavirtaRivi,
  encodeRaporttiRivi,
  encodeSaldot,
  encodeTilikausi,
  encodeTilinpaatosDoc,
  encodeTosite,
  encodeVerolaskelma,
  encodeVienti,
} from '@penni/contract';
import type {
  WireAlvTilitysSyote,
  WireHyvityslaskuSyote,
  WireMarginaaliveroSyote,
  WireMyyntilaskuSyote,
  WireOstolaskuSyote,
  WireSuoritusSyote,
  WireTilinavausSyote,
  WireTosite,
  WireTuloveroSyote,
  WireVanhennusSyote,
} from '@penni/contract';
import {
  type Asetukset,
  type ResourceEnv,
  ResourceError,
  type Storage,
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
import {
  alvLaskelmaParametrit,
  jaksotuksetParametrit,
  myyntilaskuSuodatin,
  ostolaskuSuodatin,
  poistotParametrit,
  rahavirtaSuodatin,
  raporttiParametrit,
  saldotParametrit,
  tositeSuodatin,
  verolaskelmaParametrit,
  viennitSuodatin,
} from './pyynnot.js';
import { tunnistusALS } from './tunnistusKonteksti.js';

/**
 * The contract route implementations. Pure binding: decode wire -> call engine handler -> encode.
 * Engine handlers throw ResourceError on rejection; those propagate to the Fastify error handler
 * (palvelin.ts), so handlers here only ever return the contract's declared success statuses.
 * `kello` supplies the per-request timestamp (the engine is clock-free).
 */
export function luoKasittelijat(storage: Storage, kello: () => string) {
  const env = (): ResourceEnv => {
    const userId = tunnistusALS.getStore()?.userId;
    return { aika: kello(), ...(userId !== undefined ? { userId } : {}) };
  };

  return {
    haeInit: async () => ({ status: 200 as const, body: encodeInit(await haeInit(storage)) }),

    paivitaInit: async ({
      body,
    }: { body: { asetukset?: Record<string, string>; tilit?: unknown[] } }) => {
      await paivitaInit(storage, {
        ...(body.asetukset ? { asetukset: body.asetukset } : {}),
        ...(body.tilit
          ? { tilit: body.tilit.map((t) => decodeTili(t as Record<string, unknown>)) }
          : {}),
      });
      return { status: 200 as const, body: null };
    },

    listaaTositteet: async ({ query }: { query: Record<string, string | undefined> }) => ({
      status: 200 as const,
      body: (await listaaTositteet(storage, tositeSuodatin(query))).map(encodeListattuTosite),
    }),

    haeTosite: async ({ params }: { params: { id: string } }) => {
      const t = await haeTosite(storage, Number(params.id));
      if (!t) throw new ResourceError('EITOSITETTA', `Tositetta ${params.id} ei ole`);
      return { status: 200 as const, body: encodeTosite(t) };
    },

    luoTosite: async ({ body }: { body: WireTosite }) => ({
      status: 201 as const,
      body: encodeTosite(await tallennaTosite(storage, decodeTosite(body), env())),
    }),

    paivitaTosite: async ({ params, body }: { params: { id: string }; body: WireTosite }) => {
      // Langalla puuttuva tunniste (encodeTosite pudottaa nollan) tarkoittaa "säilytä numero".
      // decodeTosite täyttäisi sen nollaksi, jolloin moottori numeroisi kirjatun tositteen
      // uudelleen ja numerointiin jäisi aukko — samoin kuin in-process-polun paivitysSyote.
      const { tunniste, ...muut } = decodeTosite(body);
      const syote = body.tunniste == null ? muut : { ...muut, tunniste };
      return {
        status: 200 as const,
        body: encodeTosite(
          await tallennaTosite(storage, { ...syote, id: Number(params.id) }, env()),
        ),
      };
    },

    muutaTila: async ({ params, body }: { params: { id: string }; body: { tila: number } }) => {
      await muutaTositteenTila(storage, Number(params.id), body.tila, env());
      return { status: 200 as const, body: null };
    },

    poistaTosite: async ({ params }: { params: { id: string } }) => {
      await poistaTosite(storage, Number(params.id), env());
      return { status: 200 as const, body: null };
    },

    luoMyyntilasku: async ({ body }: { body: WireMyyntilaskuSyote }) => ({
      status: 201 as const,
      body: encodeTosite(await tallennaMyyntilasku(storage, decodeMyyntilaskuSyote(body), env())),
    }),

    listaaMyyntilaskut: async ({ query }: { query: Record<string, string | undefined> }) => ({
      status: 200 as const,
      body: (await listaaMyyntilaskut(storage, myyntilaskuSuodatin(query))).map(
        encodeMyyntilaskuRivi,
      ),
    }),

    listaaTulot: async ({ query }: { query: Record<string, string | undefined> }) => ({
      status: 200 as const,
      body: (await listaaTulot(storage, rahavirtaSuodatin(query))).map(encodeRahavirtaRivi),
    }),

    listaaMenot: async ({ query }: { query: Record<string, string | undefined> }) => ({
      status: 200 as const,
      body: (await listaaMenot(storage, rahavirtaSuodatin(query))).map(encodeRahavirtaRivi),
    }),

    tallennaOstolasku: async ({ body }: { body: WireOstolaskuSyote }) => ({
      status: 200 as const,
      body: encodeTosite(await tallennaOstolasku(storage, decodeOstolaskuSyote(body), env())),
    }),

    listaaOstolaskut: async ({ query }: { query: Record<string, string | undefined> }) => ({
      status: 200 as const,
      body: (await listaaOstolaskut(storage, ostolaskuSuodatin(query))).map(encodeOstolaskuRivi),
    }),

    tallennaHyvityslasku: async ({ body }: { body: WireHyvityslaskuSyote }) => ({
      status: 200 as const,
      body: encodeTosite(await tallennaHyvityslasku(storage, decodeHyvityslaskuSyote(body), env())),
    }),

    luoSuoritus: async ({ body }: { body: WireSuoritusSyote }) => ({
      status: 201 as const,
      body: encodeTosite(await tallennaSuoritus(storage, decodeSuoritusSyote(body), env())),
    }),

    paataTilikausi: async ({ params }: { params: { alkaa: string } }) => {
      await paataTilikausi(storage, params.alkaa);
      return { status: 200 as const, body: null };
    },

    avaaTilikausi: async ({ params }: { params: { alkaa: string } }) => {
      await avaaTilikausi(storage, params.alkaa);
      return { status: 200 as const, body: null };
    },

    luoTilinavaus: async ({ body }: { body: WireTilinavausSyote }) => ({
      status: 201 as const,
      body: encodeTosite(await luoTilinavaus(storage, decodeTilinavausSyote(body), env())),
    }),

    haeAlvLaskelma: async ({ query }: { query: { alkupvm: string; loppupvm: string } }) => ({
      status: 200 as const,
      body: encodeAlvLaskelma(await haeAlvLaskelma(storage, alvLaskelmaParametrit(query))),
    }),

    haeAlvErittely: async ({ query }: { query: { alkupvm: string; loppupvm: string } }) => ({
      status: 200 as const,
      body: encodeAlvErittely(await haeAlvErittely(storage, alvLaskelmaParametrit(query))),
    }),

    tallennaAlvTilitys: async ({ body }: { body: WireAlvTilitysSyote }) => ({
      status: 201 as const,
      body: encodeTosite(await tallennaAlvTilitys(storage, decodeAlvTilitysSyote(body), env())),
    }),

    haeAlvIlmoitus: async ({ query }: { query: { alkupvm: string; loppupvm: string } }) => ({
      status: 200 as const,
      body: encodeAlvIlmoitus(await haeAlvIlmoitus(storage, alvLaskelmaParametrit(query))),
    }),

    haeEuMyyntiYhteenveto: async ({ query }: { query: { alkupvm: string; loppupvm: string } }) => ({
      status: 200 as const,
      body: encodeEuMyynti(await haeEuMyyntiYhteenveto(storage, alvLaskelmaParametrit(query))),
    }),

    haeVerolaskelma: async ({
      query,
    }: { query: { alkupvm: string; loppupvm: string; aiempiTappio?: string } }) => ({
      status: 200 as const,
      body: encodeVerolaskelma(await haeVerolaskelma(storage, verolaskelmaParametrit(query))),
    }),

    tallennaTulovero: async ({ body }: { body: WireTuloveroSyote }) => ({
      status: 200 as const,
      body: encodeTosite(await tallennaTulovero(storage, decodeTuloveroSyote(body), env())),
    }),

    haePoistolaskelma: async ({ query }: { query: { loppupvm: string } }) => ({
      status: 200 as const,
      body: encodePoistolaskelma(await haePoistolaskelma(storage, poistotParametrit(query))),
    }),

    tallennaPoistot: async ({ body }: { body: { loppupvm: string } }) => ({
      status: 200 as const,
      body: encodeTosite(await tallennaPoistot(storage, decodePoistotSyote(body), env())),
    }),

    haeJaksotukset: async ({ query }: { query: { loppupvm: string } }) => ({
      status: 200 as const,
      body: encodeJaksotuslaskelma(await haeJaksotukset(storage, jaksotuksetParametrit(query))),
    }),

    tallennaJaksotukset: async ({ body }: { body: { loppupvm: string } }) => ({
      status: 200 as const,
      body: encodeTosite(await tallennaJaksotukset(storage, decodeJaksotuksetSyote(body), env())),
    }),

    tallennaMaksuperusteisenAlvVanhennus: async ({ body }: { body: WireVanhennusSyote }) => {
      const tosite = await vanhennaMaksuperusteinenAlv(storage, decodeVanhennusSyote(body), env());
      return { status: 200 as const, body: tosite ? encodeTosite(tosite) : null };
    },

    kirjaaMarginaalivero: async ({ body }: { body: WireMarginaaliveroSyote }) => {
      const tosite = await kirjaaMarginaalivero(storage, decodeMarginaaliveroSyote(body), env());
      return { status: 200 as const, body: tosite ? encodeTosite(tosite) : null };
    },

    listaaViennit: async ({ query }: { query: Record<string, string | undefined> }) => ({
      status: 200 as const,
      body: (await listaaViennit(storage, viennitSuodatin(query))).map(encodeVienti),
    }),

    haeSaldot: async ({
      query,
    }: { query: Record<string, string | undefined> & { pvm: string } }) => ({
      status: 200 as const,
      body: encodeSaldot(await haeSaldot(storage, env(), saldotParametrit(query))),
    }),

    laadiRaportti: async ({
      query,
    }: {
      query: {
        muoto: string;
        pvm: string;
        alkupvm?: string;
        erittelyt?: string;
        kaikkiRivit?: string;
      };
    }) => ({
      status: 200 as const,
      body: {
        rivit: (await laadiRaportti(storage, env(), raporttiParametrit(query))).map(
          encodeRaporttiRivi,
        ),
      },
    }),

    haeTilinpaatos: async ({
      query,
    }: { query: { alkaa: string; muoto?: 'yleinen' | 'pien' | 'mikro' } }) => ({
      status: 200 as const,
      body: encodeTilinpaatosDoc(
        await laadiTilinpaatos(storage, env(), {
          alkaa: query.alkaa,
          ...(query.muoto ? { muoto: query.muoto } : {}),
        }),
      ),
    }),

    tallennaLiitetiedot: async ({ body }: { body: { loppupvm: string; teksti: string } }) => {
      await tallennaLiitetiedot(storage, decodeLiitetiedotSyote(body));
      return { status: 200 as const, body: null };
    },

    vahvistaTilinpaatos: async ({ body }: { body: { alkaa: string } }) => {
      await vahvistaTilinpaatos(storage, decodeVahvistusSyote(body), env());
      return { status: 200 as const, body: null };
    },

    peruVahvistus: async ({ body }: { body: { alkaa: string } }) => {
      await peruVahvistus(storage, decodeVahvistusSyote(body));
      return { status: 200 as const, body: null };
    },

    haeTilikaudet: async () => ({
      status: 200 as const,
      body: (await haeTilikaudet(storage)).map(encodeTilikausi),
    }),

    tallennaTilikausi: async ({
      params,
      body,
    }: { params: { alkaa: string }; body: Record<string, unknown> }) => {
      await putTilikausi(storage, params.alkaa, decodeTilikausi(body));
      return { status: 200 as const, body: null };
    },

    poistaTilikausi: async ({ params }: { params: { alkaa: string } }) => {
      await poistaTilikausi(storage, params.alkaa);
      return { status: 200 as const, body: null };
    },

    tallennaTili: async ({
      params,
      body,
    }: { params: { numero: string }; body: Record<string, unknown> }) => {
      await putTili(storage, Number(params.numero), decodeTili(body));
      return { status: 200 as const, body: null };
    },

    tallennaOtsikko: async ({
      params,
      body,
    }: { params: { numero: string; taso: string }; body: Record<string, unknown> }) => {
      await putTili(storage, Number(params.numero), {
        ...decodeTili(body),
        tyyppi: `H${params.taso}`,
      });
      return { status: 200 as const, body: null };
    },

    poistaTili: async ({ params }: { params: { numero: string } }) => {
      await poistaTili(storage, Number(params.numero));
      return { status: 200 as const, body: null };
    },

    poistaOtsikko: async ({ params }: { params: { numero: string; taso: string } }) => {
      await poistaTili(storage, Number(params.numero), Number(params.taso));
      return { status: 200 as const, body: null };
    },

    haeKumppanit: async () => ({
      status: 200 as const,
      body: (await haeKumppanit(storage)).map(encodeKumppani),
    }),

    tallennaKumppani: async ({ body }: { body: Record<string, unknown> }) => {
      const tallennettu = await tallennaKumppani(storage, decodeKumppani(body));
      return { status: 200 as const, body: encodeKumppani(tallennettu) };
    },

    poistaKumppani: async ({ params }: { params: { id: string } }) => {
      await poistaKumppani(storage, Number(params.id));
      return { status: 200 as const, body: null };
    },

    haeLiitteet: async ({ params }: { params: { tosite: string } }) => ({
      status: 200 as const,
      body: (await haeLiitteet(storage, Number(params.tosite))).map(encodeLiiteMeta),
    }),

    haeLiite: async ({ params }: { params: { id: string } }) => {
      const liite = await haeLiite(storage, Number(params.id));
      if (!liite) return { status: 404 as const, body: null };
      return { status: 200 as const, body: encodeLiite(liite) };
    },

    tallennaLiite: async ({ body }: { body: Record<string, unknown> }) => {
      const decoded = decodeLiite(body);
      // Uusi liite: pudota id kun wire ei sitä sisällä (sama kuvio kuin kumppanilla),
      // jotta tallennaLiite antaa uuden tunnisteen / tekee rooliupsertin.
      const { id: _drop, ...ilmanId } = decoded;
      const syote = body.id != null ? decoded : ilmanId;
      const tallennettu = await tallennaLiite(storage, syote);
      return { status: 200 as const, body: encodeLiiteMeta(tallennettu) };
    },

    lisaaLiite: async ({
      params,
      body,
    }: { params: { tosite: string }; body: Record<string, unknown> }) => {
      // Aina uusi liite polun tositteelle; engine ohittaa id:n ja roolinimen.
      const tallennettu = await lisaaLiite(
        storage,
        { ...decodeLiite(body), tosite: Number(params.tosite) },
        env(),
      );
      return { status: 200 as const, body: encodeLiiteMeta(tallennettu) };
    },

    poistaLiite: async ({ params }: { params: { id: string } }) => {
      await poistaLiite(storage, Number(params.id));
      return { status: 200 as const, body: null };
    },

    haeAsetukset: async () => ({ status: 200 as const, body: await haeAsetukset(storage) }),

    paivitaAsetukset: async ({ body }: { body: Record<string, string | null> }) => {
      // The wire patch allows null (delete); the engine port types Asetukset as Record<string,string>,
      // but storage.patchAsetukset handles null/undefined as a key delete (pre-existing port looseness).
      await paivitaAsetukset(storage, body as Asetukset);
      return { status: 200 as const, body: null };
    },
  };
}
