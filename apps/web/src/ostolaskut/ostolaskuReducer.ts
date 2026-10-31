import { type LomakeRivi, type RiviAction, lisaaPaivia } from '@/laskutus/laskuReducer';
import { AlvKoodi, type IsoDate, yleinenAlv } from '@penni/engine';
import { Euro } from '@penni/euro';

/** Ostolomakkeen ALV-valitsimeen rajatut koodit (spec 3.1): kotimaa + käännetty verovelvollisuus. */
export const OSTOKOODIT: readonly number[] = [
  AlvKoodi.EIALV,
  AlvKoodi.OSTOT_NETTO,
  AlvKoodi.YHTEISOHANKINNAT_TAVARAT,
  AlvKoodi.YHTEISOHANKINNAT_PALVELUT,
  AlvKoodi.RAKENNUSPALVELU_OSTO,
];

/** Koko ostolaskulomakkeen tila. Ei maksutapaa (ostolasku avaa aina ostovelan erän);
 *  viite on toimittajan vapaa teksti (ei generointia). Rivit jakavat myyntilomakkeen
 *  LomakeRivi-tyypin (sama TositeRivi-sopimus). */
export interface OstolaskuTila {
  laskupvm: IsoDate;
  erapvm: IsoDate;
  viite: string;
  kumppani?: number;
  alvVelvollinen: boolean;
  rivit: LomakeRivi[]; // aina ≥ 1
}

/** Ostoreducerin aktiot: jaetut riviaktiot (RiviAction) + lomakkeen omat kentät. */
export type OstolaskuAction =
  | RiviAction
  | { type: 'setLaskupvm'; pvm: IsoDate }
  | { type: 'setErapvm'; pvm: IsoDate }
  | { type: 'setViite'; viite: string }
  | { type: 'setKumppani'; kumppani: number | undefined };

let seuraavaAvain = 0;
function uusiAvain(): number {
  seuraavaAvain += 1;
  return seuraavaAvain;
}

/** Uusi tyhjä ostorivi: alv-velvollinen kirja saa OSTOT_NETTO + päivän yleiskannan,
 *  muu kirja EIALV + 0 %. */
function uusiRivi(pvm: IsoDate, alvVelvollinen: boolean): LomakeRivi {
  return {
    avain: uusiAvain(),
    selite: '',
    myyntiKpl: 1,
    aNettoSnt: Euro.fromCents(0),
    alvKoodi: alvVelvollinen ? AlvKoodi.OSTOT_NETTO : AlvKoodi.EIALV,
    alvProsentti: alvVelvollinen ? yleinenAlv(pvm) : 0,
  };
}

export interface OstolaskuAlustus {
  laskupvm: IsoDate;
  alvVelvollinen: boolean;
}

/** Alkutila: eräpäivä +14 pv, tyhjä viite, yksi tyhjä rivi. */
export function alustaOstolaskuTila(alustus: OstolaskuAlustus): OstolaskuTila {
  return {
    laskupvm: alustus.laskupvm,
    erapvm: lisaaPaivia(alustus.laskupvm, 14),
    viite: '',
    alvVelvollinen: alustus.alvVelvollinen,
    rivit: [uusiRivi(alustus.laskupvm, alustus.alvVelvollinen)],
  };
}

export function ostolaskuReducer(tila: OstolaskuTila, action: OstolaskuAction): OstolaskuTila {
  switch (action.type) {
    case 'setLaskupvm':
      return { ...tila, laskupvm: action.pvm };
    case 'setErapvm':
      return { ...tila, erapvm: action.pvm };
    case 'setViite':
      return { ...tila, viite: action.viite };
    case 'setKumppani': {
      const { kumppani: _vanha, ...loput } = tila;
      return action.kumppani === undefined ? loput : { ...loput, kumppani: action.kumppani };
    }
    case 'setRivi':
      return {
        ...tila,
        rivit: tila.rivit.map((r) => (r.avain === action.avain ? { ...r, ...action.muutos } : r)),
      };
    case 'lisaaRivi':
      return { ...tila, rivit: [...tila.rivit, uusiRivi(tila.laskupvm, tila.alvVelvollinen)] };
    case 'poistaRivi': {
      if (tila.rivit.length <= 1)
        return { ...tila, rivit: [uusiRivi(tila.laskupvm, tila.alvVelvollinen)] };
      return { ...tila, rivit: tila.rivit.filter((r) => r.avain !== action.avain) };
    }
  }
}
