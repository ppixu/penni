import { kohdennustenRyhmat } from '@/kohdennukset/kohdennusTeksti';
import { vertaaTilinumeroita } from '@/tilikartta/tilinakyma';
import {
  type BudjettiRivi,
  type IsoDate,
  type Kohdennus,
  Luonne,
  type Tili,
  type Tilikausi,
  edellinenPaiva,
  luonnollinenEtumerkki,
  nimi,
  onVoimassaValilla,
  onko,
} from '@penni/engine';
import type { Cents } from '@penni/euro';

/** Budjettisivun rivi: otsikko (ei muokattava) tai tili luvuineen. `sentit`/`edellinen`
 *  tallennetussa etumerkissä (kredit − debet). */
export interface BudjettiTaulukkoRivi {
  tili?: Tili;
  otsikko?: { teksti: string; taso: number };
  edellinen: Cents;
  sentit: Cents;
}

/** Tulosotsikko tai -tili: numero merkkijonona ≥ '3' (Kitsas `^[3-9]`, budjettimodel.cpp:35). */
function onTulospuolta(t: Tili): boolean {
  return String(t.numero) >= '3';
}

/** Kitsaksen tilijärjestys; samassa kohdassa otsikko ennen tiliä ja ylempi otsikko ensin. */
function vertaaKartanRiveja(a: Tili, b: Tili): number {
  const ota = (t: Tili) => (t.otsikkotaso === 0 ? Number.POSITIVE_INFINITY : t.otsikkotaso);
  return vertaaTilinumeroita(a.numero, b.numero) || ota(a) - ota(b);
}

function summatTileittain(rivit: readonly BudjettiRivi[], kohdennus: number): Map<number, Cents> {
  const out = new Map<number, Cents>();
  for (const r of rivit) if (r.kohdennus === kohdennus) out.set(r.tili, r.sentit);
  return out;
}

/**
 * Kartan tulostilit otsikoidensa alla yhdelle kohdennukselle. Otsikko näytetään vain, jos sen
 * alla on tili (avoinna olevat otsikot pinossa: uusi otsikko sulkee samantasoiset ja alemmat).
 */
export function rakennaBudjettiTaulukko(
  chart: readonly Tili[],
  nykyinen: readonly BudjettiRivi[],
  edellinen: readonly BudjettiRivi[],
  kohdennus: number,
): BudjettiTaulukkoRivi[] {
  const nyt = summatTileittain(nykyinen, kohdennus);
  const ennen = summatTileittain(edellinen, kohdennus);
  const out: BudjettiTaulukkoRivi[] = [];
  const avoimet: { otsikko: Tili; naytetty: boolean }[] = [];
  for (const t of [...chart].filter(onTulospuolta).sort(vertaaKartanRiveja)) {
    if (t.otsikkotaso > 0) {
      while ((avoimet.at(-1)?.otsikko.otsikkotaso ?? 0) >= t.otsikkotaso) avoimet.pop();
      avoimet.push({ otsikko: t, naytetty: false });
      continue;
    }
    for (const a of avoimet) {
      if (a.naytetty) continue;
      a.naytetty = true;
      out.push({
        otsikko: { teksti: nimi(a.otsikko), taso: a.otsikko.otsikkotaso },
        edellinen: 0 as Cents,
        sentit: 0 as Cents,
      });
    }
    out.push({
      tili: t,
      edellinen: ennen.get(t.numero) ?? (0 as Cents),
      sentit: nyt.get(t.numero) ?? (0 as Cents),
    });
  }
  return out;
}

/**
 * Tilikartta-sivun piilotussääntö (asetus "piilotilit"): piilotettu lehtitili jää pois, ellei
 * sillä ole budjettia (`budjetoidut`), jottei olemassa oleva luku katoa näkyvistä.
 */
export function naytettavatTilit(
  chart: readonly Tili[],
  piilotetut: ReadonlySet<number>,
  budjetoidut: readonly BudjettiRivi[],
): Tili[] {
  const kaytossa = new Set(budjetoidut.map((r) => r.tili));
  return chart.filter(
    (t) => t.otsikkotaso > 0 || !piilotetut.has(t.numero) || kaytossa.has(t.numero),
  );
}

