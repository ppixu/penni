import type { Kuitti } from './kuitti.js';

/** Sallitut kotimaan ALV-kannat (%). Pehmeä signaali, ei estävä. */
export const SALLITUT_KANNAT: readonly number[] = [25.5, 24, 14, 10, 0];

/** Sallittu senttipyöristysvara täsmäytyksessä. */
const TOLERANSSI_SNT = 2;

export interface KuittiTasmays {
  /** Σnetto+Σvero (tai Σbrutto) täsmää bruttoSummaan sallitun varan sisällä. */
  tasmaa: boolean;
  /** bruttoSumma − laskettu summa, senttiä (0 kun ei bruttoSummaa). */
  erotusSnt: number;
  /** Kaikki ALV-kannat kuuluvat sallittuun joukkoon. */
  kannatKelpo: boolean;
  /** bruttoSumma tai erittelysummat puuttuvat → ei täsmäytettävissä. */
  puutteita: boolean;
}

/** Täsmäyttää kuitin summat — mallista riippumaton luottamussignaali. */
export function tasmaa(k: Kuitti): KuittiTasmays {
  const kannatKelpo = k.alv.length > 0 && k.alv.every((e) => SALLITUT_KANNAT.includes(e.kanta));

  let summa = 0;
  let loytyi = false;
  for (const e of k.alv) {
    if (e.brutto !== undefined) {
      summa += e.brutto;
      loytyi = true;
    } else if (e.netto !== undefined || e.vero !== undefined) {
      summa += (e.netto ?? 0) + (e.vero ?? 0);
      loytyi = true;
    }
  }

  const puutteita = k.bruttoSumma === undefined || !loytyi;
  const erotusSnt = k.bruttoSumma === undefined ? 0 : k.bruttoSumma - summa;
  const tasmaa = !puutteita && Math.abs(erotusSnt) <= TOLERANSSI_SNT;
  return { tasmaa, erotusSnt, kannatKelpo, puutteita };
}
