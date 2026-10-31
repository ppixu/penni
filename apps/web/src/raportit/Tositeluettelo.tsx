import { useKumppanit, useTositteet } from '@/app/kysely';
import { vientienSumma } from '@/lib/tosite';
import type { ListattuTosite } from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';
import { useMemo } from 'react';
import { Lataustila } from './Lataustila';
import type { RaporttiProps } from './raporttiProps';

const OTSIKKO =
  'pb-[7px] pr-[10px] text-left text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

/** Tositteen tunnus kuten tositelistassa (tositteet.index.tsx): sarja ja juokseva numero. */
function tositeTunnus(t: ListattuTosite): string {
  return t.tunniste > 0 ? `${t.sarja} ${t.tunniste}`.trim() : '';
}

/**
 * Tositeluettelo (Kitsas laatijantositeluettelo.cpp:14-130): kauden kirjatut tositteet
 * päivämääräjärjestyksessä (Kitsaksen oletus "pvm", ei tositelajeittain ryhmiteltynä), sarakkeina
 * tosite, pvm, asiakas/toimittaja (:44-45), otsikko, liitteet (:46-49) ja summa; Yhteensä-rivi
 * lopussa (:114-122). Summa on tositteen vientien debet-summa. Kitsaksen valinnat (ryhmittely
 * tositelajeittain, tosite-/päiväjärjestys, päivien erittely, kumppanisarakkeen piilotus) puuttuvat.
 */
export function Tositeluettelo({ alkupvm, loppupvm }: RaporttiProps) {
  const { data: tositteet, isError } = useTositteet({ alkupvm, loppupvm });
  const { data: kumppanit } = useKumppanit();

  const nimet = useMemo(() => new Map((kumppanit ?? []).map((k) => [k.id, k.nimi])), [kumppanit]);
  // Pvm, sitten sarja ja tunniste; samalla päivällä järjestys on siis tositenumerojärjestys.
  const rivit = useMemo(
    () =>
      [...(tositteet ?? [])].sort(
        (a, b) =>
          a.pvm.localeCompare(b.pvm) || a.sarja.localeCompare(b.sarja) || a.tunniste - b.tunniste,
      ),
    [tositteet],
  );
  const yhteensa = useMemo(
    () => rivit.reduce((s, t) => s + vientienSumma(t.viennit), 0) as Cents,
    [rivit],
  );

  if (!tositteet) return <Lataustila virhe={isError} />;
  if (rivit.length === 0)
    return <p className="text-[13.5px] text-[var(--text-muted)]">Ei tositteita tällä kaudella.</p>;

  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr>
          <th className={OTSIKKO}>Tosite</th>
          <th className={OTSIKKO}>Pvm</th>
          <th className={OTSIKKO}>Otsikko</th>
          <th className={OTSIKKO}>Asiakas/Toimittaja</th>
          <th className={`${OTSIKKO} text-right`}>Liitteitä</th>
          <th className={`${OTSIKKO} pr-0 text-right`}>Summa</th>
        </tr>
      </thead>
      <tbody>
        {rivit.map((t) => (
          <tr key={t.id} className="border-b border-[var(--border-faint)]">
            <td className="py-[5px] pr-[10px] tabular-nums">{tositeTunnus(t)}</td>
            <td className="py-[5px] pr-[10px] tabular-nums">{muotoilePvm(t.pvm)}</td>
            <td className="py-[5px] pr-[10px]">{t.otsikko ?? ''}</td>
            <td className="py-[5px] pr-[10px] text-[var(--text-muted)]">
              {t.kumppani !== undefined ? (nimet.get(t.kumppani) ?? '') : ''}
            </td>
            <td className="py-[5px] pr-[10px] text-right tabular-nums text-[var(--text-muted)]">
              {t.liitteita > 0 ? `${t.liitteita} kpl` : ''}
            </td>
            <td className="py-[5px] text-right tabular-nums">
              {muotoileEuro(vientienSumma(t.viennit))}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-semibold">
          <td className="pt-[7px]" colSpan={5}>
            {`Yhteensä (${rivit.length} tositetta)`}
          </td>
          <td className="pt-[7px] text-right tabular-nums">{muotoileEuro(yhteensa)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
