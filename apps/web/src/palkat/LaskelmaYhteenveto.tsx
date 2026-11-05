import { muotoileBp } from '@/palkat/prosentti';
import type { PalkkaHenkilo } from '@penni/engine';
import { type Cents, muotoileEuro } from '@penni/euro';
import type { ReactNode } from 'react';
import { brutto } from './palkkaAjoTiedot';

/**
 * Palkkalaskelman esikatselu (lomake) ja palkka-ajon yhteenveto (palkanmaksun sivu). Kaikki
 * luvut tulevat laskennan tuloksesta; täällä ei lasketa muuta kuin summia.
 */

const summa = (henkilot: readonly PalkkaHenkilo[], f: (h: PalkkaHenkilo) => number): Cents =>
  henkilot.reduce((a, h) => a + f(h), 0) as Cents;

/** Työnantajan sivukulut: TyEL- ja työttömyysvakuutusmaksun työnantajan osuus ja sava. */
export const tyonantajanKulut = (h: PalkkaHenkilo): Cents =>
  (h.tulos.tyelTyonantaja + h.tulos.tvrTyonantaja + h.tulos.sava) as Cents;

const tyontekijanMaksut = (h: PalkkaHenkilo): Cents =>
  (h.tulos.tyelTyontekija + h.tulos.tvrTyontekija) as Cents;

function pidatysTeksti(h: PalkkaHenkilo): string {
  const osat = h.tulos.pidatysOsat;
  if (osat.length === 0) return '';
  return osat.map((o) => `${muotoileBp(o.bp)} %`).join(' + ');
}

