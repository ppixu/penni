import type { Cents } from '@penni/euro';
import { Luonne } from '../accounts/luonne.js';
import { tiliTyypilla } from '../accounts/tili.js';
import type { IsoDate } from '../vouchers/types.js';
import { tilikausiPaivalle } from './numbering.js';
import type { ResourceEnv, Storage } from './storage.js';

/** An account is an asset iff its number begins with '1' (Finnish chart: 1xxx = vastaavaa). */
export function onkoVastaavaa(numero: number): boolean {
  return String(numero).startsWith('1');
}

/**
 * Normalize a raw balance (Σdebet − Σkredit) to the saldot sign convention:
 * assets are debit-positive (raw kept); every other account is credit-positive (raw negated).
 * Mirrors saldotroute.cpp:84-87 unified with :59-61. `-raaka || 0` scrubs -0 (negating an exact
 * zero raw balance) back to +0, since JS distinguishes them under Object.is/toBe.
 */
export function normalisoiSaldo(numero: number, raaka: Cents): Cents {
  return (onkoVastaavaa(numero) ? raaka : -raaka || 0) as Cents;
}

export interface SaldotParams {
  pvm: IsoDate;
  alkupvm?: IsoDate;
  alkusaldot?: boolean;
  tase?: boolean;
  tuloslaskelma?: boolean;
  tili?: number;
  kohdennus?: number;
  /** Tulosblokin kohdennusjoukko (ks. SaldoQuery.kohdennukset; kohdennusSuodatin ratkaisee). */
  kohdennukset?: number[];
  /** Tulosblokin merkkaussuodatin (ks. SaldoQuery.merkkaus). */
  merkkaus?: number;
}

/** account number -> balance in cents (sign-normalized). */
export type SaldotTulos = Map<number, Cents>;

const LISAA = (m: SaldotTulos, tili: number, arvo: Cents): void => {
  m.set(tili, ((m.get(tili) ?? 0) + arvo) as Cents);
};

export async function haeSaldot(
  storage: Storage,
  _env: ResourceEnv,
  params: SaldotParams,
): Promise<SaldotTulos> {
  const kaudet = await storage.getTilikaudet();
  const kausi = tilikausiPaivalle(kaudet, params.pvm);
  const kaudenalku = params.alkupvm ?? kausi?.alkaa ?? params.pvm;
  const out: SaldotTulos = new Map();

  // Single-account branch.
  if (params.tili !== undefined) {
    const pl = !onkoVastaavaa(params.tili) && String(params.tili) >= '3';
    const raw = await storage.querySaldot(
      pl
        ? { alkupvm: kaudenalku, loppupvm: params.pvm, tili: params.tili }
        : {
            loppupvm: params.pvm,
            loppupvmExclusive: params.alkusaldot === true,
            tili: params.tili,
          },
    );
    const r = raw.get(params.tili);
    if (r !== undefined) out.set(params.tili, normalisoiSaldo(params.tili, r));
    return out;
  }

  // Balance-sheet block (class < '3', cumulative) + computed equity rows.
  if (!params.tuloslaskelma) {
    const raw = await storage.querySaldot({
      loppupvm: params.pvm,
      loppupvmExclusive: params.alkusaldot === true,
      tiliAsti: '3',
    });
    for (const [tili, r] of raw) out.set(tili, normalisoiSaldo(tili, r));

    const chart = await storage.getChart();

    // EDELLISTENTULOS: own posted balance (already in `out`) + prior-years class>=3 net (credit-positive).
    const edTili = tiliTyypilla(chart, Luonne.EDELLISTENTULOS);
    if (edTili && kausi) {
      const prior = await storage.querySaldot({
        loppupvm: kausi.alkaa,
        loppupvmExclusive: true,
        tiliAlkaen: '3',
      });
      let net = 0;
      for (const r of prior.values()) net += r; // Σ raw (debet-kredit)
      LISAA(out, edTili.numero, -net as Cents); // credit-positive = -(debet-kredit)
    }

    // KAUDENTULOS: current-period class>=3 net (credit-positive); omitted for opening balances.
    if (!params.alkusaldot && kausi) {
      const kauTili = tiliTyypilla(chart, Luonne.KAUDENTULOS);
      if (kauTili) {
        const period = await storage.querySaldot({
          alkupvm: kausi.alkaa,
          loppupvm: params.pvm,
          tiliAlkaen: '3',
        });
        let net = 0;
        for (const r of period.values()) net += r;
        out.set(kauTili.numero, -net as Cents); // overwrite (matches legacy insert)
      }
    }
  }

  // P&L / result block (class >= '3', period [kaudenalku, pvm]).
  if (!params.tase) {
    const raw = await storage.querySaldot({
      alkupvm: kaudenalku,
      loppupvm: params.pvm,
      loppupvmExclusive: params.alkusaldot === true,
      tiliAlkaen: '3',
      ...(params.kohdennus !== undefined ? { kohdennus: params.kohdennus } : {}),
      ...(params.kohdennukset !== undefined ? { kohdennukset: params.kohdennukset } : {}),
      ...(params.merkkaus !== undefined ? { merkkaus: params.merkkaus } : {}),
    });
    for (const [tili, r] of raw) out.set(tili, normalisoiSaldo(tili, r));
  }

  return out;
}
