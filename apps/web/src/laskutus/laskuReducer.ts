import {
  AlvKoodi,
  type IsoDate,
  Maksutapa,
  type StoredTosite,
  type TositeRivi,
  yleinenAlv,
} from '@penni/engine';
import { type Cents, Euro } from '@penni/euro';

/** Laskurivin lomaketila. À-hinta pidetään SENTTEINÄ (EuroInput-yhteensopiva);
 *  muunnos moottorin euromuotoon tehdään vasta rakennaLaskuSyote-rajalla. */
export interface LomakeRivi {
  avain: number; // paikallinen react-avain
  selite: string;
  myyntiKpl: number; // oletus 1
  aNettoSnt: Cents;
  alvKoodi: number;
  alvProsentti: number;
  /** Kustannuspaikka tai projekti (id ≥ 1); puuttuu = Yleinen. `| undefined`, jotta setRivi
   *  voi tyhjentää valinnan (osittaismuutos ei voi poistaa avainta); vertailu ja
   *  rakennaLaskuSyote pitävät undefinedia puuttuvana. */
  kohdennus?: number | undefined;
  /** Merkkaus-id:t (järjestetty, uniikit); puuttuu tai tyhjä = ei merkkauksia. */
  merkkaukset?: number[] | undefined;
  /** Luonnoksen rivin kentät, joita lomake ei muokkaa (tili, tuote, alennus, yksikkö…):
   *  säilyvät muokkauksen ja tallennuksen läpi. Lomakkeen omat kentät ohittavat nämä. */
  lisat?: Partial<TositeRivi>;
}

/** Koko laskulomakkeen tila. alvVelvollinen kiinnitetään alustuksessa, jotta
 *  lisaaRivi voi johtaa uuden rivin ALV-oletuksen puhtaasti reducerin sisällä. */
export interface LaskuTila {
  laskupvm: IsoDate;
  erapvm: IsoDate; // oletus laskupvm + 14 pv, vapaasti muokattava
  kumppani?: number; // Kumppani.id
  otsikko: string;
  maksutapa: number; // Maksutapa.LASKU (oletus) | KATEINEN | KORTTIMAKSU
  alvVelvollinen: boolean;
  rivit: LomakeRivi[]; // aina ≥ 1
  /** Valinnainen laskutusjakso (spec 3.3); '' = ei täytetty. Molemmat tai ei kumpaakaan. */
  jaksoAlkaa: IsoDate | '';
  jaksoLoppuu: IsoDate | '';
}

/** Laskulomakkeen ALV-valitsimeen rajatut myyntikoodit (spec 3.5). */
export const MYYNTIKOODIT: readonly number[] = [
  AlvKoodi.EIALV,
  AlvKoodi.MYYNNIT_NETTO,
  AlvKoodi.ALV0,
  AlvKoodi.YHTEISOMYYNTI_TAVARAT,
  AlvKoodi.YHTEISOMYYNTI_PALVELUT,
];

let seuraavaAvain = 0;
/** Monotoninen paikallinen riviavain (React-avaimiin; vakaa muokkausten yli). */
function uusiAvain(): number {
  seuraavaAvain += 1;
  return seuraavaAvain;
}

/** ISO-päivä + n päivää (Date.UTC-kokonaislukulaskenta, ei aikavyöhykeriippuvuutta). */
export function lisaaPaivia(iso: IsoDate, paivia: number): IsoDate {
  const v = Number(iso.slice(0, 4));
  const k = Number(iso.slice(5, 7));
  const p = Number(iso.slice(8, 10));
  return new Date(Date.UTC(v, k - 1, p + paivia)).toISOString().slice(0, 10);
}

/** Uusi tyhjä rivi lomakkeen ALV-oletuksilla: alv-velvollinen kirja saa
 *  MYYNNIT_NETTO + päivän yleiskannan, muu kirja EIALV + 0 %. */
function uusiRivi(pvm: IsoDate, alvVelvollinen: boolean): LomakeRivi {
  return {
    avain: uusiAvain(),
    selite: '',
    myyntiKpl: 1,
    aNettoSnt: Euro.fromCents(0),
    alvKoodi: alvVelvollinen ? AlvKoodi.MYYNNIT_NETTO : AlvKoodi.EIALV,
    alvProsentti: alvVelvollinen ? yleinenAlv(pvm) : 0,
  };
}

export interface LaskuAlustus {
  laskupvm: IsoDate;
  alvVelvollinen: boolean;
}

/** Lomakkeen alkutila: eräpäivä +14 pv, maksutapa LASKU, yksi tyhjä rivi. */
export function alustaLaskuTila(alustus: LaskuAlustus): LaskuTila {
  return {
    laskupvm: alustus.laskupvm,
    erapvm: lisaaPaivia(alustus.laskupvm, 14),
    otsikko: '',
    maksutapa: Maksutapa.LASKU,
    alvVelvollinen: alustus.alvVelvollinen,
    rivit: [uusiRivi(alustus.laskupvm, alustus.alvVelvollinen)],
    jaksoAlkaa: '',
    jaksoLoppuu: '',
  };
}

