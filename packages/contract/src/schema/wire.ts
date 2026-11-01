import { z } from 'zod';

/** Money on the wire: canonical "N.NN" string, or a raw number (legacy double). */
const Raha = z.union([z.string(), z.number()]);

export const WireVientiSchema = z
  .object({
    tili: z.number(),
    pvm: z.string(),
    debet: Raha.optional(),
    kredit: Raha.optional(),
    alvkoodi: z.number().optional(),
    alvprosentti: Raha.optional(),
    kohdennus: z.number().optional(),
    merkkaukset: z.array(z.number()).optional(),
    era: z.object({ id: z.number() }).passthrough().optional(),
    selite: z.string().optional(),
    tyyppi: z.number().optional(),
    jaksoalkaa: z.string().optional(),
    jaksoloppuu: z.string().optional(),
    jaksotustili: z.number().optional(),
    maksuperusteinenTosite: z.number().optional(),
  })
  .passthrough();

export const WireRiviSchema = z
  .object({
    myyntikpl: z.number(),
    ahinta: z.number(),
    alvkoodi: z.number().optional(),
    alvprosentti: z.number().optional(),
    aleprosentti: z.number().optional(),
    euroalennus: z.number().optional(),
    unkoodi: z.string().optional(),
    selite: z.string().optional(),
    tili: z.number().optional(),
    kohdennus: z.number().optional(),
    merkkaukset: z.array(z.number()).optional(),
  })
  .passthrough();

export const WireTositeSchema = z
  .object({
    id: z.number().optional(),
    pvm: z.string(),
    tyyppi: z.number().optional(),
    tila: z.number(),
    tunniste: z.number().optional(),
    sarja: z.string().optional(),
    otsikko: z.string().optional(),
    kumppani: z.object({ id: z.number() }).passthrough().optional(),
    viite: z.string().optional(),
    laskupvm: z.string().optional(),
    erapvm: z.string().optional(),
    numero: z.string().optional(),
    maksutapa: z.number().optional(),
    alkuperainenTosite: z.number().optional(),
    marginaalialijaama: z.record(z.string(), z.number()).optional(),
    tiliote: z
      .object({
        tili: z.number(),
        alkupvm: z.string(),
        loppupvm: z.string(),
        iban: z.string().optional(),
        alkusaldo: z.string().optional(),
        loppusaldo: z.string().optional(),
      })
      .passthrough()
      .optional(),
    /** Vain listavastauksessa (GET /tositteet): liitteiden lukumäärä, kuten Kitsasissa. */
    liitteita: z.number().optional(),
    alkupera: z.enum(['kotimaa', 'eu', 'muu']).optional(),
    viennit: z.array(WireVientiSchema),
    rivit: z.array(WireRiviSchema).optional(),
  })
  .passthrough();

/** The write (POST/PUT) body for a voucher: like WireTositeSchema but `tila` is optional
 *  (the engine defaults it to KIRJANPIDOSSA). `.extend` preserves the .passthrough() mode. */
export const WireTositeSyoteSchema = WireTositeSchema.extend({ tila: z.number().optional() });

/** POST /myyntilaskut body: invoice rows + metadata; viennit are generated server-side. */
export const WireMyyntilaskuSyoteSchema = z
  .object({
    pvm: z.string(),
    laskupvm: z.string().optional(),
    erapvm: z.string().optional(),
    kumppani: z.object({ id: z.number() }).passthrough().optional(),
    otsikko: z.string().optional(),
    maksutapa: z.number().optional(),
    sarja: z.string().optional(),
    rivit: z.array(WireRiviSchema),
  })
  .passthrough();

/** One sales-invoice list row. summa/avoin are Raha ("N.NN" | number). */
export const WireMyyntilaskuRiviSchema = z
  .object({
    tosite: z.number(),
    pvm: z.string().optional(),
    erapvm: z.string().optional(),
    viite: z.string().optional(),
    numero: z.string().optional(),
    asiakas: z.string().optional(),
    asiakasId: z.number().optional(),
    summa: Raha,
    avoin: Raha,
    era: z.number().optional(),
    tili: z.number().optional(),
    tyyppi: z.number(),
    tunniste: z.number(),
    sarja: z.string(),
    tila: z.number(),
    maksutapa: z.number().optional(),
  })
  .passthrough();

