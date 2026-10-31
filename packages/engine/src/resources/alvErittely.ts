import type { Cents } from '@penni/euro';
import { Luonne } from '../accounts/luonne.js';
import { tiliTyypilla } from '../accounts/tili.js';
import { AlvKoodi, debetistaKoodilla, veroTyyppi } from '../alv/koodit.js';
import { TositeTyyppi } from '../vouchers/enums.js';
import type { IsoDate, TositeVienti } from '../vouchers/types.js';
import {
  type AlvLaskelmaParams,
  bruttoOikaisuSelite,
  laskeBruttoOikaisut,
  oikaisunVerokoodi,
} from './alvLaskelma.js';
import type { Storage } from './storage.js';

/** Yksi alv-laskelman erittelyn rivi (Kitsas kirjoitaErittely, alvlaskelma.cpp:405-432). */
export interface AlvErittelyRivi {
  alvKoodi: number;
  /** Verokanta prosentin sadasosina (25,5 % -> 2550), kuten KoodiTaulu::lisaa (:1138). */
  kanta: number;
  tili: number;
  /** Viennin päivä — kausirajaus ja Pvm-sarake. */
  pvm: IsoDate;
  /** Tositteen id; puuttuu bruttokirjausten oikaisuriviltä (laskennallinen, ei tositetta). */
  tosite?: number;
  /** `${sarja} ${tunniste}`.trim(); '' oikaisurivillä. */
  tositeNumero: string;
  /** Tositteen päivä; oikaisurivillä kauden loppupvm. */
  tositePvm: IsoDate;
  /** Tositteen kumppanin nimi tai ''. */
  kumppani: string;
  /** Viennin selite, muuten tositteen otsikko, muuten ''. */
  selite: string;
  /** debetistaKoodilla(alvKoodi) ? debet − kredit : kredit − debet (alvlaskelma.cpp:426-429). */
  summa: Cents;
}

export interface AlvErittely {
  alkupvm: IsoDate;
  loppupvm: IsoDate;
  /** Järjestys: koodi, kanta, tili, oikaisurivit viimeisinä, vientipäivä, sarja, numero, rivi. */
  rivit: AlvErittelyRivi[];
}

export interface AlvErittelyTili {
  tili: number;
  rivit: AlvErittelyRivi[];
  summa: Cents;
}

export interface AlvErittelyRyhma {
  alvKoodi: number;
  kanta: number;
  nimi: string;
  summa: Cents;
  tilit: AlvErittelyTili[];
}

interface Lajiteltava {
  rivi: AlvErittelyRivi;
  oikaisu: 0 | 1;
  sarja: string;
  tunniste: number;
  indeksi: number;
}

const vertaa = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Kauden alv-erittely: kirjattujen (tila >= 100) tositteiden alv-koodatut viennit
 * vientipäivän mukaan rajattuna (sama peruste kuin haeAlvLaskelma), ALVLASKELMA-tositteet
 * pois (Kitsas viennitSaapuu, alvlaskelma.cpp:701-712), sekä bruttokirjausten oikaisurivit
 * (viimeistele -> oikaiseBruttoKirjaukset, :873-881, :1014-1103) kauden loppupäivälle.
 * Puhdas luku olemassa olevilla Storage-metodeilla.
 */
export async function haeAlvErittely(
  storage: Storage,
  params: AlvLaskelmaParams,
): Promise<AlvErittely> {
  const tositteet = await storage.listTositteet({ bucket: 'kirjanpidossa' });
  const kumppanit = new Map((await storage.getKumppanit()).map((k) => [k.id, k.nimi]));
  const chart = await storage.getChart();

  const kauden: TositeVienti[] = [];
  const lajiteltavat: Lajiteltava[] = [];
  for (const t of tositteet) {
    if (t.tyyppi === TositeTyyppi.ALVLASKELMA) continue;
    const kumppani = t.kumppani != null ? (kumppanit.get(t.kumppani) ?? '') : '';
    const tositeNumero = `${t.sarja} ${t.tunniste}`.trim();
    t.viennit.forEach((v, indeksi) => {
      if (!v.alvKoodi) return; // EIALV (AlvTaulu::lisaa, :1114)
      if (v.pvm < params.alkupvm || v.pvm > params.loppupvm) return;
      kauden.push(v);
      lajiteltavat.push({
        rivi: {
          alvKoodi: v.alvKoodi,
          kanta: Math.round(v.alvProsentti * 100),
          tili: v.tili,
          pvm: v.pvm,
          tosite: t.id,
          tositeNumero,
          tositePvm: t.pvm,
          kumppani,
          selite: v.selite || t.otsikko || '',
          summa: (debetistaKoodilla(v.alvKoodi) ? v.debet - v.kredit : v.kredit - v.debet) as Cents,
        },
        oikaisu: 0,
        sarja: t.sarja,
        tunniste: t.tunniste,
        indeksi,
      });
    });
  }

  // Oikaisurivit: perusrivi −vero tulo-/menotilille, verorivi +vero alv-velalle/-saatavalle
  // (Kitsasin kirjaamat oikaisuviennit etumerkkisäännöllä, :1036-1056, :1080-1100).
  // Puuttuva alv-tili -> 0, kuten Kitsasin tiliTyypilla(...).numero().
  const alvVelka = tiliTyypilla(chart, Luonne.ALVVELKA)?.numero ?? 0;
  const alvSaatava = tiliTyypilla(chart, Luonne.ALVSAATAVA)?.numero ?? 0;
  for (const o of laskeBruttoOikaisut(kauden)) {
    if (o.vero === 0) continue; // kuten bruttoOikaisuViennit
    const yhteiset = {
      kanta: o.kanta,
      pvm: params.loppupvm,
      tositeNumero: '',
      tositePvm: params.loppupvm,
      kumppani: '',
      selite: bruttoOikaisuSelite(o, chart),
    };
    const alvTili = o.alvKoodi === AlvKoodi.MYYNNIT_BRUTTO ? alvVelka : alvSaatava;
    lajiteltavat.push({
      rivi: { ...yhteiset, alvKoodi: o.alvKoodi, tili: o.tili, summa: -o.vero as Cents },
      oikaisu: 1,
      sarja: '',
      tunniste: 0,
      indeksi: 0,
    });
    lajiteltavat.push({
      rivi: { ...yhteiset, alvKoodi: oikaisunVerokoodi(o), tili: alvTili, summa: o.vero },
      oikaisu: 1,
      sarja: '',
      tunniste: 0,
      indeksi: 1,
    });
  }

  // Kitsasin QMap-järjestys (koodi, kanta, tili) ja /viennit-järjestys tilin sisällä
  // (Vienti.pvm, Tosite.sarja, Tosite.tunniste, Vienti.rivi, viennitroute.cpp:82).
  lajiteltavat.sort(
    (a, b) =>
      a.rivi.alvKoodi - b.rivi.alvKoodi ||
      a.rivi.kanta - b.rivi.kanta ||
      a.rivi.tili - b.rivi.tili ||
      a.oikaisu - b.oikaisu ||
      vertaa(a.rivi.pvm, b.rivi.pvm) ||
      vertaa(a.sarja, b.sarja) ||
      a.tunniste - b.tunniste ||
      a.indeksi - b.indeksi,
  );
  return {
    alkupvm: params.alkupvm,
    loppupvm: params.loppupvm,
    rivit: lajiteltavat.map((l) => l.rivi),
  };
}