/** Yhteissummat: tulot ja menot luonnollisessa suunnassa (positiivisina), tulos = Σ sentit. */
export function budjettiYhteenveto(
  rivit: readonly BudjettiRivi[],
  chart: readonly Tili[],
): { tulot: Cents; menot: Cents; tulos: Cents } {
  const tilit = new Map(chart.filter((t) => t.otsikkotaso === 0).map((t) => [t.numero, t]));
  let tulot = 0;
  let menot = 0;
  for (const r of rivit) {
    const tili = tilit.get(r.tili);
    if (tili && onko(tili.luonne, Luonne.TULO)) tulot += r.sentit;
    else menot += luonnollinenEtumerkki(tili, r.sentit);
  }
  return { tulot: tulot as Cents, menot: menot as Cents, tulos: (tulot - menot) as Cents };
}

/** Aseta yhden kohdennuksen tilin summa; 0 poistaa rivin (nollia ei tallenneta). */
export function asetaBudjetti(
  rivit: readonly BudjettiRivi[],
  kohdennus: number,
  tili: number,
  sentit: Cents,
): BudjettiRivi[] {
  const muut = rivit.filter((r) => r.kohdennus !== kohdennus || r.tili !== tili);
  return sentit === 0 ? muut : [...muut, { kohdennus, tili, sentit }];
}

/** Muutosseurannan projektio: rivit (kohdennus, tili)-järjestyksessä. */
export function budjettiVertailuun(rivit: readonly BudjettiRivi[]): BudjettiRivi[] {
  return [...rivit].sort((a, b) => a.kohdennus - b.kohdennus || a.tili - b.tili);
}

/**
 * Edellisen tilikauden budjetti uudelle kaudelle kaikille kohdennuksille; ohittaa kohdennukset,
 * jotka päättyivät ennen uuden kauden alkua (Kitsas budjettimodel.cpp:220-237).
 */
export function kopioiEdellinen(
  edellinen: readonly BudjettiRivi[],
  kohdennukset: readonly Kohdennus[],
  uusiAlkaa: IsoDate,
): BudjettiRivi[] {
  const paattyneet = new Set(
    kohdennukset.filter((k) => k.paattyy && k.paattyy < uusiAlkaa).map((k) => k.id),
  );
  return edellinen.filter((r) => !paattyneet.has(r.kohdennus)).map((r) => ({ ...r }));
}

/** Oletuskausi: kausi, jolla tänään on, muuten viimeisin. `kaudet` alkaa-järjestyksessä. */
export function oletusTilikausi(
  kaudet: readonly Tilikausi[],
  tanaan: IsoDate,
): Tilikausi | undefined {
  return kaudet.find((k) => k.alkaa <= tanaan && tanaan <= k.loppuu) ?? kaudet.at(-1);
}

/** Edellinen tilikausi: se, joka päättyy kauden alkua edeltävänä päivänä. */
export function edellinenTilikausi(
  kaudet: readonly Tilikausi[],
  kausi: Tilikausi,
): Tilikausi | undefined {
  const loppu = edellinenPaiva(kausi.alkaa);
  return kaudet.find((k) => k.loppuu === loppu);
}

/**
 * Kohdennusvalinnan vaihtoehdot Yleisen perään: kustannuspaikat projekteineen ja Yleisen alla
 * olevat projektit, jotka ovat voimassa kaudella tai joilla on jo budjettia (Kitsas
 * budjettikohdennusproxy.cpp:35-55; merkkauksilla ei ole budjettia).
 */
export function budjetoitavatKohdennukset<K extends Kohdennus>(
  kaikki: readonly K[],
  kausi: Tilikausi,
  rivit: readonly BudjettiRivi[],
): K[] {
  const budjetoidut = new Set(rivit.map((r) => r.kohdennus));
  const mukana = (k: K) => budjetoidut.has(k.id) || onVoimassaValilla(k, kausi.alkaa, kausi.loppuu);
  const ryhmat = kohdennustenRyhmat(kaikki);
  return [
    ...ryhmat.kustannuspaikat.flatMap((r) => [r.kustannuspaikka, ...r.projektit]),
    ...ryhmat.yleiset,
  ].filter(mukana);
}
