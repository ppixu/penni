import { type Tili, type TositeVienti, nimi as tilinNimi } from '@penni/engine';
import { muotoileEuro } from '@penni/euro';
import { type TilinSumma, kirjausYhteenveto } from './kirjauksenSuunta.js';

const OTSIKKO_LUOKKA =
  'text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

function Puoli({
  otsikko,
  rivit,
  tilit,
}: {
  otsikko: string;
  rivit: readonly TilinSumma[];
  tilit: ReadonlyMap<number, Tili>;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className={OTSIKKO_LUOKKA}>{otsikko}</span>
      <ul aria-label={otsikko} className="flex flex-col gap-[2px]">
        {rivit.map((r) => {
          const tili = tilit.get(r.tili);
          return (
            <li key={r.tili} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate">
                <span className="tabular-nums">{r.tili}</span>
                {tili ? (
                  <span className="ml-[6px] text-[var(--text-muted)]">{tilinNimi(tili)}</span>
                ) : null}
              </span>
              <span className="tabular-nums">{muotoileEuro(r.summa)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * "Mistä → mihin": kirjauksen tilit selväkielisesti (kredit = mistä, debet = mihin), jotta
 * debet/kredit-sarakkeita ei tarvitse tulkita. Ei näy, ennen kuin kummallakin puolella on tili.
 */
export function KirjausYhteenveto({
  viennit,
  chart,
}: {
  viennit: readonly TositeVienti[];
  chart: readonly Tili[];
}) {
  const { mista, mihin } = kirjausYhteenveto(viennit);
  if (mista.length === 0 || mihin.length === 0) return null;
  const tilit = new Map(chart.map((t) => [t.numero, t]));
  return (
    <section
      aria-label="Kirjauksen yhteenveto"
      className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-[var(--radius-card)] border border-[var(--border)] px-[14px] py-[10px] text-[12.5px]"
    >
      <Puoli otsikko="Mistä" rivit={mista} tilit={tilit} />
      <span aria-hidden="true" className="self-center text-[16px] text-[var(--text-subtle)]">
        →
      </span>
      <Puoli otsikko="Mihin" rivit={mihin} tilit={tilit} />
    </section>
  );
}
