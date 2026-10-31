import type { TositeVienti } from '@penni/engine';
import type { Cents } from '@penni/euro';

export interface TilinSumma {
  tili: number;
  summa: Cents;
}

/**
 * Kirjauksen selväkielinen suunta: kredit-puolen tilit ovat "mistä" (raha tai arvo lähtee),
 * debet-puolen "mihin" (se kirjataan). Saman tilin viennit yhdistetään ja suurin näytetään
 * ensin; nollaviennit ohitetaan.
 */
export function kirjausYhteenveto(viennit: readonly TositeVienti[]): {
  mista: TilinSumma[];
  mihin: TilinSumma[];
} {
  const mista = new Map<number, number>();
  const mihin = new Map<number, number>();
  for (const v of viennit) {
    if (v.kredit !== 0) mista.set(v.tili, (mista.get(v.tili) ?? 0) + v.kredit);
    if (v.debet !== 0) mihin.set(v.tili, (mihin.get(v.tili) ?? 0) + v.debet);
  }
  const lista = (m: Map<number, number>): TilinSumma[] =>
    [...m]
      .map(([tili, summa]) => ({ tili, summa: summa as Cents }))
      .sort((a, b) => b.summa - a.summa || a.tili - b.tili);
  return { mista: lista(mista), mihin: lista(mihin) };
}
