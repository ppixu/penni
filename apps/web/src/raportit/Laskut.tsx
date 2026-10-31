import { useKumppanit, useMyyntilaskut, useOstolaskut } from '@/app/kysely';
import { TositeTyyppi } from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';
import { useMemo, useState } from 'react';
import { Lataustila } from './Lataustila';
import type { RaporttiProps } from './raporttiProps';

const OTSIKKO =
  'pb-[7px] pr-[10px] text-left text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

/** Laskuraportin rivi, yhteinen myynti- ja ostolaskuille. */
interface LaskuRivi {
  tosite: number;
  tunnus: string;
  numero: string;
  pvm: string | undefined;
  erapvm: string | undefined;
  kumppani: string;
  summa: Cents;
  avoin: Cents;
  tyyppi: number;
}

/**
 * Laskut (Kitsas laatijanlaskut.cpp:15-127): myynti- ja ostolaskut omina osioinaan, sarakkeina
 * numero/viite, laskupvm, eräpvm, summa, maksamatta ja asiakas/toimittaja, Yhteensä-rivi osion
 * lopussa. "Vain avoimet" (Kitsas VainAvoimet, :31) on oletuksena päällä: silloin listataan kaikki
 * kauden loppuun mennessä laskutetut laskut, joilla on avointa saldoa kauden loppupäivänä
 * (saldopvm = loppupvm, :34), laskun iästä riippumatta — edellisiltä kausilta avoinna olevat
 * laskut kuuluvat avoimiin. Ilman rajausta listataan kauden aikana laskutetut laskut (laskupvm
 * rajaus, :22-25) saldoineen kauden lopussa. Kitsaksen eräpäivärajaus, lajittelu, viitenäkymä ja
 * Kitsas-laskujen suodatus puuttuvat; lajittelu on laskupäivän mukaan.
 */
export function Laskut({ alkupvm, loppupvm }: RaporttiProps) {
  const [vainAvoimet, setVainAvoimet] = useState(true);
  const suodatin = vainAvoimet
    ? { loppupvm, avoin: true, saldopvm: loppupvm }
    : { alkupvm, loppupvm, saldopvm: loppupvm };
  const { data: myynti, isError: myyntiVirhe } = useMyyntilaskut(suodatin);
  const { data: osto, isError: ostoVirhe } = useOstolaskut(suodatin);
  const { data: kumppanit } = useKumppanit();

  const nimet = useMemo(() => new Map((kumppanit ?? []).map((k) => [k.id, k.nimi])), [kumppanit]);
  const myyntiRivit = useMemo<LaskuRivi[] | undefined>(
    () =>
      myynti?.map((r) => ({
        tosite: r.tosite,
        tunnus: r.tunniste > 0 ? `${r.sarja} ${r.tunniste}`.trim() : '',
        numero: r.numero ?? '',
        pvm: r.pvm,
        erapvm: r.erapvm,
        kumppani: r.asiakas ?? '',
        summa: r.summa,
        avoin: r.avoin,
        tyyppi: r.tyyppi,
      })),
    [myynti],
  );
  const ostoRivit = useMemo<LaskuRivi[] | undefined>(
    () =>
      osto?.map((r) => ({
        tosite: r.tosite,
        tunnus: r.tunniste > 0 ? `${r.sarja} ${r.tunniste}`.trim() : '',
        numero: r.viite ?? '',
        pvm: r.pvm,
        erapvm: r.erapvm,
        kumppani: r.toimittaja ?? (r.kumppani !== undefined ? (nimet.get(r.kumppani) ?? '') : ''),
        summa: r.summa,
        avoin: r.avoin,
        tyyppi: r.tyyppi,
      })),
    [osto, nimet],
  );

  return (
    <>
      <label className="mb-4 flex items-center gap-2 text-[12.5px] text-[var(--text-muted)] print:hidden">
        <input
          type="checkbox"
          checked={vainAvoimet}
          onChange={(e) => setVainAvoimet(e.target.checked)}
        />
        Vain avoimet
      </label>
      <Osio
        otsikko={vainAvoimet ? 'Avoimet myyntilaskut' : 'Myyntilaskut'}
        kumppaniOtsikko="Asiakas"
        numeroOtsikko="Numero"
        rivit={myyntiRivit}
        virhe={myyntiVirhe}
        tyhja={vainAvoimet ? 'Ei avoimia myyntilaskuja.' : 'Ei myyntilaskuja tällä kaudella.'}
      />
      <Osio
        otsikko={vainAvoimet ? 'Avoimet ostolaskut' : 'Ostolaskut'}
        kumppaniOtsikko="Toimittaja"
        numeroOtsikko="Viite"
        rivit={ostoRivit}
        virhe={ostoVirhe}
        tyhja={vainAvoimet ? 'Ei avoimia ostolaskuja.' : 'Ei ostolaskuja tällä kaudella.'}
      />
    </>
  );
}

