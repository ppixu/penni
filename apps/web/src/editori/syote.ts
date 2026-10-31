import { TositeTila, TositeTyyppi } from '@penni/engine';
import type { Tili, TositeSyote } from '@penni/engine';
import { johdaViennit } from './johdaViennit.js';
import type { TositeEditoriTila } from './types.js';

/**
 * Editor state -> engine TositeSyote. Rows are mapped to the final viennit via
 * `johdaViennit`: plain rows pass through, VAT-coded rows expand into base + VAT legs.
 * Empty/incomplete rows are dropped. The single voucher date applies to every vienti.
 */
export function rakennaSyote(
  tila: TositeEditoriTila,
  kohde: 'luonnos' | 'kirjattu',
  chart: readonly Tili[],
): TositeSyote {
  const viennit = johdaViennit(tila.rows, chart, tila.paiva);
  return {
    pvm: tila.paiva,
    tyyppi: tila.tyyppi,
    sarja: tila.sarja,
    viennit,
    ...(tila.selite ? { otsikko: tila.selite } : {}),
    ...(tila.tiliote && tila.tyyppi === TositeTyyppi.TILIOTE ? { tiliote: tila.tiliote } : {}),
    ...(tila.draftId !== undefined ? { id: tila.draftId } : {}),
    tila: kohde === 'kirjattu' ? TositeTila.KIRJANPIDOSSA : TositeTila.LUONNOS,
  };
}
