import { Luonne, type LuonneArvo, type Tili } from '@penni/engine';

/** One ledger leg in a chart-agnostic shape (cents). Bridges .kitsas rows and generated vouchers. */
export interface Leg {
  tili: number;
  debet: number;
  kredit: number;
  alvKoodi: number;
  alvProsentti: number;
}

/** Legs grouped by the classifying account nature. */
export interface Legit {
  pankki: Leg[];
  alv: Leg[];
  menot: Leg[];
  muu: Leg[];
}

const luonnePerTili = (chart: readonly Tili[]): Map<number, LuonneArvo> =>
  new Map(chart.map((t) => [t.numero, t.luonne]));

/** Split legs into bank / VAT-receivable / expense / other by their account's Luonne. */
export function luokitteleLegit(legit: readonly Leg[], chart: readonly Tili[]): Legit {
  const luonteet = luonnePerTili(chart);
  const tulos: Legit = { pankki: [], alv: [], menot: [], muu: [] };
  for (const leg of legit) {
    const luonne = luonteet.get(leg.tili);
    if (luonne === Luonne.PANKKITILI) tulos.pankki.push(leg);
    else if (luonne === Luonne.ALVSAATAVA || luonne === Luonne.KOHDENTAMATONALVSAATAVA)
      tulos.alv.push(leg);
    else if (luonne === Luonne.MENO) tulos.menot.push(leg);
    else tulos.muu.push(leg);
  }
  return tulos;
}
