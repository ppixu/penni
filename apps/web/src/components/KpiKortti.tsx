import { type Cents, muotoileEuro } from '@penni/euro';

export function KpiKortti({
  otsikko,
  arvo,
  positiivinenVihrea = false,
}: {
  otsikko: string;
  arvo: Cents;
  positiivinenVihrea?: boolean;
}) {
  const vihrea = positiivinenVihrea && arvo >= 0;
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
        {otsikko}
      </div>
      <div
        className={`text-[17px] font-[650] tabular-nums tracking-[-0.3px] ${
          vihrea ? 'text-[var(--positive)]' : 'text-[var(--text)]'
        }`}
      >
        {muotoileEuro(arvo)}
      </div>
    </div>
  );
}