/** One Tulot/Menot list row. netto/alv/summa/avoin are Raha ("N.NN" | number). */
export const WireRahavirtaRiviSchema = z
  .object({
    tosite: z.number(),
    pvm: z.string(),
    tunniste: z.number(),
    sarja: z.string(),
    tyyppi: z.number(),
    tila: z.number(),
    netto: Raha,
    alv: Raha,
    summa: Raha,
    avoin: Raha,
    liitteita: z.number().optional(),
    alkupera: z.enum(['kotimaa', 'eu', 'muu']).optional(),
    otsikko: z.string().optional(),
    kumppani: z.number().optional(),
    kumppaniNimi: z.string().optional(),
    era: z.number().optional(),
    erapvm: z.string().optional(),
    numero: z.string().optional(),
    viite: z.string().optional(),
    eraKredit: z.boolean().optional(),
  })
  .passthrough();

/** POST /ostolaskut body: expense rows + metadata; viennit are generated server-side. */
export const WireOstolaskuSyoteSchema = z
  .object({
    pvm: z.string(),
    laskupvm: z.string().optional(),
    erapvm: z.string().optional(),
    viite: z.string().optional(),
    kumppani: z.object({ id: z.number() }).passthrough().optional(),
    otsikko: z.string().optional(),
    sarja: z.string().optional(),
    tyyppi: z.number().optional(),
    rivit: z.array(WireRiviSchema),
  })
  .passthrough();

/** One purchase-invoice list row. summa/avoin are Raha ("N.NN" | number). */
export const WireOstolaskuRiviSchema = z
  .object({
    tosite: z.number(),
    pvm: z.string().optional(),
    erapvm: z.string().optional(),
    viite: z.string().optional(),
    summa: Raha,
    avoin: Raha,
    kumppani: z.number().optional(),
    toimittaja: z.string().optional(),
    era: z.number().optional(),
    tili: z.number().optional(),
    tyyppi: z.number(),
    tunniste: z.number(),
    sarja: z.string(),
    tila: z.number(),
  })
  .passthrough();

/** POST /hyvityslaskut body: hyvitys alkuperäiselle tositteelle (käänteiskirjaus). */
export const WireHyvityslaskuSyoteSchema = z
  .object({ alkuperainenTosite: z.number(), pvm: z.string(), otsikko: z.string().optional() })
  .passthrough();

/** POST /suoritukset body: pay an invoice's open item. */
export const WireSuoritusSyoteSchema = z
  .object({
    tosite: z.number(),
    pvm: z.string(),
    summa: Raha,
    rahatili: z.number().optional(),
    otsikko: z.string().optional(),
  })
  .passthrough();

/** Tilinavauksen syöte: kausipäivä + luonnollinen etumerkillinen saldo per tili. */
export const WireTilinavausSyoteSchema = z
  .object({
    pvm: z.string(),
    saldot: z.array(z.object({ tili: z.number(), saldo: Raha }).passthrough()),
  })
  .passthrough();

/** ALV-laskelman vastaus: koodit = ilmoituskoodi (avain merkkijonona) -> Raha. */
export const WireAlvLaskelmaSchema = z
  .object({
    alkupvm: z.string(),
    loppupvm: z.string(),
    koodit: z.record(z.string(), Raha),
    maksettava: Raha,
  })
  .passthrough();

