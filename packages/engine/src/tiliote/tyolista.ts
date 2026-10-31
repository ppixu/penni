import type { Cents } from '@penni/euro';
import type { StoredTosite } from '../resources/storage.js';
import type { IsoDate } from '../vouchers/types.js';
import type { KirjausEhdotus } from './ehdotaKirjaus.js';
import { normalisoiNimi } from './nimi.js';
import type { Tilitapahtuma } from './poimiTiliote.js';
import type { Kuittilahde, TapahtumaTulos, TasmaysRaportti } from './tasmaytaTiliote.js';

/**
 * Täsmäytyksen työlista: tiliotteen rivit kirjausta varten. Puhdas logiikka, jota käyttävät
 * sekä työpöydän Täsmäytys-näkymä (apps/web) että agenttirajapinnan `tiliote`-komento.
 */
export type TyolistaTila = 'valmis' | 'nimitasmays' | 'kuittiPuuttuu' | 'omaPaaoma' | 'joKirjattu';

export interface TyolistaRivi {
  /** Vakaa avain: pvm + juokseva numero, kestää uudelleentäsmäytyksen. */
  avain: string;
  tapahtuma: Tilitapahtuma;
  kuitti?: Kuittilahde;
  tila: TyolistaTila;
  /** Käyttäjän valitsema tai historiasta ehdotettu kirjaustili; puuttuessa moottori päättelee sen. */
  tili?: number;
  /**
   * Kirjaushistorian ehdotus (tili, alv, otsikko). Alv ja otsikko käytetään vain niin kauan kuin
   * rivin tili on ehdotuksen tili — käsin vaihdettu tili ohittaa ehdotuksen kokonaan.
   */
  ehdotus?: KirjausEhdotus;
  valittu: boolean;
  /** Kirjatun tositteen tunniste, kun tila = 'joKirjattu'. */
  kirjattuTunniste?: string;
}

/** Pankkitilin rivi kirjassa: päivä, etumerkillinen määrä, ja tositteen tunniste näyttöä varten. */
export interface KirjattuRivi {
  pvm: IsoDate;
  maara: Cents;
  tunniste: string;
}

const LUOKKA_TILA: Record<string, TyolistaTila> = {
  tasmays: 'valmis',
  nimitasmays: 'nimitasmays',
  kuittiPuuttuu: 'kuittiPuuttuu',
  omaPaaoma: 'omaPaaoma',
};

/**
 * Poimii kirjasta pankkitiliä koskettavat rivit. Luonnokset lasketaan mukaan, jotta
 * keskeytynyttä erää ei kirjata kahteen kertaan.
 */
export function poimiKirjatut(
  tositteet: readonly StoredTosite[],
  pankkitili: number,
): KirjattuRivi[] {
  const rivit: KirjattuRivi[] = [];
  for (const tosite of tositteet) {
    for (const vienti of tosite.viennit) {
      if (vienti.tili !== pankkitili) continue;
      const maara = (vienti.debet - vienti.kredit) as Cents;
      if (maara === 0) continue;
      rivit.push({
        pvm: vienti.pvm,
        maara,
        tunniste: `${vienti.pvm.slice(0, 4)}-${tosite.tunniste}`,
      });
    }
  }
  return rivit;
}

/** Päivänumero (päivää epookista) ISO-päiväykselle; päiväerojen laskentaan. */
function paivanumero(iso: IsoDate): number {
  const [v, kk, d] = iso.split('-').map((x) => Number.parseInt(x, 10));
  return Math.round(Date.UTC(v ?? 0, (kk ?? 1) - 1, d ?? 1) / 86_400_000);
}

