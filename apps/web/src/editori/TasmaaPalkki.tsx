import { cn } from '@/lib/utils';
import { type Cents, muotoileEuro } from '@penni/euro';

/** Tier-0 drives 'tyhja' (no amounts yet, neutral), 'ok' (green) and 'block' (red); 'warn'
 *  (amber) is wired for Tier-1 (per-row dates). */
export type TasmaaTila = 'tyhja' | 'ok' | 'block' | 'warn';

const TYYLI: Record<TasmaaTila, string> = {
  tyhja: 'border-[var(--border)] font-medium text-[var(--text-muted)]',
  ok: 'bg-[var(--positive-soft)] border-[var(--positive-border)] text-[var(--positive)]',
  block: 'bg-[var(--danger-soft)] border-[var(--danger)] text-[var(--danger)]',
  warn: 'border-[var(--warning)] text-[var(--warning)]',
};

export function TasmaaPalkki({ tila, erotus }: { tila: TasmaaTila; erotus: Cents }) {
  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: tyylitelty täsmäyspalkki vaatii <div>:n eikä <output>:ia
      role="status"
      aria-live="polite"
      className={cn(
        'sticky bottom-0 flex items-center justify-between rounded-[var(--radius-card)] border px-[14px] py-[9px] text-[12.5px] font-semibold tabular-nums',
        TYYLI[tila],
      )}
    >
      {tila === 'tyhja' ? (
        <span>Ei vielä summia</span>
      ) : tila === 'ok' ? (
        <span>✓ Täsmää</span>
      ) : (
        <span>Erotus {muotoileEuro(erotus)}</span>
      )}
    </div>
  );
}
