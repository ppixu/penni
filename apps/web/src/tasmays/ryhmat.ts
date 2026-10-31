import type { TyolistaTila } from '@penni/engine';

/** Työlistan ryhmät näyttöjärjestyksessä otsikkoineen (työlistan logiikka: @penni/engine). */
export const RYHMAT: { tila: TyolistaTila; otsikko: string }[] = [
  { tila: 'nimitasmays', otsikko: 'Summa ei täsmää' },
  { tila: 'kuittiPuuttuu', otsikko: 'Kuitti puuttuu' },
  { tila: 'valmis', otsikko: 'Valmiina kirjattavaksi' },
  { tila: 'joKirjattu', otsikko: 'Jo kirjattu' },
  { tila: 'omaPaaoma', otsikko: 'Oma pääoma' },
];
