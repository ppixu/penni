import { Luonne, type Tili, type Tosite } from '@penni/engine';

/** Kirjanpidon pankkitilit (luonne PANKKITILI), tilikartan järjestyksessä. */
export function pankkitilit(chart: readonly Tili[]): Tili[] {
  return chart.filter((t) => t.otsikkotaso === 0 && t.luonne === Luonne.PANKKITILI);
}

/**
 * Kirjanpidon oletuspankkitili: ainoa pankkitili, tai usean joukosta se, jolle historiassa on
 * eniten vientejä (tasapelissä tilikartan järjestys). Ilman pankkitiliä undefined.
 */
export function oletusPankkitili(
  chart: readonly Tili[],
  tositteet: readonly Tosite[],
): number | undefined {
  const pankit = pankkitilit(chart);
  if (pankit.length <= 1) return pankit[0]?.numero;
  const kaytto = new Map<number, number>(pankit.map((t) => [t.numero, 0]));
  for (const t of tositteet)
    for (const v of t.viennit) {
      const n = kaytto.get(v.tili);
      if (n !== undefined) kaytto.set(v.tili, n + 1);
    }
  let paras = pankit[0];
  for (const t of pankit)
    if ((kaytto.get(t.numero) ?? 0) > (paras ? (kaytto.get(paras.numero) ?? 0) : 0)) paras = t;
  return paras?.numero;
}
