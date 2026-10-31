import { type Cents, Euro, roundHalfAway } from '@penni/euro';
import { muotoileYtunnus, tarkistaYtunnus } from '@penni/validator';
import type { IsoDate } from '../vouchers/types.js';
import { onkoPvmValidi } from '../vouchers/types.js';
import type { JasennysTulos } from './jasennaKuitti.js';
import type { Kuitti, KuittiAlvEra } from './kuitti.js';
import { SALLITUT_KANNAT } from './tasmays.js';

/** Poistaa ääkköset avainsanavertailua varten (ä→a, ö→o). */
function riisuAakkoset(s: string): string {
  return s.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o');
}

/** Tiivistää perättäiset välit yhdeksi (pdf.js erottelee osat välilyönnein). */
function tiivista(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Rahamäärä: '1 234,56' | '1,234.56' | '20.00' | '20,00' | '€6,40'. Viimeinen erotin on
 * desimaali, muut tuhaterottimia. Loppu (?![.\d]) estää päiväysten (15.07.2026) osumat.
 */
const RAHA = '\\d{1,3}(?:[ .,]\\d{3})*[.,]\\d{2}(?![.\\d])';
const RAHA_RE = new RegExp(RAHA, 'g');

/** Yleiset valuuttakoodit rahariveillä; nimi/osoite ei yksin ratkaise valuuttaa. */
const VALUUTTA_RE =
  /\b(?:EUR|USD|GBP|CHF|SEK|NOK|DKK|ISK|PLN|CZK|HUF|RON|BGN|TRY|CAD|AUD|NZD|JPY|CNY|HKD|SGD|TWD|KRW|INR|IDR|MYR|THB|PHP|VND|AED|SAR|ILS|ZAR|BRL|MXN|CLP|COP|ARS|RUB|UAH)\b/gi;

/**
 * Ei muunna rahamääriä. Epäselvä dollari/jenimerkki tai useampi valuutta = XXX (tuntematon),
 * jotta kuitin summa ei päädy eurokirjaukseksi. Ilman valuuttamerkintää säilyy EUR-oletus.
 */
function poimiValuutta(rivit: readonly string[]): string {
  const valuutat = new Set<string>();
  for (const rivi of rivit) {
    const koodit = rivi.match(VALUUTTA_RE) ?? [];
    if (
      !new RegExp(RAHA).test(rivi) &&
      !/\b(?:currency|valuutta)\b/i.test(rivi) &&
      !(koodit.length === 1 && rivi.toUpperCase() === koodit[0]?.toUpperCase())
    )
      continue;
    for (const koodi of koodit) valuutat.add(koodi.toUpperCase());
    if (rivi.includes('€')) valuutat.add('EUR');
    if (rivi.includes('£')) valuutat.add('GBP');
    if (koodit.length === 0 && /[$¥￥]/.test(rivi)) valuutat.add('XXX');
  }
  return valuutat.size === 0 ? 'EUR' : valuutat.size === 1 ? ([...valuutat][0] ?? 'XXX') : 'XXX';
}

/** Rahamäärän merkkijono → sentit (viimeinen erotin desimaali, muut tuhaterottimia). */
function rahaSenteiksi(token: string): Cents {
  const m = /^(.*)[.,](\d{2})$/.exec(token.replace(/[^\d.,]/g, ''));
  if (!m) return Euro.fromCents(0);
  const kokonaiset = (m[1] ?? '').replace(/[.,]/g, '');
  return Euro.fromCents(
    Number.parseInt(kokonaiset || '0', 10) * 100 + Number.parseInt(m[2] ?? '0', 10),
  );
}

/** Riviltä löytyvät rahamäärät sentteinä. */
function poimiEurot(rivi: string): Cents[] {
  return (rivi.match(RAHA_RE) ?? []).map(rahaSenteiksi);
}

/** ALV-kanta riviltä ('14 %' | '25,5 %' | '0%'); vain sallitut kannat. */
function poimiKanta(rivi: string): number | undefined {
  const m = /(\d{1,2}(?:[.,]\d)?)\s*%/.exec(rivi);
  if (!m?.[1]) return undefined;
  const kanta = Number.parseFloat(m[1].replace(',', '.'));
  return SALLITUT_KANNAT.includes(kanta) ? kanta : undefined;
}

/** Nimetyn sarakkeen (netto/vero/brutto) rahamäärä riviltä; sanaraja estää 'veroton'-osumat. */
function poimiNimetty(rivi: string, avain: string): Cents | undefined {
  const m = new RegExp(`\\b${avain}\\b\\D*(${RAHA})`, 'i').exec(rivi);
  return m?.[1] ? rahaSenteiksi(m[1]) : undefined;
}

const SUMMA_AVAINSANAT = ['yhteensa', 'verollinen', 'maksettava', 'total', 'summa', 'yht'];
const YTUNNUS_RE = /\d{7}-\d/g;

const KUUKAUDET: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Päiväys riviltä ISO-muotoon: suomalainen D.M.YYYY, ISO YYYY-MM-DD tai englantilainen 'Month D, YYYY'. */
function poimiPvmRivilta(rivi: string): string | undefined {
  const fi = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(rivi);
  if (fi) return `${fi[3]}-${(fi[2] ?? '').padStart(2, '0')}-${(fi[1] ?? '').padStart(2, '0')}`;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(rivi);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const en = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(rivi);
  const kk = en ? KUUKAUDET[(en[1] ?? '').toLowerCase()] : undefined;
  if (en && kk) return `${en[3]}-${String(kk).padStart(2, '0')}-${(en[2] ?? '').padStart(2, '0')}`;
  return undefined;
}

// Alue käännetyn alv:n koodivalintaan (best-effort; ääkköset jo riisuttu).
const EIEU_MAAT = [
  'united states',
  'usa',
  'yhdysvallat',
  'united kingdom',
  'sveitsi',
  'switzerland',
  'norja',
  'norway',
];
const EU_MAAT = [
  'viro',
  'estonia',
  'saksa',
  'germany',
  'irlanti',
  'ireland',
  'alankomaat',
  'netherlands',
  'ranska',
  'france',
  'ruotsi',
  'sweden',
  'espanja',
  'spain',
  'italia',
  'italy',
  'belgia',
  'belgium',
  'puola',
  'poland',
];

/** Rivit jotka eivät ole myyjän nimi (otsikot, boilerplate). */
const BOILERPLATE =
  /^(page \d|receipt\b|kuitti\b|invoice\b|lasku\b|tilaus|order\b|bill to|subtotal|total\b|description|alv %|tax invoice|payment)/i;
/** Yhtiöpääte myyjärivin tunnistamiseen. */
const YRITYS_PAATE = /\b(oyj?|ab|plc|pbc|inc|llc|ltd|gmbh|tmi|ky|kb)\b|,\s?(pbc|inc|llc|ltd)/i;
/** Myyjä "Receipt/Invoice from X" -otsikosta (Stripe yms.). */
const MYYJA_LAHDE = /\b(?:receipt|invoice|kuitti|lasku)\s+from\s+(.+)$/i;
/** Ostajan/vastaanottajan rivi (sähköpostiosoite tai vastaanottajamerkintä) — ei myyjä. */
const OSTAJARIVI =
  /[^\s@]+@[^\s@]+\.[^\s@]+|^(?:to|bill to|ship to|vast\.?\s*ott|vastaanottaja|vastausosoite)\b/i;

/**
 * Poimii Kuitin pdf.js:n litteästä tekstistä deterministisesti (ilman mallia).
 * Digitaalisen PDF:n tekstikerros on tarkka, joten heuristiikat ovat luotettavia.
 */
export function poimiKuittiTekstista(teksti: string): JasennysTulos {
  const rivit = teksti
    .split('\n')
    .map(tiivista)
    .filter((r) => r !== '');
  if (rivit.length === 0) return { ok: false, virhe: 'Tyhjä teksti.' };

  const kuitti: Kuitti = { valuutta: poimiValuutta(rivit), alv: [] };

  // Myyjä: 1) "Receipt from X" -otsikko, 2) yhtiöpäätteen sisältävä rivi, 3) ensimmäinen rivi
  // joka ei ole boilerplatea eikä ostajan/vastaanottajan rivi (sähköposti). Muuten myyjä jää
  // tyhjäksi — huono arvaus (esim. "Receipt") päätyisi tositteen otsikoksi.
  const lahde = rivit.map((r) => MYYJA_LAHDE.exec(r)?.[1]?.trim()).find((x): x is string => !!x);
  // Päiväysrivi ("Date of issue August 2, 2026", "Date paid …") ei ole koskaan myyjä.
  const eiPvm = (r: string): boolean => poimiPvmRivilta(r) === undefined;
  const myyja =
    lahde ??
    rivit.find((r) => YRITYS_PAATE.test(r) && eiPvm(r)) ??
    rivit.find((r) => !BOILERPLATE.test(r) && !OSTAJARIVI.test(r) && eiPvm(r));
  if (myyja !== undefined) kuitti.myyja = myyja;

  // Y-tunnus: ensimmäinen tarkisteen läpäisevä.
  for (const m of teksti.matchAll(YTUNNUS_RE)) {
    if (tarkistaYtunnus(m[0])) {
      kuitti.ytunnus = muotoileYtunnus(m[0]);
      break;
    }
  }

  // Päiväys: suositaan päiväys/pvm/date-riviä, vältetään eräpäivää.
  let pvmEnsimmainen: string | undefined;
  let laskunPvm: string | undefined;
  for (const rivi of rivit) {
    const iso = poimiPvmRivilta(rivi);
    if (iso === undefined || !onkoPvmValidi(iso)) continue;
    const norm = riisuAakkoset(rivi);
    if (norm.includes('erapaiva') || norm.includes('erapvm') || norm.includes('due')) continue;
    pvmEnsimmainen ??= iso;
    if (laskunPvm === undefined && /paivays|pvm|date|paid|laskun/.test(norm)) laskunPvm = iso;
  }
  const pvm = laskunPvm ?? pvmEnsimmainen;
  if (pvm !== undefined) kuitti.pvm = pvm as IsoDate;

  // Loppusumma: suurin rahamäärä summa-avainsanan riveiltä; muuten koko tekstin suurin.
  const summaRivit = rivit.filter((r) => {
    const norm = riisuAakkoset(r);
    if (norm.includes('veroton') || norm.includes('netto')) return false;
    return SUMMA_AVAINSANAT.some((a) => norm.includes(a));
  });
  const summat = (summaRivit.length > 0 ? summaRivit : rivit).flatMap(poimiEurot);
  if (summat.length > 0) kuitti.bruttoSumma = Euro.fromCents(Math.max(...summat));

  // ALV: ensin nimetyt monikantarivit; muuten yhden kannan takaisinlaskenta loppusummasta.
  const nimetyt: KuittiAlvEra[] = [];
  for (const rivi of rivit) {
    const kanta = poimiKanta(rivi);
    if (kanta === undefined) continue;
    const netto = poimiNimetty(rivi, 'netto');
    const vero = poimiNimetty(rivi, 'vero');
    const brutto = poimiNimetty(rivi, 'brutto');
    if (netto !== undefined && vero !== undefined && brutto !== undefined)
      nimetyt.push({ kanta, netto, vero, brutto });
  }
  if (nimetyt.length > 0) {
    kuitti.alv = nimetyt;
  } else {
    const kannat = [...new Set(rivit.map(poimiKanta).filter((k): k is number => k !== undefined))];
    const kanta = kannat[0];
    if (kannat.length === 1 && kanta !== undefined && kuitti.bruttoSumma !== undefined) {
      const brutto = kuitti.bruttoSumma;
      const netto = Euro.fromCents(roundHalfAway((brutto * 100) / (100 + kanta)));
      kuitti.alv = [{ kanta, netto, vero: Euro.sub(brutto, netto), brutto }];
    }
  }

  // Käännetty verovelvollisuus + myyjän alue (koodivalintaan tositteessa).
  const koko = riisuAakkoset(teksti);
  if (/reverse[ -]charge|kaannetty verovelvoll/.test(koko)) kuitti.kaanteinenAlv = true;
  if (EIEU_MAAT.some((m) => koko.includes(m))) kuitti.alue = 'MUU';
  else if (EU_MAAT.some((m) => koko.includes(m))) kuitti.alue = 'EU';

  return { ok: true, kuitti };
}