interface OsioProps {
  otsikko: string;
  kumppaniOtsikko: string;
  numeroOtsikko: string;
  rivit: LaskuRivi[] | undefined;
  virhe: boolean;
  tyhja: string;
}

function Osio({ otsikko, kumppaniOtsikko, numeroOtsikko, rivit, virhe, tyhja }: OsioProps) {
  // Hyvityslaskut ja maksumuistutukset eivät kasvata avoimien summaa, koska ne ovat jo laskun
  // osalta mukana (Kitsas laatijanlaskut.cpp:101-103).
  const summat = useMemo(() => {
    let summa = 0;
    let avoin = 0;
    for (const r of rivit ?? []) {
      summa += r.summa;
      if (r.tyyppi !== TositeTyyppi.HYVITYSLASKU && r.tyyppi !== TositeTyyppi.MAKSUMUISTUTUS)
        avoin += r.avoin;
    }
    return { summa: summa as Cents, avoin: avoin as Cents };
  }, [rivit]);

  return (
    <section className="mb-8" aria-label={otsikko}>
      <h2 className="mb-2 text-[14px] font-semibold">{otsikko}</h2>
      {!rivit ? (
        <Lataustila virhe={virhe} />
      ) : rivit.length === 0 ? (
        <p className="text-[13.5px] text-[var(--text-muted)]">{tyhja}</p>
      ) : (
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className={OTSIKKO}>Tosite</th>
              <th className={OTSIKKO}>{numeroOtsikko}</th>
              <th className={OTSIKKO}>Laskupvm</th>
              <th className={OTSIKKO}>Eräpvm</th>
              <th className={OTSIKKO}>{kumppaniOtsikko}</th>
              <th className={`${OTSIKKO} text-right`}>Summa</th>
              <th className={`${OTSIKKO} pr-0 text-right`}>Avoinna</th>
            </tr>
          </thead>
          <tbody>
            {rivit.map((r) => (
              <tr key={r.tosite} className="border-b border-[var(--border-faint)]">
                <td className="py-[5px] pr-[10px] tabular-nums">{r.tunnus}</td>
                <td className="py-[5px] pr-[10px] tabular-nums">{r.numero}</td>
                <td className="py-[5px] pr-[10px] tabular-nums">
                  {r.pvm ? muotoilePvm(r.pvm) : ''}
                </td>
                <td className="py-[5px] pr-[10px] tabular-nums">
                  {r.erapvm ? muotoilePvm(r.erapvm) : ''}
                </td>
                <td className="py-[5px] pr-[10px]">{r.kumppani}</td>
                <td className="py-[5px] pr-[10px] text-right tabular-nums">
                  {muotoileEuro(r.summa)}
                </td>
                <td className="py-[5px] text-right tabular-nums">{muotoileEuro(r.avoin)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="pt-[7px]" colSpan={5}>
                {`Yhteensä (${rivit.length} laskua)`}
              </td>
              <td className="pr-[10px] pt-[7px] text-right tabular-nums">
                {muotoileEuro(summat.summa)}
              </td>
              <td className="pt-[7px] text-right tabular-nums">{muotoileEuro(summat.avoin)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}
