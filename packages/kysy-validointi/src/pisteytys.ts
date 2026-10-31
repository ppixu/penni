import type { KysyTapahtuma } from '@penni/kysy';
import type { Kysymys } from './kysymykset.js';

// muotoileEuro (packages/euro/src/format.ts) emits NBSP thousands separators and U+2212 as the
// minus sign — never a plain space or hyphen-minus. The model is instructed to quote the tool's
// `eur` field verbatim (kehote.ts), so poimiEurot must accept those exact characters, but also
// stays lenient toward a plain space/hyphen in case a model paraphrases instead of quoting.
const NBSP = ' ';
const MINUS = '−';

/**
 * Parse every Finnish-formatted € amount out of free text, in cents. Matches `1 234,56 €`
 * (space or NBSP thousands separator), `1234,56€` (no separator, symbol glued on), plain
 * `1234,56` (no symbol at all), and whole-euro amounts with an explicit symbol (`0 €`,
 * `150 €`) — a live model answered a correct zero balance as "0 €" and the parser missed it.
 * Without the € symbol the comma-and-two-decimals is what marks a number as money, so bare
 * counts/dates/tosite-numbers are never mistaken for an amount. Accepts both `-` and U+2212
 * as a leading minus sign.
 */
export function poimiEurot(teksti: string): number[] {
  const luku = `(?:\\d{1,3}(?:[ ${NBSP}]\\d{3})+|\\d+)`;
  const RE = new RegExp(
    `[-${MINUS}]?\\s?(?:${luku},\\d{2}(?:[ ${NBSP}]?€)?|${luku}[ ${NBSP}]?€)`,
    'g',
  );
  const out: number[] = [];
  for (const osuma of teksti.match(RE) ?? []) {
    const negatiivinen = osuma.startsWith('-') || osuma.startsWith(MINUS);
    const numerot = osuma.replace(new RegExp(`[-${MINUS}€${NBSP}\\s]`, 'g'), '');
    const [kokonaisosaRaw, sentitRaw] = numerot.split(',');
    const kokonaisosa = Number(kokonaisosaRaw ?? '0');
    const sentit = Number(sentitRaw ?? '0');
    const arvo = kokonaisosa * 100 + sentit;
    out.push(negatiivinen ? -arvo : arvo);
  }
  return out;
}

/** "en tiedä" -perheen fraasit, joilla malli ohjeistetaan kieltäytymään (ks. kehote.ts). */
const KIELTAYTYMISFRAASIT = [
  'en tiedä',
  'en osaa sanoa',
  'en pysty vastaamaan',
  'en voi vastata',
  'en löydä',
  'ei ole tietoa',
  'ei löydy tietoa',
  'ei tietoa saatavilla',
  // In-substance refusals seen live: the model explains that the tools cannot answer instead of
  // saying a literal "en tiedä" — still a correct refusal (fabricated-number check stays separate).
  'ei ole mahdollista',
  'ei ole mahdollisuutta',
  'ei voi antaa',
  'eivät voi antaa',
  'ei ole tarjolla',
  'ei kuulu kirjanpitoon',
  'ei ole mainittu',
  'ei mainita',
  'tiedoissa ei ole',
];

/** Onko teksti "en tiedä" -perhettä (case-insensitive osuma jollakin tunnetulla fraasilla). */
export function onKieltaytyminen(teksti: string): boolean {
  const t = teksti.toLowerCase();
  return KIELTAYTYMISFRAASIT.some((fraasi) => t.includes(fraasi));
}

export interface Tulos {
  id: string;
  ok: boolean;
  syy: string;
  kierrokset: number;
  kestoMs: number;
  tyokalutOk: boolean;
}

type TyokaluValmisTapahtuma = Extract<KysyTapahtuma, { tyyppi: 'tyokalu_valmis' }>;
type VirheTapahtuma = Extract<KysyTapahtuma, { tyyppi: 'virhe' }>;
type VastausTapahtuma = Extract<KysyTapahtuma, { tyyppi: 'vastaus' }>;

/** Työkalun `suoritaTyokalu`-kääre (silmukka.ts) palauttaa `{ virhe, ... }`-muotoisen tuloksen
 *  poikkeuksen sijaan — tunnistetaan tästä, ei heitosta. */
function onTyokaluvirhe(t: TyokaluValmisTapahtuma): boolean {
  return typeof t.tulos === 'object' && t.tulos !== null && 'virhe' in t.tulos;
}

/**
 * Score one question against the events its `kysy()` run produced. `odotettu` is the value
 * computed by `k.odotus.arvo(client, pvm)` for `sentit`/`lukumaara` questions — `undefined` for
 * `kieltaytyminen` questions, which have no computed number.
 *
 * Scoring (brief §task-7): numeric ok = any parsed amount equals the expected value exactly;
 * refusal ok = `onKieltaytyminen` true AND no number present in the answer (poimiEurot empty).
 * `syy` carries a specific, stable failure-mode string so the report can count occurrences per
 * mode rather than lumping every miss into one bucket (kuitti-validointi raportti.ts discipline).
 */
