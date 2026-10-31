import type { TositeEditoriTila, VientiRivi } from '@/editori/types';
import type { LaskuTila, LomakeRivi } from '@/laskutus/laskuReducer';
import type { OstolaskuTila } from '@/ostolaskut/ostolaskuReducer';
import { TositeTyyppi } from '@penni/engine';

function onObjekti(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/**
 * Syvä arvovertailu lomaketilan muutosseurantaan: taulukot järjestyksessä, objektit
 * avainjärjestyksestä välittämättä. Avain, jonka arvo on undefined, on sama kuin puuttuva
 * (reducerit poistavat valinnaisen kentän tai jättävät sen undefinediksi).
 */
export function samatArvot(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!onObjekti(a) || !onObjekti(b)) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => samatArvot(x, b[i]));
  }
  const avaimet = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of avaimet) if (!samatArvot(a[k], b[k])) return false;
  return true;
}

/** Tyhjä ruudukkorivi ei tallennu (johdaViennit pudottaa sen), joten se ei ole muutos. */
function tyhjaVientirivi(r: VientiRivi): boolean {
  return r.tili === undefined && !r.selite && r.debetSnt === 0 && r.kreditSnt === 0;
}

/**
 * Tositeditorin vertailuprojektio: pelkät tallentuvat arvot. Pois jäävät riviavaimet
 * (`avain` vaihtuu nollauksessa), käyttöliittymän merkinnät (`ehdotettu`, `alvTililta`)
 * ja kokonaan tyhjät rivit.
 */
export function tositeVertailuun(tila: TositeEditoriTila) {
  return {
    paiva: tila.paiva,
    tyyppi: tila.tyyppi,
    sarja: tila.sarja,
    selite: tila.selite,
    tiliote: tila.tyyppi === TositeTyyppi.TILIOTE ? (tila.tiliote ?? null) : null,
    rows: tila.rows
      .filter((r) => !tyhjaVientirivi(r))
      .map((r) => ({
        tili: r.tili,
        selite: r.selite ?? '',
        debetSnt: r.debetSnt,
        kreditSnt: r.kreditSnt,
        alvKoodi: r.alvKoodi,
        alvProsentti: r.alvProsentti,
        bruttoSyotto: r.bruttoSyotto,
      })),
  };
}

/** Laskurivi ilman avainta; kokonaan tyhjä rivi (ei selitettä eikä hintaa) jätetään pois. */
function laskurivitVertailuun(rivit: readonly LomakeRivi[]) {
  return rivit
    .filter((r) => r.selite !== '' || r.aNettoSnt !== 0)
    .map(({ avain: _avain, ...r }) => r);
}

/** Myyntilaskulomakkeen vertailuprojektio (riviavaimet ja tyhjät rivit pois). */
export function laskuVertailuun(tila: LaskuTila) {
  return { ...tila, rivit: laskurivitVertailuun(tila.rivit) };
}

/** Ostolaskulomakkeen vertailuprojektio (riviavaimet ja tyhjät rivit pois). */
export function ostolaskuVertailuun(tila: OstolaskuTila) {
  return { ...tila, rivit: laskurivitVertailuun(tila.rivit) };
}