/** Kitsasin nimet tyypeille, joita Penni ei tarjoa valittaviksi (verotyyppimodel.cpp:35-36, :54). */
const LISANIMET: ReadonlyMap<number, string> = new Map([
  [AlvKoodi.MAKSUPERUSTEINEN_MYYNTI, 'Verollinen myynti (maksuperusteinen alv)'],
  [AlvKoodi.MAKSUPERUSTEINEN_OSTO, 'Verollinen osto (maksuperusteinen alv)'],
  [AlvKoodi.VAHENNYSKELVOTON, 'Vähennyskelvottoman oston veron osuus'],
]);

function perusnimi(koodi: number): string | undefined {
  return veroTyyppi(koodi)?.selite ?? LISANIMET.get(koodi);
}

/**
 * Erittelyn ryhmäotsikko, VerotyyppiModel::yhdistelmaSeliteKoodilla (verotyyppimodel.cpp:95-105):
 * 1xx "VERON MÄÄRÄ ", 2xx "VÄHENNYKSEN MÄÄRÄ ", 4xx "KOHDENTAMATON MAKSUPERUSTEINEN " +
 * koodin % 100 nimi, muuten koodin oma nimi. Tuntematon nimi -> "ALV-koodi <n>".
 */
export function erittelyRyhmanNimi(alvKoodi: number): string {
  const sadat = Math.floor(alvKoodi / 100);
  const etuliite =
    sadat === 1
      ? 'VERON MÄÄRÄ '
      : sadat === 2
        ? 'VÄHENNYKSEN MÄÄRÄ '
        : sadat === 4
          ? 'KOHDENTAMATON MAKSUPERUSTEINEN '
          : '';
  const perus = etuliite ? perusnimi(alvKoodi % 100) : perusnimi(alvKoodi);
  return perus === undefined ? `ALV-koodi ${alvKoodi}` : `${etuliite}${perus}`;
}

/**
 * Ryhmittele erittelyn rivit Kitsasin tapaan: (koodi, kanta) nousevasti, ryhmän sisällä tilit
 * nousevasti, tilin sisällä syötteen järjestys (alvlaskelma.cpp:379-440). Summat sentteinä.
 */
export function ryhmitteleAlvErittely(rivit: readonly AlvErittelyRivi[]): AlvErittelyRyhma[] {
  const ryhmat = new Map<string, AlvErittelyRyhma>();
  for (const r of rivit) {
    const avain = `${r.alvKoodi}:${r.kanta}`;
    let ryhma = ryhmat.get(avain);
    if (!ryhma) {
      ryhma = {
        alvKoodi: r.alvKoodi,
        kanta: r.kanta,
        nimi: erittelyRyhmanNimi(r.alvKoodi),
        summa: 0 as Cents,
        tilit: [],
      };
      ryhmat.set(avain, ryhma);
    }
    let tili = ryhma.tilit.find((t) => t.tili === r.tili);
    if (!tili) {
      tili = { tili: r.tili, rivit: [], summa: 0 as Cents };
      ryhma.tilit.push(tili);
    }
    tili.rivit.push(r);
    tili.summa = (tili.summa + r.summa) as Cents;
    ryhma.summa = (ryhma.summa + r.summa) as Cents;
  }
  const tulos = [...ryhmat.values()].sort((a, b) => a.alvKoodi - b.alvKoodi || a.kanta - b.kanta);
  for (const ryhma of tulos) ryhma.tilit.sort((a, b) => a.tili - b.tili);
  return tulos;
}