export function pisteyta(
  k: Kysymys,
  tapahtumat: readonly KysyTapahtuma[],
  odotettu: number | undefined,
  kestoMs: number,
): Tulos {
  const kierrokset = tapahtumat.filter((t) => t.tyyppi === 'tyokalu_alkoi').length;
  const kutsutut = tapahtumat.filter(
    (t): t is TyokaluValmisTapahtuma => t.tyyppi === 'tyokalu_valmis',
  );
  const tyokalutOk =
    k.tyokaluPerhe === undefined || k.tyokaluPerhe.length === 0
      ? true
      : kutsutut.some((t) => k.tyokaluPerhe?.includes(t.nimi));

  const tulosPohja = { id: k.id, kierrokset, kestoMs, tyokalutOk };

  const vastaus = tapahtumat.find((t): t is VastausTapahtuma => t.tyyppi === 'vastaus');
  if (!vastaus) {
    const virhe = tapahtumat.find((t): t is VirheTapahtuma => t.tyyppi === 'virhe');
    const syy = virhe
      ? `mallivirhe: ${virhe.koodi}`
      : kutsutut.some(onTyokaluvirhe)
        ? 'työkaluvirhe'
        : 'ei vastausta';
    return { ...tulosPohja, ok: false, syy };
  }

  const teksti = vastaus.teksti;

  if (k.odotus.tyyppi === 'kieltaytyminen') {
    const kieltaytyi = onKieltaytyminen(teksti);
    const luvut = poimiEurot(teksti);
    if (!kieltaytyi) return { ...tulosPohja, ok: false, syy: 'vastasi kieltäytymisen sijaan' };
    if (luvut.length > 0) return { ...tulosPohja, ok: false, syy: 'kieltäytyi mutta keksi luvun' };
    return { ...tulosPohja, ok: true, syy: 'ok' };
  }

  if (odotettu === undefined) {
    throw new Error(`kysymykselle ${k.id} puuttuu odotettu arvo`);
  }

  if (k.odotus.tyyppi === 'sentit') {
    const luvut = poimiEurot(teksti);
    if (luvut.length === 0) {
      return { ...tulosPohja, ok: false, syy: 'ei löytynyt euromäärää vastauksesta' };
    }
    const osui = luvut.includes(odotettu);
    return {
      ...tulosPohja,
      ok: osui,
      syy: osui ? 'ok' : `väärä summa: odotettu ${odotettu}, saatu ${luvut.join(', ')}`,
    };
  }

  // lukumaara: plain (mahdollisesti tuhaterotellut) kokonaisluvut, ei pilkkuosaa/€-merkkiä.
  const luvut = poimiKokonaisluvut(teksti);
  if (luvut.length === 0) {
    return { ...tulosPohja, ok: false, syy: 'ei löytynyt lukumäärää vastauksesta' };
  }
  const osui = luvut.includes(odotettu);
  return {
    ...tulosPohja,
    ok: osui,
    syy: osui ? 'ok' : `väärä lukumäärä: odotettu ${odotettu}, saatu ${luvut.join(', ')}`,
  };
}

/**
 * Scrub numeric-looking tokens that are never a count, before integer extraction: ISO dates
 * (2026-01-01), Finnish dot dates (16.8.2026, 1.1.), decimal-comma numbers incl. money and VAT
 * rates (1 234,56 €, 25,5 %), integer percentages (24 %) and standalone 4-digit years/account
 * numbers (1900–2099). Counts in the golden set are small plain integers; without the scrub a
 * single quoted date polluted the extraction with fragments like 2026, 1, 1.
 */
function siivoaLukumaarateksti(teksti: string): string {
  return teksti
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}\.(?:\d{4})?/g, ' ')
    .replace(
      new RegExp(
        `[-${MINUS}]?(?:\\d{1,3}(?:[ ${NBSP}]\\d{3})+|\\d+),\\d+(?:[ ${NBSP}]?[€%])?`,
        'g',
      ),
      ' ',
    )
    .replace(new RegExp(`\\d+[ ${NBSP}]?%`, 'g'), ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ');
}

/** Plain integers, optionally NBSP/space-grouped by thousands — for `lukumaara`-vastauksia. */
export function poimiKokonaisluvut(teksti: string): number[] {
  const siivottu = siivoaLukumaarateksti(teksti);
  const RE = new RegExp(`\\d{1,3}(?:[ ${NBSP}]\\d{3})+|\\d+`, 'g');
  return (siivottu.match(RE) ?? []).map((m) =>
    Number(m.replace(new RegExp(`[ ${NBSP}]`, 'g'), '')),
  );
}
