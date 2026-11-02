import { useInit, useKohdennukset, useKumppanit, useTositteet } from '@/app/kysely';
import { Linkki } from '@/components/Linkki';
import { kohdennusSolunTeksti } from '@/kohdennukset/kohdennusTeksti';
import {
  type Tili,
  kohdennusSuodatin,
  lataaKartta,
  nimi,
  vientiSuodattimessa,
} from '@penni/engine';
import { muotoileEuro, muotoilePvm } from '@penni/euro';
import { useMemo } from 'react';
import { Lataustila } from './Lataustila';
import { kirjaRivit, riviSelite, summaa } from './kirjaRivit';
import type { RaporttiProps } from './raporttiProps';

const OTSIKKO = 'px-[10px] pb-[7px] text-[9px] font-semibold uppercase tracking-[0.6px]';

/**
 * Päiväkirja (laatijanpaivakirja.cpp): kaikki jakson viennit päivämääräjärjestyksessä, sarakkeina
 * Pvm, Tosite, Tili, Selite, Kohdennus, Debet ja Kredit, ja alimpana summarivi (vientien
 * lukumäärä, Σdebet, Σkredit). Kohdennus-sarake näkyy, kun kirjassa on kohdennuksia (:171), ja
 * kohdennussuodatin (`kohdennus`) rajaa kaikkien tilien rivit, ALV-rivit mukaan lukien (ne
 * perivät peruskirjauksen kohdennuksen). ALV- ja tositelajiryhmittelyvalinnat sekä kumppanisarake
 * puuttuvat; selite puuttuessa näytetään kumppanin nimi kuten Kitsaksessa
 * (laatijanpaivakirja.cpp:166-168).
 */
export function Paivakirja({ alkupvm, loppupvm, kohdennus }: RaporttiProps) {
  const { data: init, isError: initVirhe } = useInit();
  const { data: tositteet, isError: tositteetVirhe } = useTositteet({ alkupvm, loppupvm });
  const { data: kumppanit } = useKumppanit();
  const { data: kohdennukset, isError: kohdennuksetVirhe } = useKohdennukset();

  const tilit = useMemo(() => {
    const kartta = new Map<number, Tili>();
    for (const t of lataaKartta(init?.tilit ?? [])) kartta.set(t.numero, t);
    return kartta;
  }, [init]);
  const kumppaninNimi = useMemo(() => {
    const nimet = new Map((kumppanit ?? []).map((k) => [k.id, k.nimi]));
    return (id: number) => nimet.get(id);
  }, [kumppanit]);
  const rivit = useMemo(() => {
    const kaikki = kirjaRivit(tositteet ?? [], alkupvm, loppupvm);
    if (kohdennus === undefined) return kaikki;
    const suodatin = kohdennusSuodatin(kohdennukset ?? [], kohdennus);
    return kaikki.filter((r) => vientiSuodattimessa(suodatin, r));
  }, [tositteet, alkupvm, loppupvm, kohdennus, kohdennukset]);
  const summat = useMemo(() => summaa(rivit), [rivit]);

  if (!tositteet || !init || !kohdennukset)
    return <Lataustila virhe={initVirhe || tositteetVirhe || kohdennuksetVirhe} />;
  const kohdennusSarake = kohdennukset.length > 0;
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
          {kohdennusSarake && <th className={OTSIKKO}>Kohdennus</th>}
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
                <Linkki
                  to="/tositteet/$id"
                  params={{ id: String(r.tositeId) }}
                  className="hover:text-[var(--accent)] hover:underline"
                >
                  {r.tosite || 'Luonnos'}
                </Linkki>
              </td>
              <td className="px-[10px] py-[4px]">
                <Linkki
                  to="/tilikartta"
                  search={{ nakyma: 'kaikki', tili: r.tili }}
                  className="hover:text-[var(--accent)] hover:underline"
                >
                  {tili ? `${r.tili} ${nimi(tili)}` : `${r.tili} (tili puuttuu)`}
                </Linkki>
              </td>
              <td className="px-[10px] py-[4px] text-[var(--text-muted)]">
                {riviSelite(r, kumppaninNimi)}
              </td>
              {kohdennusSarake && (
                <td className="px-[10px] py-[4px] text-[var(--text-muted)]">
                  {kohdennusSolunTeksti(r.kohdennus, r.merkkaukset, kohdennukset)}
                </td>
              )}
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
          <td className="px-[10px] py-[6px]" colSpan={kohdennusSarake ? 4 : 3}>
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
