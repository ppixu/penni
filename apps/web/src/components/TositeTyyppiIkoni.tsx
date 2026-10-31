import { cn } from '@/lib/utils';
import { TositeTyyppi } from '@penni/engine';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BellRing,
  Calculator,
  Download,
  FileInput,
  FileMinus,
  FileOutput,
  FileText,
  Landmark,
  type LucideIcon,
  Paperclip,
  StickyNote,
  UserRound,
  Wallet,
} from 'lucide-react';

type Savy = 'tulo' | 'meno' | 'neutraali';

/**
 * Tositelajin kuvake ja sävy: menot punertavat, tulot vihertävät, muut (siirto, muistio,
 * järjestelmätositteet) neutraalit. Tuntematon laji → yleinen asiakirja.
 */
const IKONIT: Record<number, { ikoni: LucideIcon; savy: Savy }> = {
  [TositeTyyppi.MUU]: { ikoni: FileText, savy: 'neutraali' },
  [TositeTyyppi.TUONTI]: { ikoni: Download, savy: 'neutraali' },
  [TositeTyyppi.MENO]: { ikoni: ArrowUpRight, savy: 'meno' },
  [TositeTyyppi.SAAPUNUTVERKKOLASKU]: { ikoni: FileInput, savy: 'meno' },
  [TositeTyyppi.KULULASKU]: { ikoni: Wallet, savy: 'meno' },
  [TositeTyyppi.TULO]: { ikoni: ArrowDownLeft, savy: 'tulo' },
  [TositeTyyppi.MYYNTILASKU]: { ikoni: FileOutput, savy: 'tulo' },
  [TositeTyyppi.HYVITYSLASKU]: { ikoni: FileMinus, savy: 'tulo' },
  [TositeTyyppi.MAKSUMUISTUTUS]: { ikoni: BellRing, savy: 'tulo' },
  [TositeTyyppi.SIIRTO]: { ikoni: ArrowLeftRight, savy: 'neutraali' },
  [TositeTyyppi.TILIOTE]: { ikoni: Landmark, savy: 'neutraali' },
  [TositeTyyppi.PALKKA]: { ikoni: UserRound, savy: 'meno' },
  [TositeTyyppi.MUISTIO]: { ikoni: StickyNote, savy: 'neutraali' },
  [TositeTyyppi.LIITETIETO]: { ikoni: Paperclip, savy: 'neutraali' },
};

const SAVYT: Record<Savy, string> = {
  tulo: 'bg-[var(--positive-soft)] text-[var(--positive)]',
  meno: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  neutraali: 'bg-[var(--track)] text-[var(--text-muted)]',
};

export function TositeTyyppiIkoni({ tyyppi, className }: { tyyppi: number; className?: string }) {
  // Järjestelmätositteet (alv-laskelma, tilinavaus, poistot…) ovat laskelmia.
  const { ikoni: Ikoni, savy } =
    IKONIT[tyyppi] ??
    (tyyppi >= TositeTyyppi.JARJESTELMATOSITE
      ? { ikoni: Calculator, savy: 'neutraali' as const }
      : { ikoni: FileText, savy: 'neutraali' as const });
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]',
        SAVYT[savy],
        className,
      )}
    >
      <Ikoni className="h-3.5 w-3.5" strokeWidth={2.2} />
    </span>
  );
}
