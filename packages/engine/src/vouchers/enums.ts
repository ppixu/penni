// Verbatim from db/tositetyyppimodel.h:23-48.
export const TositeTyyppi = {
  MUU: 0,
  TUONTI: 90,
  MENO: 100,
  SAAPUNUTVERKKOLASKU: 110,
  KULULASKU: 120,
  TULO: 200,
  MYYNTILASKU: 210,
  HYVITYSLASKU: 214,
  MAKSUMUISTUTUS: 216,
  SIIRTO: 300,
  TILIOTE: 400,
  PALKKA: 500,
  MUISTIO: 700,
  LIITETIETO: 800,
  JARJESTELMATOSITE: 1000,
  YKSITYISTILIEN_PAATTAMINEN: 9040,
  TILINAVAUS: 9010,
  ALVLASKELMA: 9100,
  MARGINAALILASKELMA: 9105,
  YHTEENVETOILMOITUS: 9110,
  POISTOLASKELMA: 9910,
  JAKSOTUS: 9920,
  TULOVERO: 9930,
} as const;

// Verbatim from model/tositevienti.h:56-71.
export const VientiTyyppi = {
  TUNTEMATON: 0,
  KIRJAUS: 1,
  VASTAKIRJAUS: 2,
  ALVKIRJAUS: 3,
  MAAHANTUONTIVASTAKIRJAUS: 31,
  VAHENNYSKELVOTON: 32,
  OSTO: 100,
  MYYNTI: 200,
  SUORITUS: 300,
  SIIRTO: 400,
  BRUTTOOIKAISU: 91091,
  POISTO: 99100,
  JAKSOTUS_TP: 99210,
  JAKSOTUS_TA: 99220,
} as const;

// Verbatim subset of model/lasku.h:33 (Lasku::Maksutapa). Only the 1d payment methods.
export const Maksutapa = {
  LASKU: 0,
  KATEINEN: 1,
  KORTTIMAKSU: 5,
} as const;

// Verbatim from model/tosite.h:79-95. NOTE: not a total order — LAHETETAAN(101)
// and LAHETYSVIRHE(102) are send-states adjacent to KIRJANPIDOSSA(100), and
// VALMISLASKU(80) is a finalized-invoice state below 100.
export const TositeTila = {
  POISTETTU: 0,
  MALLIPOHJA: 5,
  HYLATTY: 10,
  SAAPUNUT: 20,
  TARKASTETTU: 30,
  HYVAKSYTTY: 40,
  LUONNOS: 50,
  VALMISLASKU: 80,
  KIRJANPIDOSSA: 100,
  LAHETETAAN: 101,
  LAHETYSVIRHE: 102,
  LAHETETTYLASKU: 110,
  TOIMITETTULASKU: 113,
  AVATTULASKU: 114,
  MUISTUTETTU: 120,
} as const;

/** Margin-scheme threshold: alvKoodi >= KAYTETYT carries no added VAT (lasku.h:35). */
export const KAYTETYT = 91;
/** The "no VAT" code (kitsas.h:26). */
export const EIALV = 0;

/** "In the books": tila >= KIRJANPIDOSSA (100) — triggers numbering + lock checks. */
export function onKirjanpidossa(tila: number): boolean {
  return tila >= TositeTila.KIRJANPIDOSSA;
}

/** Partner is retained only for voucher types 100..299 (tosite.cpp:629-631). */
export function sailytaKumppani(tyyppi: number): boolean {
  return tyyppi >= TositeTyyppi.MENO && tyyppi < TositeTyyppi.SIIRTO;
}
