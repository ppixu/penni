import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Taittuvan osion otsikkopainike: nuoli + otsikko, `aria-expanded` kertoo tilan. Otsikon
 * tyyli tulee ympäröivästä elementistä (h2, taulukon osiorivi). Nuoli ei tulostu.
 */
export function TaittuvaOtsikko({
  auki,
  hallitsee,
  onVaihda,
  children,
}: {
  auki: boolean;
  /** Taitettavan sisällön id (`aria-controls`). */
  hallitsee: string;
  onVaihda: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={auki}
      aria-controls={hallitsee}
      onClick={onVaihda}
      className="-ml-1 inline-flex items-center gap-1 rounded-[4px] px-1 text-left hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] print:ml-0 print:px-0"
    >
      <ChevronRight
        aria-hidden
        className={`h-4 w-4 shrink-0 text-[var(--text-subtle)] transition-transform print:hidden ${
          auki ? 'rotate-90' : ''
        }`}
      />
      {children}
    </button>
  );
}
