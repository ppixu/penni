import type { IsoDate } from '@penni/engine';

/** Raporttisivun yhteiset valinnat, jotka jokainen raporttinäkymä saa. */
export interface RaporttiProps {
  /** Valitun tilikauden alku ja loppu (molemmat mukaan lukien). */
  alkupvm: IsoDate;
  loppupvm: IsoDate;
  /** Tase-/tuloslaskelmakaava (asetusavain, esim. 'tulos/yleinen'); vain kaavaraporteille. */
  muoto?: string;
  /** "Näytä tilit": kaavaraporttien tilikohtaiset erittelyrivit. */
  naytaTilit: boolean;
  /** Pääkirjan rajaus yhteen tiliin tai tiliryhmään (tilikartan riviltä). */
  tilirajaus?: Tilirajaus;
}

/** Yksi tili tai tiliryhmä etuliitteenä ("11" = tilit 1100–1199 ja esim. 11xxx). */
export type Tilirajaus = { tili: number } | { tiliryhma: string };
