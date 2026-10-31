import type { Cents } from '@penni/euro';
import { type MouseEvent, useState } from 'react';
import { MUUT_VARI, SARJAVARIT, Vihje, VihjeSisalto, useVihje } from './kaaviot';
import { type JakoEra, MUUT, type TulosJako, muotoileEuroPyorea, muotoileOsuus } from './tulosjako';

const LEVEYS = 720;
const SOLMU = 10;
const X_VASEN = 196;
const X_KESKI = 355;
const X_OIKEA = 514;
/** Koko virran korkeus; pienet erät saavat silti nimirivien vaatiman tilan. */
const VIRTA = 240;
const YLA = 28;
const VALI = 10;
const NIMIRIVI = 30;

export interface VirtaSolmu {
  era: JakoEra;
  vari: string;
  /** Solmun suorakaide. */
  y: number;
  h: number;
  /** Virran kaista solmun kohdalla ja keskisolmussa. */
  kaista: [number, number];
  keskella: [number, number];
}

type Erat = { era: JakoEra; vari: string }[];

export interface VirtaAsettelu {
  vasen: VirtaSolmu[];
  oikea: VirtaSolmu[];
  keski: { y: number; h: number };
  korkeus: number;
}

/**
 * Kolmen sarakkeen Sankey: tulot (ja tappio nimellä Kulut) → yritys → kulut (ja tulos). Molemmat puolet
 * summautuvat samaan, joten keskisolmu on yhtä korkea kuin kumpikin virta. Solmut pinotaan
 * väleineen, ja pienikin erä saa nimiriviensä korkuisen paikan.
 */
export function virtaAsettelu(jako: TulosJako): VirtaAsettelu | null {
  const tappio = jako.tulos < 0;
  const vasemmat: Erat = [
    ...jako.tulot.map((era) => ({ era, vari: 'var(--accent)' })),
    ...(tappio
      ? [
          {
            era: { avain: 'tappio', nimi: 'Kulut', summa: -jako.tulos as Cents },
            vari: 'var(--danger)',
          },
        ]
      : []),
  ];
  const oikeat: Erat = [
    ...jako.kulut.map((era, i) => ({
      era,
      vari: era.avain === MUUT ? MUUT_VARI : (SARJAVARIT[i] ?? MUUT_VARI),
    })),
    ...(jako.tulos > 0
      ? [{ era: { avain: 'tulos', nimi: 'Tulos', summa: jako.tulos }, vari: 'var(--positive)' }]
      : []),
  ];

  const kokonais = vasemmat.reduce((s, v) => s + v.era.summa, 0);
  if (kokonais <= 0) return null;
  const k = VIRTA / kokonais;

  const sarake = (erat: Erat) => {
    let y = 0;
    const solmut = erat.map(({ era, vari }) => {
      const paksuus = era.summa * k;
      const h = Math.max(paksuus, 2);
      const paikka = Math.max(h, NIMIRIVI);
      const solmuY = y + (paikka - h) / 2;
      y += paikka + VALI;
      const alku = solmuY + (h - paksuus) / 2;
      return { era, vari, y: solmuY, h, kaista: [alku, alku + paksuus] as [number, number] };
    });
    return { solmut, korkeus: y - VALI };
  };
  const v = sarake(vasemmat);
  const o = sarake(oikeat);
  const korkeus = Math.max(v.korkeus, o.korkeus, VIRTA);
  const keskiY = YLA + (korkeus - VIRTA) / 2;

  const sijoita = (s: ReturnType<typeof sarake>): VirtaSolmu[] => {
    const siirto = YLA + (korkeus - s.korkeus) / 2;
    let kertyma = keskiY;
    return s.solmut.map((n) => {
      const paksuus = n.kaista[1] - n.kaista[0];
      const keskella: [number, number] = [kertyma, kertyma + paksuus];
      kertyma += paksuus;
      return {
        ...n,
        y: n.y + siirto,
        kaista: [n.kaista[0] + siirto, n.kaista[1] + siirto],
        keskella,
      };
    });
  };
  return {
    vasen: sijoita(v),
    oikea: sijoita(o),
    keski: { y: keskiY, h: VIRTA },
    korkeus: YLA + korkeus + 4,
  };
}

