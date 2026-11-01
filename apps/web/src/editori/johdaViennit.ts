import { AlvKoodi, type Tili, type TositeVienti, generoiVeroviennit } from '@penni/engine';
import type { IsoDate } from '@penni/engine';
import type { VientiRivi } from './types.js';

/**
 * Map editor rows -> the final ledger viennit. Rows with a real VAT code are expanded
 * into base + VAT legs via the engine generator; plain rows pass through unchanged.
 * Empty/incomplete rows (no account OR zero amount) are dropped.
 */
export function johdaViennit(
  rows: readonly VientiRivi[],
  chart: readonly Tili[],
  pvm: IsoDate,
): TositeVienti[] {
  const kelpo = rows.filter((r) => r.tili !== undefined && (r.debetSnt !== 0 || r.kreditSnt !== 0));
  const out: TositeVienti[] = [];
  for (const r of kelpo) {
    // Kohdennus ja merkkaukset kulkevat perusviennille ja (generoiVeroviennit) alv-vienneille.
    const kohdennus = {
      ...(r.kohdennus ? { kohdennus: r.kohdennus } : {}),
      ...(r.merkkaukset && r.merkkaukset.length > 0 ? { merkkaukset: r.merkkaukset } : {}),
    };
    const puoli = r.kreditSnt !== 0 ? 'kredit' : 'debet';
    const maara = puoli === 'kredit' ? r.kreditSnt : r.debetSnt;
    if (r.alvKoodi === AlvKoodi.EIALV) {
      out.push({
        tili: r.tili as number,
        debet: r.debetSnt,
        kredit: r.kreditSnt,
        pvm,
        alvKoodi: 0,
        alvProsentti: 0,
        ...(r.selite ? { selite: r.selite } : {}),
        ...kohdennus,
      });
      continue;
    }
    out.push(
      ...generoiVeroviennit(
        [
          {
            tili: r.tili as number,
            alvKoodi: r.alvKoodi,
            alvProsentti: r.alvProsentti,
            maara,
            bruttoSyotto: r.bruttoSyotto,
            puoli,
            pvm,
            ...(r.selite ? { selite: r.selite } : {}),
            ...kohdennus,
          },
        ],
        chart,
      ),
    );
  }
  return out;
}
