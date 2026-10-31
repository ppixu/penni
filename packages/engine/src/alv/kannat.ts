import { type Cents, roundHalfAway } from '@penni/euro';
import type { IsoDate } from '../vouchers/types.js';

/** Yleinen (standard) verokanta % (kirjanpito.cpp:419-425). */
export function yleinenAlv(pvm: IsoDate): number {
  return pvm >= '2024-09-01' ? 25.5 : 24;
}

/** Keskimääräinen (reduced/middle) verokanta % (kirjanpito.cpp:428-434). */
export function keskimainenAlv(pvm: IsoDate): number {
  return pvm >= '2026-01-01' ? 13.5 : 14;
}

/** Alennettu (low) verokanta % — kiinteä 10 %. */
export const ALENNETTU_ALV = 10;

/** Kyseisenä päivänä voimassa olevat verokannat, suurimmasta pienimpään. */
export function alvKannat(pvm: IsoDate): number[] {
  return [yleinenAlv(pvm), keskimainenAlv(pvm), ALENNETTU_ALV];
}

/** Netto bruttosta: round(brutto*100/(100+p)). Yksi pyöristysraja; kokonaissentit. */
export function nettoBrutosta(bruttoSnt: Cents, prosentti: number): Cents {
  if (prosentti === 0) return bruttoSnt;
  return roundHalfAway((bruttoSnt * 100) / (100 + prosentti)) as Cents;
}

/** Veron osuus bruttosta = brutto − netto. */
export function veroBrutosta(bruttoSnt: Cents, prosentti: number): Cents {
  return (bruttoSnt - nettoBrutosta(bruttoSnt, prosentti)) as Cents;
}

/** Brutto netosta: round(netto*(100+p)/100). */
export function bruttoNetosta(nettoSnt: Cents, prosentti: number): Cents {
  if (prosentti === 0) return nettoSnt;
  return roundHalfAway((nettoSnt * (100 + prosentti)) / 100) as Cents;
}
