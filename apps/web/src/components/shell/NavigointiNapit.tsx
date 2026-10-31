import { onkoMac } from '@/navigointi/Historiaeleet';
import { useHistoria } from '@/navigointi/useHistoria';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const NAPPI =
  'flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-muted)] hover:bg-[var(--track)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-35';

/** Selaimen kaltaiset Takaisin / Eteenpäin -napit sivupalkin yläreunaan (näkyvät joka sivulla). */
export function NavigointiNapit() {
  const { voiPalata, voiEdeta, siirry } = useHistoria();
  const mac = onkoMac();
  return (
    <div className="flex gap-[2px]">
      <button
        type="button"
        className={NAPPI}
        aria-label="Takaisin"
        title={`Takaisin (${mac ? '⌘[' : 'Alt+←'})`}
        disabled={!voiPalata}
        onClick={() => siirry('takaisin')}
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={NAPPI}
        aria-label="Eteenpäin"
        title={`Eteenpäin (${mac ? '⌘]' : 'Alt+→'})`}
        disabled={!voiEdeta}
        onClick={() => siirry('eteenpain')}
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );
}
