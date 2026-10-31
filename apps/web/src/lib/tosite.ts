import { type Tosite, TositeTyyppi, type TositeVienti } from '@penni/engine';
import type { Cents } from '@penni/euro';

/** A voucher's gross magnitude = Σ debet (a balanced voucher has Σdebet === Σkredit). Integer cents. */
export function vientienSumma(viennit: readonly TositeVienti[]): Cents {
  return viennit.reduce((sum, v) => sum + v.debet, 0) as Cents;
}

/**
 * Listojen Summa: tiliotteella pankin ilmoittama loppusaldo (tiliotetositteella ei yleensä ole
 * vientejä), muuten vientien summa.
 */
export function tositteenSumma(t: Pick<Tosite, 'tyyppi' | 'viennit' | 'tiliote'>): Cents {
  if (t.tyyppi === TositeTyyppi.TILIOTE && t.tiliote?.loppusaldo !== undefined)
    return t.tiliote.loppusaldo;
  return vientienSumma(t.viennit);
}

/** Finnish label for a TositeTyyppi code (unknown → generic "Tosite"). */
const TYYPPI_NIMET: Record<number, string> = {
  0: 'Muu',
  90: 'Tuonti',
  100: 'Meno',
  110: 'Verkkolasku',
  120: 'Kululasku',
  200: 'Tulo',
  210: 'Myyntilasku',
  214: 'Hyvityslasku',
  216: 'Maksumuistutus',
  300: 'Siirto',
  400: 'Tiliote',
  500: 'Palkka',
  700: 'Muistio',
  800: 'Liitetieto',
  1000: 'Järjestelmätosite',
  9010: 'Tilinavaus',
  9040: 'Yksityistilien päättäminen',
  9100: 'ALV-laskelma',
  9105: 'Marginaaliverolaskelma',
  9110: 'Yhteenvetoilmoitus',
  9910: 'Poistot',
  9920: 'Jaksotukset',
  9930: 'Tulovero',
};

export function tositeTyyppiLabel(tyyppi: number): string {
  return TYYPPI_NIMET[tyyppi] ?? 'Tosite';
}

/** Laskutyypit: tyypin vaihto irrottaisi tositteen laskusta, joten tyyppi pysyy. */
const LASKUTYYPIT: ReadonlySet<number> = new Set([
  TositeTyyppi.SAAPUNUTVERKKOLASKU,
  TositeTyyppi.KULULASKU,
  TositeTyyppi.MYYNTILASKU,
  TositeTyyppi.HYVITYSLASKU,
  TositeTyyppi.MAKSUMUISTUTUS,
]);

type LaskuKentat = Pick<
  Tosite,
  'tyyppi' | 'rivit' | 'numero' | 'laskupvm' | 'erapvm' | 'alkuperainenTosite'
>;

/** Onko tosite lasku: laskutyyppi tai laskutiedot (rivit, numero, lasku-/eräpäivä, hyvitettävä). */
export function onLasku(t: LaskuKentat): boolean {
  return (
    LASKUTYYPIT.has(t.tyyppi) ||
    (t.rivit !== undefined && t.rivit.length > 0) ||
    Boolean(t.numero) ||
    Boolean(t.laskupvm) ||
    Boolean(t.erapvm) ||
    Boolean(t.alkuperainenTosite)
  );
}

/**
 * Voiko tallennetun tositteen tyypin vaihtaa (Meno/Tulo/Siirto/Muistio)? Ei laskuilla
 * (laskutyyppi tai laskutiedot: rivit, laskunumero, lasku- tai eräpäivä, hyvitettävä lasku) eikä
 * järjestelmätositteilla (koodi >= 1000, kuten Kitsasin tositetyyppimalli). Kauden lukitus
 * tarkistetaan erikseen.
 */
export function tyypinVoiVaihtaa(t: LaskuKentat): boolean {
  return t.tyyppi < TositeTyyppi.JARJESTELMATOSITE && !onLasku(t);
}
