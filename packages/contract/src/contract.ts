import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import {
  WireAlvErittelySchema,
  WireAlvIlmoitusSchema,
  WireAlvLaskelmaSchema,
  WireAlvTilitysSyoteSchema,
  WireAsetuksetPatchSchema,
  WireAsetuksetSchema,
  WireEuMyyntiSchema,
  WireHyvityslaskuSyoteSchema,
  WireInitPatchSchema,
  WireInitSchema,
  WireJaksotuksetSyoteSchema,
  WireJaksotuslaskelmaSchema,
  WireKumppaniSchema,
  WireLiiteMetaSchema,
  WireLiiteSchema,
  WireLiitetiedotSyoteSchema,
  WireMarginaaliveroSyoteSchema,
  WireMyyntilaskuRiviSchema,
  WireMyyntilaskuSyoteSchema,
  WireOstolaskuRiviSchema,
  WireOstolaskuSyoteSchema,
  WirePoistolaskelmaSchema,
  WirePoistotSyoteSchema,
  WireRahavirtaRiviSchema,
  WireRaporttiRiviSchema,
  WireSaldotSchema,
  WireSuoritusSyoteSchema,
  WireTiliSchema,
  WireTilikausiSchema,
  WireTilinavausSyoteSchema,
  WireTilinpaatosDocSchema,
  WireTositeSchema,
  WireTositeSyoteSchema,
  WireTuloveroSyoteSchema,
  WireVahvistusSyoteSchema,
  WireVanhennusSyoteSchema,
  WireVerolaskelmaSchema,
  WireVientiSchema,
  WireVirheSchema,
} from './schema/wire.js';

const c = initContract();

const TositeListQuery = z.object({
  bucket: z.string().optional(),
  alkupvm: z.string().optional(),
  loppupvm: z.string().optional(),
  pvm: z.string().optional(),
  kumppani: z.string().optional(),
  tyyppi: z.string().optional(),
  viite: z.string().optional(),
});

const MyyntilaskuListQuery = z.object({
  alkupvm: z.string().optional(),
  loppupvm: z.string().optional(),
  eraalkupvm: z.string().optional(),
  eraloppupvm: z.string().optional(),
  avoin: z.string().optional(),
  eraantynyt: z.string().optional(),
  saldopvm: z.string().optional(),
});

const RahavirtaListQuery = z.object({
  bucket: z.string().optional(),
  alkupvm: z.string().optional(),
  loppupvm: z.string().optional(),
  kumppani: z.string().optional(),
  avoin: z.string().optional(),
  eraantynyt: z.string().optional(),
  saldopvm: z.string().optional(),
});

const OstolaskuListQuery = z.object({
  alkupvm: z.string().optional(),
  loppupvm: z.string().optional(),
  eraalkupvm: z.string().optional(),
  eraloppupvm: z.string().optional(),
  avoin: z.string().optional(),
  eraantynyt: z.string().optional(),
  saldopvm: z.string().optional(),
});

const ViennitQuery = z.object({
  alkupvm: z.string().optional(),
  loppupvm: z.string().optional(),
  tili: z.string().optional(),
});

const SaldotQuery = z.object({
  pvm: z.string(),
  alkupvm: z.string().optional(),
  tase: z.string().optional(),
  tuloslaskelma: z.string().optional(),
  tili: z.string().optional(),
  kohdennus: z.string().optional(),
  alkusaldot: z.string().optional(),
});

const RaporttiQuery = z.object({
  muoto: z.string(),
  pvm: z.string(),
  alkupvm: z.string().optional(),
  erittelyt: z.string().optional(),
  kaikkiRivit: z.string().optional(),
});

const AlvLaskelmaQuery = z.object({
  alkupvm: z.string(),
  loppupvm: z.string(),
});

const VerolaskelmaQuery = z.object({
  alkupvm: z.string(),
  loppupvm: z.string(),
  aiempiTappio: z.string().optional(),
});

const PoistotQuery = z.object({
  loppupvm: z.string(),
});

const JaksotuksetQuery = z.object({ loppupvm: z.string() });

const TilinpaatosQuery = z.object({
  alkaa: z.string(),
  muoto: z.enum(['yleinen', 'pien', 'mikro']).optional(),
});

