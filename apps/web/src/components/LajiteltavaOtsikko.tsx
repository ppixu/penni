import type { ReactNode } from 'react';

/**
 * Taulukon lajiteltava sarakeotsikko: koko otsikko on painike, aktiivinen sarake näyttää
 * suuntanuolen ja `aria-sort`-tilan. Yhteinen tositeluettelolle ja Tulot/Menot-listoille.
 */
export function LajiteltavaOtsikko({
  aktiivinen,
  nouseva,
  saavutettavaNimi,
  oikealle,
  onLajittele,
  children,
}: {
  aktiivinen: boolean;
  nouseva: boolean;
  /** Painikkeen nimi ruudunlukijalle, esim. "Lajittele summan mukaan". */
  saavutettavaNimi: string;
  oikealle?: boolean | undefined;
  onLajittele: () => void;
  children: ReactNode;
}) {
  return (
    <th
      aria-sort={aktiivinen ? (nouseva ? 'ascending' : 'descending') : undefined}
      className={`px-[10px] pb-[7px] text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)] ${
        oikealle ? 'text-right' : 'text-left'
      }`}
    >
      <button
        type="button"
        aria-label={saavutettavaNimi}
        onClick={onLajittele}
        className={`group inline-flex items-center gap-1 rounded-[4px] uppercase tracking-[0.6px] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          aktiivinen ? 'text-[var(--accent)]' : ''
        }`}
      >
        {children}
        {/* Kiinteä leveys: nuoli ei heiluta sarakkeita. Vain visuaalinen; aria-sort kertoo tilan. */}
        <span
          aria-hidden="true"
          className={`inline-block w-[9px] text-center ${aktiivinen ? '' : 'opacity-0 group-hover:opacity-60'}`}
        >
          {aktiivinen ? (nouseva ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}
