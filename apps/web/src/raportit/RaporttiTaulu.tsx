import { Linkki } from '@/components/Linkki';
import type { RaporttiRivi } from '@penni/engine';
import { muotoileEuro } from '@penni/euro';

/**
 * Render a pre-resolved report row list (indent / bold / blank spacer / right-aligned money).
 * Per-account detail rows (`tili` set, "4000 Ostot") render lighter so the formula lines stay the
 * visual skeleton, and link to the account in the chart (no per-account ledger view yet).
 */
export function RaporttiTaulu({ rivit }: { rivit: readonly RaporttiRivi[] }) {
  return (
    <table className="w-full max-w-2xl border-collapse text-[13px]">
      <tbody>
        {rivit.map((r, i) => {
          // Raporttirivit ovat uudelleenlaskettua tulosta, ei koskaan järjestetä tai muokata
          // paikoillaan — vakaa indeksi käy avaimeksi.
          if (r.tyhja) {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: vakaa järjestys, read-only näyttö
              <tr key={i} aria-hidden>
                <td className="h-3" colSpan={2} />
              </tr>
            );
          }
          if (r.tili !== undefined) {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: vakaa järjestys, read-only näyttö
              <tr key={i} className="border-b border-[var(--border-faint)] text-[12.5px]">
                <td
                  className="py-[3px] text-[var(--text-muted)]"
                  style={{ paddingLeft: `${r.sisennys * 16}px` }}
                >
                  <Linkki
                    to="/tilikartta"
                    search={{ nakyma: 'kaikki', tili: r.tili }}
                    className="hover:text-[var(--accent)] hover:underline"
                  >
                    {r.teksti}
                  </Linkki>
                </td>
                <td className="py-[3px] text-right tabular-nums text-[var(--text-muted)]">
                  {r.arvo === null ? '' : muotoileEuro(r.arvo)}
                </td>
              </tr>
            );
          }
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: vakaa järjestys, read-only näyttö
            <tr key={i} className="border-b border-[var(--border-faint)]">
              <td
                className={r.lihava ? 'py-[5px] font-semibold' : 'py-[5px]'}
                style={{ paddingLeft: `${r.sisennys * 16}px` }}
              >
                {r.teksti}
              </td>
              <td className={`py-[5px] text-right tabular-nums ${r.lihava ? 'font-semibold' : ''}`}>
                {r.arvo === null ? '' : muotoileEuro(r.arvo)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
