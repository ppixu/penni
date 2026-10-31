import {
  Luonne,
  type MenotiliSaanto,
  type Tili,
  type TositeAsetukset,
  normalisoiNimi,
  tiliTyypilla,
} from '@penni/engine';
import type { Totuus } from './totuus.js';

const pankki = (chart: readonly Tili[]): number | undefined =>
  tiliTyypilla(chart, Luonne.PANKKITILI)?.numero;

/** Cold: no learned rules, no configured expense account (engine falls back to first MENO account). */
export function kylmaAsetukset(chart: readonly Tili[]): TositeAsetukset {
  const p = pankki(chart);
  const a: TositeAsetukset = { menotiliSaannot: [] };
  if (p !== undefined) a.pankkitili = p;
  return a;
}

/** Modal value of an array, or undefined if empty. First-seen wins ties (stable). */
function moodi<T>(arvot: readonly T[]): T | undefined {
  const laskuri = new Map<T, number>();
  let paras: T | undefined;
  let parasMaara = 0;
  for (const a of arvot) {
    const n = (laskuri.get(a) ?? 0) + 1;
    laskuri.set(a, n);
    if (n > parasMaara) {
      parasMaara = n;
      paras = a;
    }
  }
  return paras;
}

/** Learn vendor→account rules from history, excluding the voucher under test (leave-one-out). */
export function opiSaannot(totuudet: readonly Totuus[], poisluettuId: number): MenotiliSaanto[] {
  const tilitPerMyyja = new Map<string, number[]>();
  for (const t of totuudet) {
    if (t.tositeId === poisluettuId) continue;
    const ensitili = t.menot[0]?.tili;
    if (ensitili === undefined) continue;
    const avain = normalisoiNimi(t.myyja);
    if (avain === '') continue;
    const lista = tilitPerMyyja.get(avain) ?? [];
    lista.push(ensitili);
    tilitPerMyyja.set(avain, lista);
  }
  const saannot: MenotiliSaanto[] = [];
  for (const [hae, tilit] of tilitPerMyyja) {
    const tili = moodi(tilit);
    if (tili !== undefined) saannot.push({ hae, tili });
  }
  return saannot;
}

/** Warm: configure the learned rules. */
export function lamminAsetukset(
  chart: readonly Tili[],
  saannot: readonly MenotiliSaanto[],
): TositeAsetukset {
  const p = pankki(chart);
  const a: TositeAsetukset = { menotiliSaannot: saannot };
  if (p !== undefined) a.pankkitili = p;
  return a;
}
