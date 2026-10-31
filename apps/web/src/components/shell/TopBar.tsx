import type { ReactNode } from 'react';

export function TopBar({
  otsikko,
  alaotsikko,
  toiminnot,
}: {
  otsikko: string;
  // Explicit `| undefined` so callers may pass an optional value through under
  // exactOptionalPropertyTypes (e.g. alaotsikko={data?.asetukset.Nimi}).
  alaotsikko?: string | undefined;
  toiminnot?: ReactNode | undefined;
}) {
  return (
    <header className="print:hidden flex items-center justify-between border-b border-[var(--border)] px-[22px] py-[15px]">
      <div>
        <div className="text-[16px] font-[650] tracking-[-0.3px] text-[var(--text)]">{otsikko}</div>
        {alaotsikko ? (
          <div className="mt-[2px] text-[11.5px] text-[var(--text-subtle)]">{alaotsikko}</div>
        ) : null}
      </div>
      {toiminnot ? <div className="flex gap-[9px]">{toiminnot}</div> : null}
    </header>
  );
}