export const contract = c.router({
  // /init
  haeInit: { method: 'GET', path: '/init', responses: { 200: WireInitSchema } },
  paivitaInit: {
    method: 'PATCH',
    path: '/init',
    body: WireInitPatchSchema,
    responses: { 200: z.null() },
  },

  // /tositteet
  listaaTositteet: {
    method: 'GET',
    path: '/tositteet',
    query: TositeListQuery,
    responses: { 200: z.array(WireTositeSchema) },
  },
  haeTosite: {
    method: 'GET',
    path: '/tositteet/:id',
    responses: { 200: WireTositeSchema, 404: WireVirheSchema },
  },
  luoTosite: {
    method: 'POST',
    path: '/tositteet',
    body: WireTositeSyoteSchema,
    responses: { 200: WireTositeSchema, 201: WireTositeSchema },
  },
  paivitaTosite: {
    method: 'PUT',
    path: '/tositteet/:id',
    body: WireTositeSyoteSchema,
    responses: { 200: WireTositeSchema },
  },
  muutaTila: {
    method: 'PATCH',
    path: '/tositteet/:id',
    body: z.object({ tila: z.number() }).passthrough(),
    responses: { 200: z.null() },
  },
  poistaTosite: { method: 'DELETE', path: '/tositteet/:id', responses: { 200: z.null() } },
  luoMyyntilasku: {
    method: 'POST',
    path: '/myyntilaskut',
    body: WireMyyntilaskuSyoteSchema,
    responses: { 200: WireTositeSchema, 201: WireTositeSchema },
  },
  listaaMyyntilaskut: {
    method: 'GET',
    path: '/myyntilaskut',
    query: MyyntilaskuListQuery,
    responses: { 200: z.array(WireMyyntilaskuRiviSchema) },
  },

  // Penni-laajennus (ei Kitsas-vastinetta): kaikki tulot/menot tilin luonteen perusteella.
  listaaTulot: {
    method: 'GET',
    path: '/tulot',
    query: RahavirtaListQuery,
    responses: { 200: z.array(WireRahavirtaRiviSchema) },
  },
  listaaMenot: {
    method: 'GET',
    path: '/menot',
    query: RahavirtaListQuery,
    responses: { 200: z.array(WireRahavirtaRiviSchema) },
  },

  luoSuoritus: {
    method: 'POST',
    path: '/suoritukset',
    body: WireSuoritusSyoteSchema,
    responses: { 200: WireTositeSchema, 201: WireTositeSchema },
  },
  tallennaOstolasku: {
    method: 'POST',
    path: '/ostolaskut',
    body: WireOstolaskuSyoteSchema,
    responses: { 200: WireTositeSchema, 201: WireTositeSchema },
  },
  listaaOstolaskut: {
    method: 'GET',
    path: '/ostolaskut',
    query: OstolaskuListQuery,
    responses: { 200: z.array(WireOstolaskuRiviSchema) },
  },
  tallennaHyvityslasku: {
    method: 'POST',
    path: '/hyvityslaskut',
    body: WireHyvityslaskuSyoteSchema,
    responses: { 200: WireTositeSchema, 201: WireTositeSchema },
  },

  // /alv (Penni-spesifinen: laskelma oli legacy-Kitsaassa asiakaspuolen koodia)
  haeAlvLaskelma: {
    method: 'GET',
    path: '/alv',
    query: AlvLaskelmaQuery,
    responses: { 200: WireAlvLaskelmaSchema },
  },
  haeAlvErittely: {
    method: 'GET',
    path: '/alv/erittely',
    query: AlvLaskelmaQuery,
    responses: { 200: WireAlvErittelySchema },
  },
  tallennaAlvTilitys: {
    method: 'POST',
    path: '/alv/tilitys',
    body: WireAlvTilitysSyoteSchema,
    responses: { 200: WireTositeSchema, 201: WireTositeSchema },
  },
  haeAlvIlmoitus: {
    method: 'GET',
    path: '/alv/ilmoitus',
    query: AlvLaskelmaQuery,
    responses: { 200: WireAlvIlmoitusSchema },
  },
  haeEuMyyntiYhteenveto: {
    method: 'GET',
    path: '/alv/eumyynti',
    query: AlvLaskelmaQuery,
    responses: { 200: WireEuMyyntiSchema },
  },
  haeVerolaskelma: {
    method: 'GET',
    path: '/tulovero',
    query: VerolaskelmaQuery,
    responses: { 200: WireVerolaskelmaSchema },
  },
  tallennaTulovero: {
    method: 'POST',
    path: '/tulovero',
    body: WireTuloveroSyoteSchema,
    responses: { 200: WireTositeSchema, 201: WireTositeSchema },
  },
  haePoistolaskelma: {
    method: 'GET',
    path: '/poistot',
    query: PoistotQuery,
    responses: { 200: WirePoistolaskelmaSchema },
  },
  tallennaPoistot: {
    method: 'POST',
    path: '/poistot',
    body: WirePoistotSyoteSchema,
    responses: { 200: WireTositeSchema, 201: WireTositeSchema },
  },
  haeJaksotukset: {
    method: 'GET',
    path: '/jaksotukset',
    query: JaksotuksetQuery,
    responses: { 200: WireJaksotuslaskelmaSchema },
  },
  tallennaJaksotukset: {
    method: 'POST',
    path: '/jaksotukset',
    body: WireJaksotuksetSyoteSchema,
    responses: { 200: WireTositeSchema, 201: WireTositeSchema },
  },
  tallennaMaksuperusteisenAlvVanhennus: {
    method: 'POST',
    path: '/maksuperusteisen-alv-vanhennus',
    body: WireVanhennusSyoteSchema,
    responses: {
      200: WireTositeSchema.nullable(),
    },
  },
  kirjaaMarginaalivero: {
    method: 'POST',
    path: '/marginaalivero',
    body: WireMarginaaliveroSyoteSchema,
    responses: {
      200: WireTositeSchema.nullable(),
    },
  },

  // /viennit
  listaaViennit: {
    method: 'GET',
    path: '/viennit',
    query: ViennitQuery,
    responses: { 200: z.array(WireVientiSchema) },
  },

  // /saldot
  haeSaldot: {
    method: 'GET',
    path: '/saldot',
    query: SaldotQuery,
    responses: { 200: WireSaldotSchema },
  },

  // /raportit (Penni-specific: reports were client-side in legacy Kitsas)
  laadiRaportti: {
    method: 'GET',
    path: '/raportit',
    query: RaporttiQuery,
    responses: {
      200: z.object({ rivit: z.array(WireRaporttiRiviSchema) }),
      404: WireVirheSchema,
    },
  },

  // /tilikaudet
  haeTilikaudet: {
    method: 'GET',
    path: '/tilikaudet',
    responses: { 200: z.array(WireTilikausiSchema) },
  },
  tallennaTilikausi: {
    method: 'PUT',
    path: '/tilikaudet/:alkaa',
    body: WireTilikausiSchema,
    responses: { 200: z.null() },
  },
  poistaTilikausi: { method: 'DELETE', path: '/tilikaudet/:alkaa', responses: { 200: z.null() } },
  paataTilikausi: {
    method: 'POST',
    path: '/tilikaudet/:alkaa/lukitus',
    body: z.object({}).passthrough(),
    responses: { 200: z.null() },
  },
  avaaTilikausi: {
    method: 'DELETE',
    path: '/tilikaudet/:alkaa/lukitus',
    responses: { 200: z.null() },
  },
  luoTilinavaus: {
    method: 'POST',
    path: '/tilinavaus',
    body: WireTilinavausSyoteSchema,
    responses: { 200: WireTositeSchema, 201: WireTositeSchema },
  },

  // /tilit
  tallennaTili: {
    method: 'PUT',
    path: '/tilit/:numero',
    body: WireTiliSchema,
    responses: { 200: z.null() },
  },
  tallennaOtsikko: {
    method: 'PUT',
    path: '/tilit/:numero/:taso',
    body: WireTiliSchema,
    responses: { 200: z.null() },
  },
  poistaTili: { method: 'DELETE', path: '/tilit/:numero', responses: { 200: z.null() } },
  poistaOtsikko: { method: 'DELETE', path: '/tilit/:numero/:taso', responses: { 200: z.null() } },

  // /kumppanit
  haeKumppanit: {
    method: 'GET',
    path: '/kumppanit',
    responses: { 200: z.array(WireKumppaniSchema) },
  },
  tallennaKumppani: {
    method: 'POST',
    path: '/kumppanit',
    body: WireKumppaniSchema,
    responses: { 200: WireKumppaniSchema, 201: WireKumppaniSchema },
  },
  poistaKumppani: { method: 'DELETE', path: '/kumppanit/:id', responses: { 200: z.null() } },

  // /liitteet
  haeLiitteet: {
    method: 'GET',
    path: '/tositteet/:tosite/liitteet',
    responses: { 200: z.array(WireLiiteMetaSchema) },
  },
  haeLiite: {
    method: 'GET',
    path: '/liitteet/:id',
    responses: { 200: WireLiiteSchema, 404: z.null() },
  },
  tallennaLiite: {
    method: 'POST',
    path: '/liitteet',
    body: WireLiiteSchema,
    responses: { 200: WireLiiteMetaSchema, 201: WireLiiteMetaSchema },
  },
  /** Agenttipolku: lokiin kirjattu lisäys, lukitun kauden tosite hylätään (engine lisaaLiite). */
  lisaaLiite: {
    method: 'POST',
    path: '/tositteet/:tosite/liitteet',
    body: WireLiiteSchema,
    responses: { 200: WireLiiteMetaSchema },
  },
  poistaLiite: { method: 'DELETE', path: '/liitteet/:id', responses: { 200: z.null() } },

  // /asetukset
  haeAsetukset: { method: 'GET', path: '/asetukset', responses: { 200: WireAsetuksetSchema } },
  paivitaAsetukset: {
    method: 'PATCH',
    path: '/asetukset',
    body: WireAsetuksetPatchSchema,
    responses: { 200: z.null() },
  },

  // /tilinpaatos (Penni-specific: financial statements were client-side in legacy Kitsas)
  haeTilinpaatos: {
    method: 'GET',
    path: '/tilinpaatos',
    query: TilinpaatosQuery,
    responses: { 200: WireTilinpaatosDocSchema },
  },
  tallennaLiitetiedot: {
    method: 'POST',
    path: '/liitetiedot',
    body: WireLiitetiedotSyoteSchema,
    responses: { 200: z.null() },
  },
  vahvistaTilinpaatos: {
    method: 'POST',
    path: '/tilinpaatos/vahvista',
    body: WireVahvistusSyoteSchema,
    responses: { 200: z.null() },
  },
  peruVahvistus: {
    method: 'POST',
    path: '/tilinpaatos/peru',
    body: WireVahvistusSyoteSchema,
    responses: { 200: z.null() },
  },
});