/** ALV-laskelman erittely: kauden alv-koodatut viennit + bruttokirjausten oikaisurivit. */
export const WireAlvErittelySchema = z
  .object({
    alkupvm: z.string(),
    loppupvm: z.string(),
    rivit: z.array(
      z
        .object({
          alvKoodi: z.number(),
          kanta: z.number(),
          tili: z.number(),
          pvm: z.string(),
          tosite: z.number().optional(),
          tositeNumero: z.string(),
          tositePvm: z.string(),
          kumppani: z.string(),
          selite: z.string(),
          summa: Raha,
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** Alv-ilmoituksen tietopaketti (OmaVero-valmis; tarkat sentit). */
export const WireAlvIlmoitusSchema = z
  .object({
    alkupvm: z.string(),
    loppupvm: z.string(),
    kausityyppi: z.string(),
    koodit: z.record(z.string(), Raha),
    maksettava: Raha,
    nolla: z.boolean(),
    maksuperusteinen: z.boolean(),
  })
  .passthrough();

/** Tuloverolaskelman vastaus: kaikki rahat Raha ("N.NN" | number). */
export const WireVerolaskelmaSchema = z
  .object({
    alkupvm: z.string(),
    loppupvm: z.string(),
    tulo: Raha,
    taysivahennys: Raha,
    puolivahennys: Raha,
    vahennys: Raha,
    ennakko: Raha,
    tulos: Raha,
    aiempiTappio: Raha,
    loppuTulos: Raha,
    vero: Raha,
    jaaveroa: Raha,
    joKirjattu: z.boolean(),
  })
  .passthrough();

/** Tuloveron kirjaussyöte: kausi + valinnaiset ohitukset. */
export const WireTuloveroSyoteSchema = z
  .object({
    alkupvm: z.string(),
    loppupvm: z.string(),
    aiempiTappio: Raha.optional(),
    tulo: Raha.optional(),
    taysivahennys: Raha.optional(),
    puolivahennys: Raha.optional(),
    ennakko: Raha.optional(),
  })
  .passthrough();

/** Poistolaskelman vastaus: rivikohtaiset rahat Raha ("N.NN" | number). */
export const WirePoistolaskelmaSchema = z
  .object({
    loppupvm: z.string(),
    rivit: z.array(
      z
        .object({
          tili: z.number(),
          ennen: Raha,
          poisto: Raha,
          poistotili: z.number(),
        })
        .passthrough(),
    ),
    yhteensa: Raha,
    joKirjattu: z.boolean(),
  })
  .passthrough();

export const WireJaksotuslaskelmaSchema = z
  .object({
    loppupvm: z.string(),
    rivit: z.array(
      z
        .object({
          tili: z.number(),
          maara: Raha,
          selite: z.string(),
          kohdennus: z.number().optional(),
          jaksoalkaa: z.string().optional(),
          jaksoloppuu: z.string().optional(),
        })
        .passthrough(),
    ),
    joKirjattu: z.boolean(),
  })
  .passthrough();

export const WireJaksotuksetSyoteSchema = z.object({ loppupvm: z.string() }).passthrough();

/** POST /maksuperusteisen-alv-vanhennus body: pelkkä kauden loppupäivä. */
export const WireVanhennusSyoteSchema = z.object({ loppupvm: z.string() }).passthrough();

/** POST /marginaalivero body: kausi, jolta marginaaliveron kirjaus lasketaan. */
export const WireMarginaaliveroSyoteSchema = z
  .object({ alkupvm: z.string(), loppupvm: z.string() })
  .passthrough();

/** Poistojen kirjaussyöte: pelkkä kauden loppupäivä. */
export const WirePoistotSyoteSchema = z
  .object({
    loppupvm: z.string(),
  })
  .passthrough();

/** Yhteisömyynnin yhteenveto: rivi per kumppani. */
export const WireEuMyyntiSchema = z
  .object({
    alkupvm: z.string(),
    loppupvm: z.string(),
    rivit: z.array(
      z
        .object({
          kumppani: z.number(),
          nimi: z.string(),
          alvtunnus: z.string().optional(),
          maa: z.string().optional(),
          tavara: Raha,
          palvelu: Raha,
        })
        .passthrough(),
    ),
    puuttuviaTunnuksia: z.boolean(),
  })
  .passthrough();

/** ALV-tilityksen syöte: pelkkä kausi. */
export const WireAlvTilitysSyoteSchema = z
  .object({
    alkupvm: z.string(),
    loppupvm: z.string(),
  })
  .passthrough();

export const WireTiliSchema = z
  .object({
    numero: z.union([z.number(), z.string()]),
    tyyppi: z.string().optional(),
    nimi: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  })
  .passthrough();

export const WireTilikausiSchema = z
  .object({ alkaa: z.string(), loppuu: z.string() })
  .passthrough();

export const WireKumppaniSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    nimi: z.string(),
  })
  .passthrough();

/** Kohdennus (kustannuspaikka, projekti tai merkkaus); `lkm` vain GET /kohdennukset -vastauksessa. */
export const WireKohdennusSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    tyyppi: z.number(),
    kuuluu: z.number().optional(),
    nimi: z.record(z.string(), z.string()),
    alkaa: z.string().optional(),
    paattyy: z.string().optional(),
    lkm: z.number().optional(),
  })
  .passthrough();

/** Budjettirivi: sentit rahamerkkijonona (tulot +, menot −). */
export const WireBudjettiRiviSchema = z.object({
  kohdennus: z.number(),
  tili: z.number(),
  sentit: z.string(),
});

export const WireLiiteMetaSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    tosite: z.union([z.number(), z.string()]),
    nimi: z.string(),
    roolinimi: z.string().optional(),
    tyyppi: z.string(),
    sha: z.string().optional(),
    luotu: z.string(),
  })
  .passthrough();

