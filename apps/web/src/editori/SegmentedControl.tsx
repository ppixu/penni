import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export interface Segmentti {
  arvo: number;
  label: string;
  /** Valinnainen kuvake tekstin edessä (koristeellinen; nimi tulee labelista). */
  ikoni?: ReactNode;
}

/** Token-styled segmented control as a true radiogroup (Meno/Tulo/Siirto/Muistio). */
export function SegmentedControl({
  nimi,
  vaihtoehdot,
  arvo,
  onMuutos,
}: {
  nimi: string;
  vaihtoehdot: readonly Segmentti[];
  arvo: number;
  onMuutos: (arvo: number) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={nimi}
      className="inline-flex max-w-full flex-wrap gap-[2px] rounded-[9px] bg-[var(--track)] p-[3px]"
    >
      {vaihtoehdot.map((v) => {
        const valittu = v.arvo === arvo;
        return (
          <button
            key={v.arvo}
            type="button"
            // biome-ignore lint/a11y/useSemanticElements: tyylitelty radiogroup vaatii <button>:n; <input type=radio> ei tyylity näin
            role="radio"
            aria-checked={valittu}
            onClick={() => onMuutos(v.arvo)}
            className={cn(
              'inline-flex items-center gap-[7px] rounded-[6px] px-[13px] py-1.5 text-[12.5px] transition-colors',
              v.ikoni !== undefined && 'pl-[8px]',
              valittu
                ? 'bg-[var(--surface)] font-semibold text-[var(--accent)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                : 'font-medium text-[var(--text-muted)]',
            )}
          >
            {v.ikoni}
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