/** Moottorin euromuotoinen à-hinta senteiksi (käänteinen riviTositeRiviksi:lle). */
function hintaSenteiksi(aNetto: number): Cents {
  return Euro.fromCents(Math.round(aNetto * 100));
}

/** Tallennettu rivi → lomakerivi; lomakkeen omien kenttien ulkopuolinen jää `lisat`-kenttään. */
function luonnosriviLomakeriviksi(r: TositeRivi): LomakeRivi {
  const { myyntiKpl, aNetto, alvKoodi, alvProsentti, selite, kohdennus, merkkaukset, ...lisat } = r;
  return {
    avain: uusiAvain(),
    selite: selite ?? '',
    myyntiKpl,
    aNettoSnt: hintaSenteiksi(aNetto),
    alvKoodi,
    alvProsentti,
    ...(kohdennus ? { kohdennus } : {}),
    ...(merkkaukset?.length ? { merkkaukset } : {}),
    ...(Object.keys(lisat).length > 0 ? { lisat } : {}),
  };
}

/**
 * Olemassa oleva luonnos → lomaketila (muokkaustila). Laskupäivä on luonnoksen laskupvm (muuten
 * pvm); puuttuva eräpäivä jää tyhjäksi. Rivi, jonka hinta ei ole kokonaisia senttejä, pyöristyy
 * senttiin lomakkeella.
 */
export function alustaLaskuTilaLuonnoksesta(
  luonnos: StoredTosite,
  alvVelvollinen: boolean,
): LaskuTila {
  const laskupvm = luonnos.laskupvm ?? luonnos.pvm;
  const rivit = (luonnos.rivit ?? []).map(luonnosriviLomakeriviksi);
  return {
    laskupvm,
    erapvm: luonnos.erapvm ?? '',
    ...(luonnos.kumppani !== undefined ? { kumppani: luonnos.kumppani } : {}),
    otsikko: luonnos.otsikko ?? '',
    maksutapa: luonnos.maksutapa ?? Maksutapa.LASKU,
    alvVelvollinen,
    rivit: rivit.length > 0 ? rivit : [uusiRivi(laskupvm, alvVelvollinen)],
    jaksoAlkaa: luonnos.jakso?.alkaa ?? '',
    jaksoLoppuu: luonnos.jakso?.loppuu ?? '',
  };
}

export type LaskuAction =
  | { type: 'setLaskupvm'; pvm: IsoDate }
  | { type: 'setErapvm'; pvm: IsoDate }
  | { type: 'setKumppani'; kumppani: number | undefined }
  | { type: 'setOtsikko'; otsikko: string }
  | { type: 'setMaksutapa'; maksutapa: number }
  | { type: 'setJaksoAlkaa'; pvm: IsoDate | '' }
  | { type: 'setJaksoLoppuu'; pvm: IsoDate | '' }
  | { type: 'setRivi'; avain: number; muutos: Partial<Omit<LomakeRivi, 'avain'>> }
  | { type: 'lisaaRivi' }
  | { type: 'poistaRivi'; avain: number };

export function laskuReducer(tila: LaskuTila, action: LaskuAction): LaskuTila {
  switch (action.type) {
    case 'setLaskupvm':
      return { ...tila, laskupvm: action.pvm };
    case 'setErapvm':
      return { ...tila, erapvm: action.pvm };
    case 'setKumppani': {
      // exactOptionalPropertyTypes: valinnaista kenttää ei aseteta undefined-arvoon,
      // vaan avain jätetään pois kokonaan.
      const { kumppani: _vanha, ...loput } = tila;
      return action.kumppani === undefined ? loput : { ...loput, kumppani: action.kumppani };
    }
    case 'setOtsikko':
      return { ...tila, otsikko: action.otsikko };
    case 'setMaksutapa':
      return { ...tila, maksutapa: action.maksutapa };
    case 'setJaksoAlkaa':
      return { ...tila, jaksoAlkaa: action.pvm };
    case 'setJaksoLoppuu':
      return { ...tila, jaksoLoppuu: action.pvm };
    case 'setRivi':
      return {
        ...tila,
        rivit: tila.rivit.map((r) => (r.avain === action.avain ? { ...r, ...action.muutos } : r)),
      };
    case 'lisaaRivi':
      return { ...tila, rivit: [...tila.rivit, uusiRivi(tila.laskupvm, tila.alvVelvollinen)] };
    case 'poistaRivi': {
      if (tila.rivit.length <= 1) {
        // Lattia 1 rivi (kuten editorin removeRow): viimeisen rivin poisto tyhjentää sen.
        return { ...tila, rivit: [uusiRivi(tila.laskupvm, tila.alvVelvollinen)] };
      }
      return { ...tila, rivit: tila.rivit.filter((r) => r.avain !== action.avain) };
    }
  }
}

/** Riviaktioiden osajoukko, jonka LaskuriviTaulukko tarvitsee — jaettu myynti- ja
 *  ostolomakkeen kesken (osto- ja myyntireducerin action-tyypit sisältävät tämän). */
export type RiviAction = Extract<LaskuAction, { type: 'setRivi' | 'lisaaRivi' | 'poistaRivi' }>;
