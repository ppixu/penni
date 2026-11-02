import { useKpClient } from '@/app/KpClientProvider';
import { avaimet } from '@/app/kysely';
import { cn } from '@/lib/utils';
import { kuukaudet } from '@/raportit/KuukausiRaportti';
import { type IsoDate, Luonne, type SaldotParams, type Tili, tiliTyypilla } from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Vihje, VihjeSisalto, useVihje } from './kaaviot';
import { kertymanLoppu, kuukaudenLyhenne, kuukaudenNimi, palkkienPaikat } from './tulosKertyma';

/** Piirtoalueen korkeus (px); palkit skaalataan tähän nollaviivan molemmin puolin. */
const KORKEUS = 150;
/** Aiempien kuukausien palkit: aksentin vaalea porras (aksentti-soft on liian vaalea palkille). */
const AIEMPI = '#a5b4fc';

/**
 * Tuloslaskelmakortti kojelaudalle: tilikauden tulos ja vähennettävä ALV tähän päivään asti sekä
 * tuloksen kertymä kuukausittain pylväinä. Kuluva (viimeinen) kuukausi korostetaan aksentilla.
 */
export function TuloslaskelmaKortti({
  alkaa,
  loppuu,
  tanaan,
  chart,
}: {
  alkaa: IsoDate;
  loppuu: IsoDate;
  tanaan: IsoDate;
  chart: readonly Tili[];
}) {
  const client = useKpClient();
  const loppu = kertymanLoppu(alkaa, loppuu, tanaan);
  const jakso = useMemo(() => kuukaudet(alkaa, loppu), [alkaa, loppu]);
  // Saldot kunkin kuukauden lopussa: tuloslaskelma kertyy tilikauden alusta (haeSaldot).
  const tulokset = useQueries({
    queries: jakso.map((k) => {
      const params: SaldotParams = { pvm: k.loppuu };
      return { queryKey: avaimet.saldot(params), queryFn: () => client.haeSaldot(params) };
    }),
  });
  const { kaare, vihje, nayta, piilota } = useVihje();

  const tulosTili = tiliTyypilla(chart, Luonne.KAUDENTULOS)?.numero;
  const alvTili = tiliTyypilla(chart, Luonne.ALVSAATAVA)?.numero;
  const valmis = tulokset.every((t) => t.data !== undefined);
  const kertyma = tulokset.map((t) =>
    tulosTili !== undefined ? (t.data?.get(tulosTili) ?? 0) : 0,
  ) as Cents[];
  const viimeinen = tulokset.at(-1)?.data;
  const tulos = (kertyma.at(-1) ?? 0) as Cents;
  const alv = (alvTili !== undefined ? (viimeinen?.get(alvTili) ?? 0) : 0) as Cents;
  const { nolla, palkit } = palkkienPaikat(kertyma);

  return (
    <section
      aria-label="tuloslaskelma"
      className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[14px] font-semibold text-[var(--text)]">Tuloslaskelma</h2>
        <span className="text-[12px] tabular-nums text-[var(--text-muted)]">
          {muotoilePvm(alkaa)}–{muotoilePvm(loppu)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 border-b border-[var(--border)] pb-4">
        <Luku otsikko="Tilikauden tulos" arvo={valmis ? tulos : undefined} />
        <Luku otsikko="Vähennettävä ALV" arvo={valmis ? alv : undefined} />
      </div>

      {valmis && jakso.length > 0 && (
        <div ref={kaare} className="relative pt-4">
          <ol aria-hidden className="flex" style={{ height: KORKEUS }} onMouseLeave={piilota}>
            {jakso.map((k, i) => {
              const p = palkit[i];
              const arvo = kertyma[i] ?? (0 as Cents);
              const kuluva = i === jakso.length - 1;
              return (
                <li
                  key={k.loppuu}
                  className="relative flex-1"
                  onMouseMove={(e) =>
                    nayta(
                      e,
                      <VihjeSisalto nimi={kuukaudenNimi(k.loppuu)} summa={muotoileEuro(arvo)} />,
                    )
                  }
                >
                  {p && p.korkeus > 0 && (
                    <div
                      className={cn(
                        'absolute left-1/2 w-full max-w-[24px] -translate-x-1/2',
                        arvo >= 0 ? 'rounded-t-[4px]' : 'rounded-b-[4px]',
                      )}
                      style={{
                        top: `${p.ylhaalla * 100}%`,
                        height: `max(${p.korkeus * 100}%, 2px)`,
                        background: kuluva ? 'var(--accent)' : AIEMPI,
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ol>
          {/* Nollaviiva vain, kun kertymä käy miinuksella; muuten palkkien alareuna on viiva. */}
          {nolla < 1 && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 h-px bg-[var(--border-strong)]"
              style={{ top: `calc(1rem + ${nolla * KORKEUS}px)` }}
            />
          )}
          <ol aria-hidden className="mt-2 flex">
            {jakso.map((k) => (
              <li
                key={k.loppuu}
                className="flex-1 text-center text-[11.5px] text-[var(--text-muted)]"
              >
                {kuukaudenLyhenne(k.loppuu)}
              </li>
            ))}
          </ol>
          <Vihje vihje={vihje} />
          <table className="sr-only">
            <caption>Tilikauden tuloksen kertymä kuukauden lopussa</caption>
            <tbody>
              {jakso.map((k, i) => (
                <tr key={k.loppuu}>
                  <th scope="row">{kuukaudenNimi(k.loppuu)}</th>
                  <td>{muotoileEuro(kertyma[i] ?? (0 as Cents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Luku({ otsikko, arvo }: { otsikko: string; arvo: Cents | undefined }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[12.5px] text-[var(--text-muted)]">{otsikko}</div>
      <div className="truncate text-[24px] font-[650] tabular-nums tracking-[-0.5px] text-[var(--text)]">
        {arvo === undefined ? '…' : muotoileEuro(arvo)}
      </div>
    </div>
  );
}