/** Kaistan polku x0:n kohdan välistä a x1:n kohdan väliin b (kuutiollinen Bézier kumpaankin reunaan). */
function kaistaPolku(x0: number, a: [number, number], x1: number, b: [number, number]): string {
  const xm = (x0 + x1) / 2;
  return [
    `M${x0},${a[0]}`,
    `C${xm},${a[0]} ${xm},${b[0]} ${x1},${b[0]}`,
    `L${x1},${b[1]}`,
    `C${xm},${b[1]} ${xm},${a[1]} ${x0},${a[1]}`,
    'Z',
  ].join(' ');
}

/** Tilikauden tulot ja kulut virtoina yrityksen läpi (Sankey). */
export function TulosvirtaKaavio({ jako, keskiNimi }: { jako: TulosJako; keskiNimi: string }) {
  const { kaare, vihje, nayta, piilota } = useVihje();
  const [korostettu, setKorostettu] = useState<string | null>(null);
  const asettelu = virtaAsettelu(jako);
  if (!asettelu) {
    return (
      <p className="text-[13.5px] text-[var(--text-muted)]">
        Ei tuloja eikä kuluja tällä tilikaudella.
      </p>
    );
  }
  const tulotYht = jako.tulot.reduce((s, e) => s + e.summa, 0);
  const kuvaus = (puoli: VirtaSolmu[]) =>
    puoli.map((n) => `${n.era.nimi} ${muotoileEuroPyorea(n.era.summa)}`).join(', ');

  const solmu = (n: VirtaSolmu, puoli: 'vasen' | 'oikea') => {
    const vasen = puoli === 'vasen';
    const x = vasen ? X_VASEN : X_OIKEA;
    const avain = `${puoli}-${n.era.avain}`;
    const himmea = korostettu !== null && korostettu !== avain;
    const tapahtumat = {
      onMouseMove: (e: MouseEvent) => {
        setKorostettu(avain);
        nayta(
          e,
          <VihjeSisalto
            nimi={n.era.nimi}
            summa={muotoileEuroPyorea(n.era.summa)}
            osuus={tulotYht > 0 ? `${muotoileOsuus(n.era.summa, tulotYht)} tuloista` : undefined}
          />,
        );
      },
      onMouseLeave: () => {
        setKorostettu(null);
        piilota();
      },
    };
    const polku = vasen
      ? kaistaPolku(X_VASEN + SOLMU, n.kaista, X_KESKI, n.keskella)
      : kaistaPolku(X_KESKI + SOLMU, n.keskella, X_OIKEA, n.kaista);
    const keskiY = n.y + n.h / 2;
    return (
      <g key={avain} data-testid={`virta-${avain}`}>
        <path
          d={polku}
          fill={n.vari}
          fillOpacity={korostettu === avain ? 0.45 : himmea ? 0.12 : 0.24}
          className="transition-[fill-opacity] duration-100"
          {...tapahtumat}
        />
        <rect
          x={x}
          y={n.y}
          width={SOLMU}
          height={n.h}
          rx={2}
          fill={n.vari}
          opacity={himmea ? 0.5 : 1}
          {...tapahtumat}
        />
        <text
          x={vasen ? x - 8 : x + SOLMU + 8}
          y={keskiY - 3}
          textAnchor={vasen ? 'end' : 'start'}
          className="fill-[var(--text)] text-[11.5px] font-medium"
        >
          {n.era.nimi}
        </text>
        <text
          x={vasen ? x - 8 : x + SOLMU + 8}
          y={keskiY + 11}
          textAnchor={vasen ? 'end' : 'start'}
          className="fill-[var(--text-muted)] text-[11px] tabular-nums"
        >
          {muotoileEuroPyorea(n.era.summa)}
        </text>
      </g>
    );
  };

  return (
    <div ref={kaare} className="relative">
      <svg
        viewBox={`0 0 ${LEVEYS} ${asettelu.korkeus}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Tulot: ${kuvaus(asettelu.vasen)}. Kulut: ${kuvaus(asettelu.oikea)}.`}
      >
        {asettelu.vasen.map((n) => solmu(n, 'vasen'))}
        {asettelu.oikea.map((n) => solmu(n, 'oikea'))}
        <rect
          x={X_KESKI}
          y={asettelu.keski.y}
          width={SOLMU}
          height={asettelu.keski.h}
          rx={2}
          fill="var(--accent)"
        />
        <text
          x={X_KESKI + SOLMU / 2}
          y={asettelu.keski.y - 10}
          textAnchor="middle"
          className="fill-[var(--text)] text-[11.5px] font-semibold"
        >
          {keskiNimi}
        </text>
      </svg>
      <Vihje vihje={vihje} />
    </div>
  );
}