export const WireLiiteSchema = WireLiiteMetaSchema.extend({ data: z.string() });

export const WireAsetuksetSchema = z.record(z.string(), z.string());
export const WireAsetuksetPatchSchema = z.record(z.string(), z.union([z.string(), z.null()]));

export const WireSaldotSchema = z.record(z.string(), z.union([z.string(), z.number()]));

/**
 * One rendered report row on the wire. `arvo` = canonical "N.NN" money or null (title/spacer);
 * `tili` = account number on a per-account detail row (erittely);
 * `kaavarivi` = index of the producing layout row (erittelyrivillä emorivin).
 */
export const WireRaporttiRiviSchema = z.object({
  teksti: z.string(),
  sisennys: z.number(),
  lihava: z.boolean(),
  arvo: z.union([z.string(), z.null()]),
  tyhja: z.boolean().optional(),
  tili: z.number().int().optional(),
  kaavarivi: z.number().int().optional(),
  kaavaLaji: z.enum(['otsikko', 'valisumma', 'ohitettava']).optional(),
});

/** Kohdennusraportin osio: kohdennus ja sen tuloslaskelmarivit. */
export const WireKohdennusOsioSchema = z.object({
  kohdennus: z.object({
    id: z.number(),
    nimi: z.string(),
    polku: z.string(),
    tuntematon: z.literal(true).optional(),
  }),
  rivit: z.array(WireRaporttiRiviSchema),
});

/** Budjettivertailun rivi: rahat merkkijonoina (tai null), `prosentti` prosentin sadasosina. */
export const WireBudjettivertailuRiviSchema = z.object({
  teksti: z.string(),
  sisennys: z.number(),
  lihava: z.boolean(),
  tyhja: z.boolean().optional(),
  tili: z.number().int().optional(),
  kaavarivi: z.number().int().optional(),
  budjetti: z.union([z.string(), z.null()]),
  toteutunut: z.union([z.string(), z.null()]),
  ero: z.union([z.string(), z.null()]),
  prosentti: z.number().int().optional(),
});

/** Tilinpäätösasiakirja: tuloslaskelma + tase (raporttirivit) sekä liitetiedot/vahvistus. */
export const WireTilinpaatosDocSchema = z
  .object({
    tilikausi: z.object({ alkaa: z.string(), loppuu: z.string() }),
    muoto: z.enum(['yleinen', 'pien', 'mikro']),
    tuloslaskelma: z.array(WireRaporttiRiviSchema),
    tase: z.array(WireRaporttiRiviSchema),
    liitetiedot: z.string(),
    vahvistettu: z.string().nullable(),
  })
  .passthrough();
export const WireLiitetiedotSyoteSchema = z
  .object({ loppupvm: z.string(), teksti: z.string() })
  .passthrough();
export const WireVahvistusSyoteSchema = z.object({ alkaa: z.string() }).passthrough();

export const WireInitSchema = z.object({
  asetukset: WireAsetuksetSchema,
  tilit: z.array(WireTiliSchema),
  tilikaudet: z.array(WireTilikausiSchema),
  tositesarjat: z.array(z.string()),
  kohdennukset: z.array(WireKohdennusSchema),
  kierrot: z.array(z.unknown()).optional(),
});

export const WireInitPatchSchema = z
  .object({ asetukset: WireAsetuksetSchema.optional(), tilit: z.array(WireTiliSchema).optional() })
  .passthrough();

/** Virhevastaus: ihmisluettava viesti + valinnainen domain-koodi (ResourceError.code). */
export const WireVirheSchema = z
  .object({ virhe: z.string(), koodi: z.string().optional() })
  .passthrough();
