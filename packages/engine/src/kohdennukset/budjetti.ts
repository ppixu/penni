import type { Cents } from '@penni/euro';
import { Luonne, onko } from '../accounts/luonne.js';
import type { Tili } from '../accounts/tili.js';
import { onkoVastaavaa } from '../resources/saldot.js';
import { ResourceError } from '../resources/storage.js';
import { type Kohdennus, KohdennusTyyppi, YLEINEN_ID, kohdennusSuodatin } from './kohdennus.js';

/**
 * Yksi budjettirivi tilikaudelle (Kitsas Budjetti-taulu, sqlite/luo.sql:45-52): vuosisumma
 * tilille kohdennuksella (0 = Yleinen). Etumerkki kuten saldoissa: kredit − debet
 * (tulot +, menot −). Nollarivejä ei tallenneta.
 */
export interface BudjettiRivi {
  kohdennus: number;
  tili: number;
  sentit: Cents;
}

/** Tulostili budjetille: lehtitili (ei otsikko), numero ≥ '3' merkkijonona eikä vastaavaa
 *  — sama sääntö kuin saldoissa (haeSaldot). */
function onBudjettitili(chart: readonly Tili[], numero: number): boolean {
  if (onkoVastaavaa(numero) || String(numero) < '3') return false;
  return chart.some((t) => t.numero === numero && t.otsikkotaso === 0);
}

/** Rivin ensimmäinen rikottu tallennussääntö; undefined = rivi kelpaa. `nahdyt` kerää
 *  (kohdennus, tili)-avaimet duplikaattitarkistusta varten. */
function budjettiriviVirhe(
  r: BudjettiRivi,
  chart: readonly Tili[],
  kohdennukset: readonly Kohdennus[],
  nahdyt: Set<string>,
): ResourceError | undefined {
  if (!onBudjettitili(chart, r.tili))
    return new ResourceError('BUDJETTITILI', `Tilille ${r.tili} ei voi budjetoida`);
  if (r.kohdennus !== YLEINEN_ID) {
    const k = kohdennukset.find((x) => x.id === r.kohdennus);
    if (k?.tyyppi !== KohdennusTyyppi.KUSTANNUSPAIKKA && k?.tyyppi !== KohdennusTyyppi.PROJEKTI)
      return new ResourceError(
        'BUDJETTIKOHDENNUS',
        `Kohdennukselle ${r.kohdennus} ei voi budjetoida`,
      );
  }
  const avain = `${r.kohdennus}/${r.tili}`;
  if (nahdyt.has(avain))
    return new ResourceError(
      'BUDJETTIDUPLIKAATTI',
      `Tili ${r.tili} on budjetissa kahdesti samalla kohdennuksella`,
    );
  nahdyt.add(avain);
  return undefined;
}

/** Budjetin tallennussäännöt; heittää ResourceErrorin. */
export function validoiBudjetti(
  rivit: readonly BudjettiRivi[],
  chart: readonly Tili[],
  kohdennukset: readonly Kohdennus[],
): void {
  const nahdyt = new Set<string>();
  for (const r of rivit) {
    const virhe = budjettiriviVirhe(r, chart, kohdennukset, nahdyt);
    if (virhe) throw virhe;
  }
}

/**
 * Jaa rivit validoiBudjetin sääntöjen mukaan tallennettaviin ja hylättyihin (esim. poistetun
 * tilin tai merkkaukseksi muuttuneen kohdennuksen rivit, tai tuodut rivit), jotta budjettisivu
 * voi pudottaa rivit, joita se ei näytä, ja kertoa niistä. Duplikaatista hylätään jälkimmäinen.
 */
export function erotteleBudjetoitavat(
  rivit: readonly BudjettiRivi[],
  chart: readonly Tili[],
  kohdennukset: readonly Kohdennus[],
): { kelpaavat: BudjettiRivi[]; hylatyt: BudjettiRivi[] } {
  const nahdyt = new Set<string>();
  const kelpaavat: BudjettiRivi[] = [];
  const hylatyt: BudjettiRivi[] = [];
  for (const r of rivit)
    (budjettiriviVirhe(r, chart, kohdennukset, nahdyt) ? hylatyt : kelpaavat).push(r);
  return { kelpaavat, hylatyt };
}

/**
 * Budjetti tileittäin yhdelle kohdennukselle: kustannuspaikka sisältää projektinsa ja Yleinen
 * Yleisen alla olevat projektit (budjettiroute.cpp:32-39, sama rollup kuin kohdennusSuodatin);
 * undefined = koko budjetti kaikilta kohdennuksilta (:50-56). Merkkauksilla ei ole budjettia.
 */
export function budjettiKohdennukselle(
  rivit: readonly BudjettiRivi[],
  kaikki: readonly Kohdennus[],
  kohdennus?: number,
): Map<number, Cents> {
  let mukana: (r: BudjettiRivi) => boolean = () => true;
  if (kohdennus !== undefined) {
    const joukko = new Set(kohdennusSuodatin(kaikki, kohdennus).kohdennukset ?? []);
    mukana = (r) => joukko.has(r.kohdennus);
  }
  const out = new Map<number, Cents>();
  for (const r of rivit) {
    if (!mukana(r)) continue;
    out.set(r.tili, ((out.get(r.tili) ?? 0) + r.sentit) as Cents);
  }
  return out;
}

/**
 * Tallennettu etumerkki (kredit − debet) <-> tilin luonnollinen suunta: tulotilit (TULO) sellaisenaan,
 * muut käännettyinä, jotta menot syötetään ja näytetään positiivisina. Oma käänteisfunktionsa.
 */
export function luonnollinenEtumerkki(tili: Tili | undefined, sentit: Cents): Cents {
  if (tili && onko(tili.luonne, Luonne.TULO)) return sentit;
  return (-sentit || 0) as Cents; // `|| 0` siivoaa −0:n
}

/**
 * Toteutuma prosentin sadasosina (12000 = 120,00 %), puolikkaat nollasta poispäin, pelkin
 * kokonaislukuoperaatioin. undefined kun budjetti on 0 (Kitsas jättää tyhjäksi,
 * laatijantasetulos.cpp:359-370).
 */
export function toteumaProsentti(toteutunut: Cents, budjetti: Cents): number | undefined {
  if (budjetti === 0) return undefined;
  const osoittaja = Math.abs(toteutunut) * 10000;
  const nimittaja = Math.abs(budjetti);
  const jaannos = osoittaja % nimittaja; // tarkka kokonaisluvuilla
  let osamaara = (osoittaja - jaannos) / nimittaja; // jaollinen => tarkka
  if (jaannos * 2 >= nimittaja) osamaara += 1;
  const negatiivinen = toteutunut < 0 !== budjetti < 0;
  return negatiivinen && osamaara !== 0 ? -osamaara : osamaara;
}
