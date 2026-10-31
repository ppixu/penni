import type { Tili } from '@penni/engine';
import { useMemo, useReducer } from 'react';
import { alustaTila, reducer } from './reducer.js';
import { laskeSummat } from './summat.js';
import type { TositeEditoriTila } from './types.js';

/**
 * Editable-voucher state facade. `initial` lets the (deferred) edit route seed an
 * existing voucher; create-only Tier-0 passes just `{ paiva }`. The `chart` is needed
 * because the running balance is now computed over the DERIVED (VAT-expanded) viennit.
 */
export function useTositeEditori(chart: readonly Tili[], initial?: Partial<TositeEditoriTila>) {
  const [tila, dispatch] = useReducer(reducer, initial, alustaTila);
  const summat = useMemo(
    () => laskeSummat(tila.rows, chart, tila.paiva),
    [tila.rows, chart, tila.paiva],
  );
  return { tila, dispatch, summat };
}