function Rivi({
  otsikko,
  arvo,
  lisa,
  vahva,
}: {
  otsikko: string;
  arvo: Cents;
  lisa?: string | undefined;
  vahva?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-[3px] ${vahva ? 'border-t border-[var(--border)] pt-[6px] font-semibold text-[var(--text)]' : 'text-[var(--text-muted)]'}`}
    >
      <dt>
        {otsikko}
        {lisa ? <span className="ml-1 text-[11px] text-[var(--text-subtle)]">{lisa}</span> : null}
      </dt>
      <dd className="tabular-nums">{muotoileEuro(arvo)}</dd>
    </div>
  );
}

function Ryhma({ otsikko, children }: { otsikko: string; children: ReactNode }) {
  return (
    <div className="min-w-[220px] flex-1">
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
        {otsikko}
      </div>
      <dl className="text-[12.5px]">{children}</dl>
    </div>
  );
}

/** Yhden henkilön laskelma: palkka, vähennykset, nettopalkka ja työnantajan maksut. */
export function HenkilonLaskelma({ henkilo: h }: { henkilo: PalkkaHenkilo }) {
  const t = h.tulos;
  const p = h.prosentit;
  return (
    <section
      aria-label="Laskelma"
      className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-3"
    >
      <div className="flex flex-wrap gap-6">
        <Ryhma otsikko="Työntekijä">
          <Rivi otsikko="Bruttopalkka" arvo={brutto(h)} />
          {t.luontoisedut ? (
            <Rivi otsikko="josta luontoisedut" arvo={t.luontoisedut} lisa="(ei makseta rahana)" />
          ) : null}
          {t.verovapaat ? <Rivi otsikko="Verovapaat korvaukset" arvo={t.verovapaat} /> : null}
          <Rivi otsikko="Ennakonpidätys" arvo={t.ennakonpidatys} lisa={pidatysTeksti(h)} />
          <Rivi
            otsikko="TyEL-maksu"
            arvo={t.tyelTyontekija}
            lisa={p.tyelTyontekijaBp ? `${muotoileBp(p.tyelTyontekijaBp)} %` : undefined}
          />
          <Rivi
            otsikko="Työttömyysvakuutusmaksu"
            arvo={t.tvrTyontekija}
            lisa={p.tvrTyontekijaBp ? `${muotoileBp(p.tvrTyontekijaBp)} %` : undefined}
          />
          <Rivi otsikko="Nettopalkka" arvo={t.nettopalkka} vahva />
        </Ryhma>
        <Ryhma otsikko="Työnantajan maksut">
          <Rivi otsikko="TyEL (työnantaja)" arvo={t.tyelTyonantaja} />
          <Rivi otsikko="Työttömyysvakuutus (työnantaja)" arvo={t.tvrTyonantaja} />
          <Rivi
            otsikko="Sairausvakuutusmaksu"
            arvo={t.sava}
            lisa={p.savaBp ? `${muotoileBp(p.savaBp)} %` : undefined}
          />
          <Rivi otsikko="Sivukulut yhteensä" arvo={tyonantajanKulut(h)} vahva />
        </Ryhma>
      </div>
      {t.varoitukset.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-[12px] text-[var(--warning)]">
          {t.varoitukset.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Ajon summat: bruttopalkat, ennakonpidätykset, työnantajan kulut ja nettopalkat. */
export function AjonSummat({ henkilot }: { henkilot: readonly PalkkaHenkilo[] }) {
  const luvut: [string, Cents][] = [
    ['Bruttopalkat', summa(henkilot, brutto)],
    ['Ennakonpidätykset', summa(henkilot, (h) => h.tulos.ennakonpidatys)],
    ['Työnantajan sivukulut', summa(henkilot, tyonantajanKulut)],
    ['Nettopalkat', summa(henkilot, (h) => h.tulos.nettopalkka)],
  ];
  return (
    <section aria-label="Yhteensä" className="flex flex-wrap gap-6">
      {luvut.map(([otsikko, arvo]) => (
        <div key={otsikko} className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
            {otsikko}
          </span>
          <span className="text-[16px] font-[650] tabular-nums text-[var(--text)]">
            {muotoileEuro(arvo)}
          </span>
        </div>
      ))}
    </section>
  );
}

const SARAKKEET = [
  'Henkilö',
  'Brutto',
  'Ennakonpidätys',
  'Työntekijän maksut',
  'Verovapaat',
  'Nettopalkka',
  'Sivukulut',
];

/** Palkanmaksun sivun taulukko: henkilöittäin ja yhteensä. */
export function AjonTaulukko({ henkilot }: { henkilot: readonly PalkkaHenkilo[] }) {
  const luvut = (h: PalkkaHenkilo): Cents[] => [
    brutto(h),
    h.tulos.ennakonpidatys,
    tyontekijanMaksut(h),
    h.tulos.verovapaat,
    h.tulos.nettopalkka,
    tyonantajanKulut(h),
  ];
  const yhteensa = [
    summa(henkilot, brutto),
    summa(henkilot, (h) => h.tulos.ennakonpidatys),
    summa(henkilot, tyontekijanMaksut),
    summa(henkilot, (h) => h.tulos.verovapaat),
    summa(henkilot, (h) => h.tulos.nettopalkka),
    summa(henkilot, tyonantajanKulut),
  ];
  const solu = 'px-[10px] py-[9px]';
  return (
    <table aria-label="Palkka-ajon henkilöt" className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr>
          {SARAKKEET.map((s, i) => (
            <th
              key={s}
              className={`px-[10px] pb-[7px] text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)] ${i > 0 ? 'text-right' : 'text-left'}`}
            >
              {s}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {henkilot.map((h) => (
          <tr key={h.tyontekijaId} className="border-t border-[var(--border)]">
            <td className={solu}>{h.nimi}</td>
            {luvut(h).map((arvo, i) => (
              <td
                // biome-ignore lint/suspicious/noArrayIndexKey: kiinteät sarakkeet
                key={i}
                className={`${solu} text-right tabular-nums`}
              >
                {muotoileEuro(arvo)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-[var(--border-strong)] font-semibold">
          <td className={solu}>Yhteensä</td>
          {yhteensa.map((arvo, i) => (
            <td
              // biome-ignore lint/suspicious/noArrayIndexKey: kiinteät sarakkeet
              key={i}
              className={`${solu} text-right tabular-nums`}
            >
              {muotoileEuro(arvo)}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}