/** ISO-päiväys siirrettynä `paivia` päivällä (negatiivinen = taaksepäin). */
export function siirraPaivia(iso: IsoDate, paivia: number): IsoDate {
  return new Date((paivanumero(iso) + paivia) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Sallittu päiväero tiliotteen rivin ja kirjatun pankkiviennin välillä. Kirjaus-, arvo- ja
 * maksupäivä eroavat korttiostoissa usein päivän tai kaksi, ja aiemmin (esim. Kitsasissa)
 * kirjattu tosite voi olla millä tahansa niistä.
 */
export const KIRJATTU_PVM_VARA = 2;

export interface TyolistaOptiot {
  /** Kirjaushistorian ehdotus riville; `undefined` = ei ehdotusta (moottori päättelee tilin). */
  ehdota?: (tulos: TapahtumaTulos) => KirjausEhdotus | undefined;
}

/**
 * Rakentaa työlistan täsmäytysraportista ja merkitsee jo kirjatut rivit.
 *
 * Kirjattujen tunnistus on **lukumääräperustainen**, ei totuusarvoinen: kukin kirjattu
 * pankkivienti kelpaa vain yhdelle tiliotteen riville. Jos kirjassa on n samansuuruista
 * vientiä ja tiliotteella m, vain min(n, m) merkitään kirjatuiksi — muuten kaksi aitoa
 * samansuuruista veloitusta (esim. sama tilaus kahdesti) kutistuisi yhdeksi ja toinen jäisi
 * ikuisesti kirjaamatta. Summan on täsmättävä tarkasti, päiväys saa poiketa enintään
 * `KIRJATTU_PVM_VARA` päivää; lähimmät päiväykset paritetaan ensin, jottei viereinen
 * samansuuruinen rivi vie tarkan päiväosuman vientiä.
 */
export function rakennaTyolista(
  raportti: TasmaysRaportti,
  kirjatut: readonly KirjattuRivi[],
  optiot: TyolistaOptiot = {},
): TyolistaRivi[] {
  const parit: { ti: number; ki: number; ero: number }[] = [];
  raportti.tapahtumat.forEach(({ tapahtuma }, ti) => {
    const paiva = paivanumero(tapahtuma.pvm);
    kirjatut.forEach((k, ki) => {
      const ero = Math.abs(paivanumero(k.pvm) - paiva);
      if (k.maara === tapahtuma.maara && ero <= KIRJATTU_PVM_VARA) parit.push({ ti, ki, ero });
    });
  });
  parit.sort((a, b) => a.ero - b.ero || a.ti - b.ti || a.ki - b.ki);
  const kirjattuRivilla = new Map<number, KirjattuRivi>();
  const kaytetyt = new Set<number>();
  for (const p of parit) {
    if (kirjattuRivilla.has(p.ti) || kaytetyt.has(p.ki)) continue;
    const k = kirjatut[p.ki];
    if (!k) continue;
    kaytetyt.add(p.ki);
    kirjattuRivilla.set(p.ti, k);
  }

  return raportti.tapahtumat.map((tulos, i) => {
    const { tapahtuma } = tulos;
    const kirjattu = kirjattuRivilla.get(i);
    const tila: TyolistaTila = kirjattu
      ? 'joKirjattu'
      : (LUOKKA_TILA[tulos.luokka] ?? 'kuittiPuuttuu');
    const rivi: TyolistaRivi = {
      avain: `${tapahtuma.pvm}#${i}`,
      tapahtuma,
      tila,
      // omaPaaoma ei koskaan valikoidu automaattisesti: yksi "Kirjaa valitut" -klikkaus ei saa
      // kirjata omistajan yksityisottoja/-sijoituksia tavallisina menoina piilossa olevasta
      // ryhmästä, jota käyttäjä ei ole avannut (omistajan ruling, task 7 -katselmointi).
      valittu: kirjattu === undefined && tila !== 'omaPaaoma',
    };
    if (tulos.kuitti) rivi.kuitti = tulos.kuitti;
    if (kirjattu) rivi.kirjattuTunniste = kirjattu.tunniste;
    const ehdotus = kirjattu ? undefined : optiot.ehdota?.(tulos);
    if (ehdotus) {
      rivi.ehdotus = ehdotus;
      rivi.tili = ehdotus.tili;
    }
    return rivi;
  });
}

/**
 * Muut kirjaamattomat rivit, joilla on sama (normalisoitu) pankkinimi kuin rivillä `avainArvo`
 * mutta eri tili — "sama tili kaikille samannimisille" -toiminnon kohteet.
 */
export function samannimiset(rivit: readonly TyolistaRivi[], avainArvo: string): TyolistaRivi[] {
  const lahde = rivit.find((r) => r.avain === avainArvo);
  if (!lahde) return [];
  const nimi = normalisoiNimi(lahde.tapahtuma.nimi);
  return rivit.filter(
    (r) =>
      r.avain !== lahde.avain &&
      r.tila !== 'joKirjattu' &&
      r.tili !== lahde.tili &&
      normalisoiNimi(r.tapahtuma.nimi) === nimi,
  );
}

/**
 * Kopioi rivin tilin (ja sen mukana historian ehdotuksen) kaikille samannimisille
 * kirjaamattomille riveille ja valitsee ne kirjattaviksi. Kuitillisen rivin alv-erittely
 * tulee edelleen kuitilta; kuittittomalle riville kopioituu lähderivin ehdotus vain, jos
 * lähderivin tili on ehdotuksen tili.
 */
export function asetaTiliSamannimisille(
  rivit: readonly TyolistaRivi[],
  avainArvo: string,
): TyolistaRivi[] {
  const lahde = rivit.find((r) => r.avain === avainArvo);
  const tili = lahde?.tili;
  if (!lahde || tili === undefined) return [...rivit];
  const kohteet = new Set(samannimiset(rivit, avainArvo).map((r) => r.avain));
  const ehdotus = lahde.ehdotus?.tili === tili ? lahde.ehdotus : undefined;
  return rivit.map((r) => {
    if (!kohteet.has(r.avain)) return r;
    const { ehdotus: _vanha, ...loput } = r;
    const uusi: TyolistaRivi = { ...loput, tili, valittu: true };
    if (ehdotus) uusi.ehdotus = ehdotus;
    return uusi;
  });
}

/** Muuttaa yhtä riviä; palauttaa uuden listan (immutable, React-ystävällinen). */
export function paivitaRivi(
  rivit: readonly TyolistaRivi[],
  avainArvo: string,
  muutos: Partial<Pick<TyolistaRivi, 'tili' | 'valittu' | 'kuitti' | 'tila'>>,
): TyolistaRivi[] {
  return rivit.map((r) => (r.avain === avainArvo ? { ...r, ...muutos } : r));
}

/** Työlistan rivit ja tapahtumaan liittämättömät kuitit yhdessä — liitos siirtää kuitin välillä. */
export interface TyolistaJaKuitit {
  rivit: TyolistaRivi[];
  kuitit: Kuittilahde[];
}

/**
 * Tapahtumaan liittämättömät kuitit rivin ehdokkaiksi järjestettynä: lähin bruttosumma
 * (itseisarvona, koska kuitin summa on positiivinen ja veloitus negatiivinen) ensin, tasatilanteessa
 * lähin päiväys. Kuitit ilman summaa tai päiväystä jäävät vastaavasti loppuun.
 */
export function kuittiEhdokkaat(rivi: TyolistaRivi, kuitit: readonly Kuittilahde[]): Kuittilahde[] {
  const maara = Math.abs(rivi.tapahtuma.maara);
  const paiva = paivanumero(rivi.tapahtuma.pvm);
  const summaEro = (k: Kuittilahde) =>
    k.kuitti.bruttoSumma === undefined
      ? Number.POSITIVE_INFINITY
      : Math.abs(Math.abs(k.kuitti.bruttoSumma) - maara);
  const paivaEro = (k: Kuittilahde) =>
    k.kuitti.pvm === undefined
      ? Number.POSITIVE_INFINITY
      : Math.abs(paivanumero(k.kuitti.pvm) - paiva);
  return [...kuitit].sort((a, b) => summaEro(a) - summaEro(b) || paivaEro(a) - paivaEro(b));
}

/**
 * Liittää käyttäjän valitseman kuitin (tiedostopolku) riville: rivi on sen jälkeen valmis ja
 * valittu kirjattavaksi, ja kuitti poistuu liittämättömistä. Rivin aiempi kuitti palaa
 * liittämättömiin. Tuntematon rivi tai kuitti = ei muutosta.
 */
export function liitaKuitti(
  rivit: readonly TyolistaRivi[],
  kuitit: readonly Kuittilahde[],
  avainArvo: string,
  tiedosto: string,
): TyolistaJaKuitit {
  const rivi = rivit.find((r) => r.avain === avainArvo);
  const kuitti = kuitit.find((k) => k.tiedosto === tiedosto);
  if (!rivi || !kuitti) return { rivit: [...rivit], kuitit: [...kuitit] };
  const loput = kuitit.filter((k) => k !== kuitti);
  return {
    rivit: paivitaRivi(rivit, avainArvo, { kuitti, tila: 'valmis', valittu: true }),
    kuitit: rivi.kuitti ? [...loput, rivi.kuitti] : loput,
  };
}

/** Irrottaa rivin kuitin takaisin liittämättömiin; rivi palaa "kuitti puuttuu" -tilaan. */
export function irrotaKuitti(
  rivit: readonly TyolistaRivi[],
  kuitit: readonly Kuittilahde[],
  avainArvo: string,
): TyolistaJaKuitit {
  const rivi = rivit.find((r) => r.avain === avainArvo);
  if (!rivi?.kuitti) return { rivit: [...rivit], kuitit: [...kuitit] };
  const { kuitti, ...ilman } = rivi;
  return {
    rivit: rivit.map((r) => (r === rivi ? { ...ilman, tila: 'kuittiPuuttuu' } : r)),
    kuitit: [...kuitit, kuitti],
  };
}
