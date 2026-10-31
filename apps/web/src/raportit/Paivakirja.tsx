import { useInit, useKumppanit, useTositteet } from '@/app/kysely';
import { type Tili, lataaKartta, nimi } from '@penni/engine';
import { muotoileEuro, muotoilePvm } from '@penni/euro';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { Lataustila } from './Lataustila';
import { kirjaRivit, riviSelite, summaa } from './kirjaRivit';
import type { RaporttiProps } from './raporttiProps';

const OTSIKKO = 'px-[10px] pb-[7px] text-[9px] font-semibold uppercase tracking-[0.6px]';

/**
 * Päiväkirja (laatijanpaivakirja.cpp): kaikki jakson viennit päivämääräjärjestyksessä, sarakkeina
 * Pvm, Tosite, Tili, Selite, Debet ja Kredit, ja alimpana summarivi (vientien lukumäärä, Σdebet,
 * Σkredit). Kohdennus-, ALV- ja tositelajiryhmittelyvalinnat sekä kumppanisarake puuttuvat; selite
 * puuttuessa näytetään kumppanin nimi kuten Kitsaksessa (laatijanpaivakirja.cpp:166-168).
 */
export function Paivakirja({ alkupvm, loppupvm }: RaporttiProps) {
  const { data: init, isError: initVirhe } = useInit();
  const { data: tositteet, isError: tositteetVirhe } = useTositteet({ alkupvm, loppupvm });
  const { data: kumppanit } = useKumppanit();

  const tilit = useMemo(() => {
    const kartta = new Map<number, Tili>();
    for (const t of lataaKartta(init?.tilit ?? [])) kartta.set(t.numero, t);
    return kartta;
  }, [init]);
  const kumppaninNimi = useMemo(() => {
    const nimet = new Map((kumppanit ?? []).map((k) => [k.id, k.nimi]));
    return (id: number) => nimet.get(id);
  }, [kumppanit]);
  const rivit = useMemo(
    () => kirjaRivit(tositteet ?? [], alkupvm, loppupvm),
    [tositteet, alkupvm, loppupvm],
  );
  const summat = useMemo(() => summaa(rivit), [rivit]);

  if (!tositteet || !init) return <Lataustila virhe={initVirhe || tositteetVirhe} />;
  if (rivit.length === 0)
    return <p className="text-[13px] text-[var(--text-muted)]">Jaksolla ei ole kirjauksia.</p>;

  return (
    <table className="w-full border-collapse text-[12.5px]" aria-label="Päiväkirja">
      <thead>
        <tr className="text-left text-[var(--text-subtle)]">
          <th className={`${OTSIKKO} w-[90px]`}>Pvm</th>
          <th className={`${OTSIKKO} w-[80px]`}>Tosite</th>
          <th className={OTSIKKO}>Tili</th>
          <th className={OTSIKKO}>Selite</th>
          <th className={`${OTSIKKO} text-right`}>Debet €</th>
          <th className={`${OTSIKKO} text-right`}>Kredit €</th>
        </tr>
      </thead>
      <tbody>
        {rivit.map((r) => {
          const tili = tilit.get(r.tili);
          return (
            <tr key={r.avain} className="border-b border-[var(--border-faint)]">
              <td className="whitespace-nowrap px-[10px] py-[4px] tabular-nums">
                {muotoilePvm(r.pvm)}
              </td>
              <td className="px-[10px] py-[4px]">
                <Link
                  to="/tositteet/$id"
                  params={{ id: String(r.tositeId) }}
                  className="hover:text-[var(--accent)] hover:underline"
                >
                  {r.tosite || 'Luonnos'}
                </Link>
              </td>
              <td className="px-[10px] py-[4px]">
                <Link
                  to="/tilikartta"
                  search={{ nakyma: 'kaikki', tili: r.tili }}
                  className="hover:text-[var(--accent)] hover:underline"
                >
                  {tili ? `${r.tili} ${nimi(tili)}` : `${r.tili} (tili puuttuu)`}
                </Link>
              </td>
              <td className="px-[10px] py-[4px] text-[var(--text-muted)]">
                {riviSelite(r, kumppaninNimi)}
              </td>
              <td className="px-[10px] py-[4px] text-right tabular-nums">
                {r.debet === 0 ? '' : muotoileEuro(r.debet)}
              </td>
              <td className="px-[10px] py-[4px] text-right tabular-nums">
                {r.kredit === 0 ? '' : muotoileEuro(r.kredit)}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t border-[var(--border)] font-semibold">
          <td className="px-[10px] py-[6px]">Yhteensä</td>
          <td className="px-[10px] py-[6px]" colSpan={3}>
            {`Vientejä ${rivit.length} kpl`}
          </td>
          <td className="px-[10px] py-[6px] text-right tabular-nums">
            {muotoileEuro(summat.debet)}
          </td>
          <td className="px-[10px] py-[6px] text-right tabular-nums">
            {muotoileEuro(summat.kredit)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
