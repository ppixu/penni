import type { LiiteMeta } from '@penni/engine';

/** Tositteen liitteiden lista: nimi, tyyppi sekä Avaa- ja (valinnainen) Poista-painike. */
export function Liitelista({
  liitteet,
  onAvaa,
  onPoista,
}: {
  liitteet: LiiteMeta[];
  onAvaa: (id: number) => void;
  onPoista?: ((id: number) => void) | undefined;
}) {
  if (liitteet.length === 0) return null;
  return (
    <section aria-label="liitteet" className="mt-5">
      <h2 className="mb-2 text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
        Liitteet
      </h2>
      <ul className="flex flex-col gap-1">
        {liitteet.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px]">
            <span className="min-w-0 [overflow-wrap:anywhere]">{l.nimi}</span>
            <span className="text-[var(--text-subtle)]">{l.tyyppi}</span>
            <button
              type="button"
              className="text-[var(--accent)] underline"
              aria-label={`Avaa ${l.nimi}`}
              onClick={() => onAvaa(l.id)}
            >
              Avaa
            </button>
            {onPoista ? (
              <button
                type="button"
                className="text-[var(--danger)] underline"
                aria-label={`Poista ${l.nimi}`}
                onClick={() => onPoista(l.id)}
              >
                Poista
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
