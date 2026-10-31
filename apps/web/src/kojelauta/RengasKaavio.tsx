import { cn } from '@/lib/utils';
import type { Cents } from '@penni/euro';
import { useState } from 'react';
import { MUUT_VARI, SARJAVARIT, Vihje, VihjeSisalto, useVihje } from './kaaviot';
import { type JakoEra, MUUT, muotoileEuroPyorea, muotoileOsuus } from './tulosjako';

const KOKO = 132;
const PAKSUUS = 16;
/** Korostetun segmentin lisäpaksuus; säteeseen jätetään sille tilaa, ettei reuna leikkaudu. */
const KOROSTUS = 3;
const SADE = (KOKO - PAKSUUS - KOROSTUS) / 2;
const KEHA = 2 * Math.PI * SADE;
/** Pintaväriä näkyviin segmenttien väliin (px kehällä). */
const RAKO = 2;

const varille = (era: JakoEra, i: number) =>
  era.avain === MUUT ? MUUT_VARI : (SARJAVARIT[i] ?? MUUT_VARI);

/**
 * Osuudet renkaana (donitsi): keskellä kokonaissumma ja selite vieressä nimineen, summineen ja
 * osuuksineen, joten väri ei koskaan kanna tietoa yksin.
 */
export function RengasKaavio({ otsikko, erat }: { otsikko: string; erat: readonly JakoEra[] }) {
  const { kaare, vihje, nayta, piilota } = useVihje();
  const [korostettu, setKorostettu] = useState<string | null>(null);
  const yhteensa = erat.reduce((s, e) => s + e.summa, 0);

  if (yhteensa <= 0) {
    return (
      <div>
        <div className="mb-1 text-[12.5px] font-semibold text-[var(--text)]">{otsikko}</div>
        <p className="text-[13px] text-[var(--text-muted)]">Ei kirjauksia.</p>
      </div>
    );
  }

  let kertyma = 0;
  const kaaret = erat.map((era, i) => {
    const pituus = (era.summa / yhteensa) * KEHA;
    const alku = kertyma;
    kertyma += pituus;
    // Yksinäinen erä on koko rengas ilman rakoa.
    const nakyva = erat.length > 1 ? Math.max(pituus - RAKO, 0.5) : pituus;
    return { era, vari: varille(era, i), alku, nakyva };
  });

  return (
    <div ref={kaare} className="relative flex items-center gap-5">
      <svg
        viewBox={`0 0 ${KOKO} ${KOKO}`}
        width={KOKO}
        height={KOKO}
        className="shrink-0"
        role="img"
        aria-label={`${otsikko} ${muotoileEuroPyorea(yhteensa as Cents)}`}
      >
        <g transform={`rotate(-90 ${KOKO / 2} ${KOKO / 2})`}>
          {kaaret.map(({ era, vari, alku, nakyva }) => (
            <circle
              key={era.avain}
              cx={KOKO / 2}
              cy={KOKO / 2}
              r={SADE}
              fill="none"
              stroke={vari}
              strokeWidth={korostettu === era.avain ? PAKSUUS + KOROSTUS : PAKSUUS}
              strokeDasharray={`${nakyva} ${KEHA - nakyva}`}
              strokeDashoffset={-alku}
              opacity={korostettu !== null && korostettu !== era.avain ? 0.35 : 1}
              className="cursor-default transition-opacity duration-100"
              onMouseMove={(e) => {
                setKorostettu(era.avain);
                nayta(
                  e,
                  <VihjeSisalto
                    nimi={era.nimi}
                    summa={muotoileEuroPyorea(era.summa)}
                    osuus={muotoileOsuus(era.summa, yhteensa)}
                  />,
                );
              }}
              onMouseLeave={() => {
                setKorostettu(null);
                piilota();
              }}
            />
          ))}
        </g>
        <text
          x={KOKO / 2}
          y={KOKO / 2 - 2}
          textAnchor="middle"
          className="fill-[var(--text)] text-[14px] font-[650]"
        >
          {muotoileEuroPyorea(yhteensa as Cents)}
        </text>
        <text
          x={KOKO / 2}
          y={KOKO / 2 + 14}
          textAnchor="middle"
          className="fill-[var(--text-muted)] text-[10.5px]"
        >
          {otsikko}
        </text>
      </svg>
      <ul aria-label={otsikko} className="min-w-0 flex-1 text-[12px]">
        {kaaret.map(({ era, vari }) => (
          <li
            key={era.avain}
            onMouseEnter={() => setKorostettu(era.avain)}
            onMouseLeave={() => setKorostettu(null)}
            className={cn(
              'flex items-center gap-2 py-[3px]',
              korostettu !== null && korostettu !== era.avain && 'opacity-50',
            )}
          >
            <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: vari }} />
            <span className="min-w-0 flex-1 truncate text-[var(--text)]" title={era.nimi}>
              {era.nimi}
            </span>
            <span className="tabular-nums text-[var(--text-muted)]">
              {muotoileEuroPyorea(era.summa)}
            </span>
            <span className="w-9 text-right tabular-nums text-[var(--text-subtle)]">
              {muotoileOsuus(era.summa, yhteensa)}
            </span>
          </li>
        ))}
      </ul>
      <Vihje vihje={vihje} />
    </div>
  );
}
