/**
 * Selaimen kaltaiset historiaeleet työpöytäsovellukseen: näppäinoikopolut ja macOS:n kahden
 * sormen vaakapyyhkäisy. Chrome ja Safari toteuttavat pyyhkäisyn selainkerroksessa (ei
 * Chromiumin sisältökerroksessa), joten Electronissa sitä ei ole — trackpadin vaakaveto näkyy
 * sivulle pelkkinä wheel-tapahtumina. Tämä moduuli on puhdas logiikka; kytkentä DOMiin on
 * useHistorianavigointi.ts:ssä.
 */

export type Suunta = 'takaisin' | 'eteenpain';

/** Vaakavedon pituus (px), jonka jälkeen siirrytään. */
export const KYNNYS = 150;
/** Näin pitkä tauko (ms) wheel-tapahtumissa päättää eleen (myös hitausrullauksen). */
export const TAUKO = 200;
/** Liike (px), jonka jälkeen ele luokitellaan vaaka- tai pystysuuntaiseksi. */
const LIUKUMA = 12;
/** Vaakaeleen on oltava selvästi vaakasuuntainen: |x| > SUHDE · |y|. */
const SUHDE = 1.5;

export interface RullausSyote {
  /** Vaakaliike pikseleinä; negatiivinen = sormet oikealle (luonnollinen vieritys) = takaisin. */
  dx: number;
  dy: number;
  /** Aikaleima (ms). */
  aika: number;
  /** Jokin osoittimen alla oleva elementti voi vierittää dx:n suuntaan tai sivu käsitteli tapahtuman. */
  vierittyy: boolean;
}

export type PyyhkaisyTulos =
  | { tila: 'lepo' }
  | { tila: 'veto'; suunta: Suunta; osuus: number }
  | { tila: 'laukaisu'; suunta: Suunta };

const LEPO: PyyhkaisyTulos = { tila: 'lepo' };

/**
 * Kokoaa wheel-tapahtumat eleiksi. Ele = tapahtumajono ilman TAUKO-mittaista taukoa (sisältää
 * hitausrullauksen). Ele luokitellaan kerran: pystysuuntainen tai vierittävän elementin päällä
 * alkanut ele ohitetaan loppuun asti — kuten Chromessa, taulukon reunaan vierittäminen ei
 * samalla eleellä vaihda sivua. Vaakaele laukaisee kerran, kun kertymä ylittää kynnyksen.
 */
export function luoPyyhkaisy(kynnys = KYNNYS, tauko = TAUKO) {
  let viimeisin = Number.NEGATIVE_INFINITY;
  let vaihe: 'avoin' | 'vaaka' | 'ohitus' | 'kaytetty' = 'avoin';
  let x = 0;
  let y = 0;

  return {
    syota(e: RullausSyote): PyyhkaisyTulos {
      if (e.aika - viimeisin > tauko) {
        vaihe = 'avoin';
        x = 0;
        y = 0;
      }
      viimeisin = e.aika;
      if (vaihe === 'ohitus' || vaihe === 'kaytetty') return LEPO;
      if (e.vierittyy) {
        vaihe = 'ohitus';
        return LEPO;
      }
      x += e.dx;
      y += e.dy;
      if (vaihe === 'avoin') {
        if (Math.abs(x) + Math.abs(y) < LIUKUMA) return LEPO;
        if (Math.abs(x) <= SUHDE * Math.abs(y)) {
          vaihe = 'ohitus';
          return LEPO;
        }
        vaihe = 'vaaka';
      }
      if (x === 0) return LEPO;
      const suunta: Suunta = x < 0 ? 'takaisin' : 'eteenpain';
      if (Math.abs(x) >= kynnys) {
        vaihe = 'kaytetty';
        return { tila: 'laukaisu', suunta };
      }
      return { tila: 'veto', suunta, osuus: Math.abs(x) / kynnys };
    },
    /** Onko viimeisimmästä tapahtumasta kulunut eleen päättävä tauko (osoittimen piilotus). */
    paattynyt(nyt: number): boolean {
      return nyt - viimeisin > tauko;
    },
  };
}

export interface NappainTiedot {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Selainten historiaoikopolut: macOS Cmd+[ / Cmd+] ja Cmd+← / Cmd+→, muualla Alt+← / Alt+→.
 * Suomalaisella Mac-näppäimistöllä "[" on Option+8 ja hakasulkujen fyysinen paikka on Å / ¨,
 * joten hyväksytään sekä merkki että fyysinen näppäin (e.code).
 */
export function nappainSuunta(e: NappainTiedot, mac: boolean): Suunta | null {
  if (e.shiftKey || e.ctrlKey) return null;
  if (mac) {
    if (!e.metaKey) return null;
    if (e.key === '[') return 'takaisin';
    if (e.key === ']') return 'eteenpain';
    if (e.altKey) return null;
    if (e.code === 'BracketLeft' || e.key === 'ArrowLeft') return 'takaisin';
    if (e.code === 'BracketRight' || e.key === 'ArrowRight') return 'eteenpain';
    return null;
  }
  if (!e.altKey || e.metaKey) return null;
  if (e.key === 'ArrowLeft') return 'takaisin';
  if (e.key === 'ArrowRight') return 'eteenpain';
  return null;
}

/**
 * Voiko jokin elementti `alku`sta ylöspäin vierittää vaakasuunnassa dx:n suuntaan? Silloin
 * vaakaveto kuuluu sille (leveät taulukot, ruudukkoeditori), ei historialle.
 */
export function voiVierittaaVaakaan(alku: Element | null, dx: number): boolean {
  if (dx === 0) return false;
  const juuri = typeof document !== 'undefined' ? document.scrollingElement : null;
  for (let el = alku; el; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth) continue;
    const ylivuoto = getComputedStyle(el).overflowX;
    const vieritettava =
      ylivuoto === 'auto' ||
      ylivuoto === 'scroll' ||
      (el === juuri && ylivuoto !== 'hidden' && ylivuoto !== 'clip');
    if (!vieritettava) continue;
    if (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
      return true;
  }
  return false;
}
