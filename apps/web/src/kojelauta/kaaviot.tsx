import { type MouseEvent, type ReactNode, useCallback, useRef, useState } from 'react';

/**
 * Kaavioiden kategoriset sarjavärit kiinteässä järjestyksessä (dataviz-viitepaletin viisi
 * ensimmäistä; järjestys on validoitu värisokeille vierekkäisinä). Kolme jää alle 3:1 kontrastin
 * valkoista vasten, joten jokaisella erällä on aina näkyvä nimi ja summa.
 */
export const SARJAVARIT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as const;
/** "Muut"-erän neutraali harmaa. */
export const MUUT_VARI = '#a1a1aa';

export interface VihjeTila {
  x: number;
  y: number;
  sisalto: ReactNode;
}

/** Hiiren mukana kulkeva vihje kaavion päällä; kääre on `relative`, vihje sen sisällä. */
export function useVihje() {
  const kaare = useRef<HTMLDivElement>(null);
  const [vihje, setVihje] = useState<VihjeTila | null>(null);
  const nayta = useCallback((e: MouseEvent, sisalto: ReactNode) => {
    const r = kaare.current?.getBoundingClientRect();
    if (!r) return;
    setVihje({ x: e.clientX - r.left, y: e.clientY - r.top, sisalto });
  }, []);
  const piilota = useCallback(() => setVihje(null), []);
  return { kaare, vihje, nayta, piilota };
}

export function Vihje({ vihje }: { vihje: VihjeTila | null }) {
  if (!vihje) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] shadow-[var(--shadow-pop)]"
      style={{ left: vihje.x, top: vihje.y }}
    >
      {vihje.sisalto}
    </div>
  );
}

/** Vihjeen vakiorivit: nimi, summa ja osuus. */
export function VihjeSisalto({
  nimi,
  summa,
  osuus,
}: {
  nimi: string;
  summa: string;
  osuus?: string | undefined;
}) {
  return (
    <>
      <div className="font-semibold text-[var(--text)]">{nimi}</div>
      <div className="tabular-nums text-[var(--text-muted)]">
        {summa}
        {osuus ? ` · ${osuus}` : ''}
      </div>
    </>
  );
}
