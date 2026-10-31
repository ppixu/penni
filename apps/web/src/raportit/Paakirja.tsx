import { useInit, useKumppanit, useSaldot, useTositteet } from '@/app/kysely';
import { tiliRajauksessa } from '@/tilikartta/tilinakyma';
import { type Tili, lataaKartta, nimi } from '@penni/engine';
import { muotoileEuro, muotoilePvm } from '@penni/euro';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { Lataustila } from './Lataustila';
import { kirjaRivit, paakirjaTilit, riviSelite } from './kirjaRivit';
import type { RaporttiProps } from './raporttiProps';

const OTSIKKO = 'px-[10px] pb-[7px] text-[9px] font-semibold uppercase tracking-[0.6px]';

/**
 * Pääkirja (laatijanpaakirja.cpp): tileittäin tilin otsikkorivi alkusaldoineen, jakson viennit
 * (Pvm, Tosite, Selite, Debet, Kredit, juokseva Saldo) ja tilin summarivi. Alkusaldo haetaan
 * saldot-resurssilla `alkusaldot`-valinnalla jakson alkupäivälle (laatijanpaakirja.cpp:28-30):
 * tase-tileillä saldo ennen jaksoa, tulostileillä tilikauden alusta jakson alkuun. Saldon
 * etumerkki: vastaavaa-tilit debet − kredit, kaikki muut kredit − debet (kredit-tilit positiivisia).
 * Tilikartasta tultaessa näytetään vain rajauksen tili tai tiliryhmä (`tilirajaus`).
 * Kohdennus-, kumppani- ja ALV-sarakkeet puuttuvat.
 */
export function Paakirja({ alkupvm, loppupvm, tilirajaus }: RaporttiProps) {
  const { data: init, isError: initVirhe } = useInit();
  const { data: tositteet, isError: tositteetVirhe } = useTositteet({ alkupvm, loppupvm });
  const { data: alkusaldot, isError: saldotVirhe } = useSaldot({
    pvm: alkupvm,
    alkusaldot: true,
  });
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
  const ryhmat = useMemo(
    () =>
      paakirjaTilit(kirjaRivit(tositteet ?? [], alkupvm, loppupvm), alkusaldot).filter(
        (r) => !tilirajaus || tiliRajauksessa(r.tili, tilirajaus),
      ),
    [tositteet, alkusaldot, alkupvm, loppupvm, tilirajaus],
  );

  if (!tositteet || !alkusaldot || !init)
    return <Lataustila virhe={initVirhe || tositteetVirhe || saldotVirhe} />;
  if (ryhmat.length === 0)
    return (
      <p className="text-[13px] text-[var(--text-muted)]">
        {tilirajaus
          ? 'Rajauksen tileillä ei ole kirjauksia eikä saldoa tällä tilikaudella.'
          : 'Jaksolla ei ole kirjauksia.'}
      </p>
    );

  return (
    <table className="w-full border-collapse text-[12.5px]" aria-label="Pääkirja">
      <thead>
        <tr className="text-left text-[var(--text-subtle)]">
          <th className={`${OTSIKKO} w-[90px]`}>Pvm</th>
          <th className={`${OTSIKKO} w-[80px]`}>Tosite</th>
          <th className={OTSIKKO}>Selite</th>
          <th className={`${OTSIKKO} text-right`}>Debet €</th>
          <th className={`${OTSIKKO} text-right`}>Kredit €</th>
          <th className={`${OTSIKKO} text-right`}>Saldo €</th>
        </tr>
      </thead>
      {ryhmat.map((ryhma) => {
        const tili = tilit.get(ryhma.tili);
        return (
          <tbody key={ryhma.tili} className="break-inside-avoid">
            <tr className="font-semibold">
              <td className="px-[10px] pb-[3px] pt-[14px]" colSpan={5}>
                <Link
                  to="/tilikartta"
                  search={{ nakyma: 'kaikki', tili: ryhma.tili }}
                  className="hover:text-[var(--accent)] hover:underline"
                >
                  {tili ? `${ryhma.tili} ${nimi(tili)}` : `${ryhma.tili} (tili puuttuu)`}
                </Link>
              </td>
              <td
                className="px-[10px] pb-[3px] pt-[14px] text-right tabular-nums"
                aria-label={`Alkusaldo ${ryhma.tili}`}
              >
                {muotoileEuro(ryhma.alkusaldo)}
              </td>
            </tr>
            {ryhma.rivit.map((r) => (
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
                <td className="px-[10px] py-[4px] text-[var(--text-muted)]">
                  {riviSelite(r, kumppaninNimi)}
                </td>
                <td className="px-[10px] py-[4px] text-right tabular-nums">
                  {r.debet === 0 ? '' : muotoileEuro(r.debet)}
                </td>
                <td className="px-[10px] py-[4px] text-right tabular-nums">
                  {r.kredit === 0 ? '' : muotoileEuro(r.kredit)}
                </td>
                <td className="px-[10px] py-[4px] text-right tabular-nums">
                  {muotoileEuro(r.saldo)}
                </td>
              </tr>
            ))}
            {ryhma.rivit.length > 0 && (
              <tr className="border-t border-[var(--border)] font-semibold">
                <td className="px-[10px] py-[5px]" colSpan={2}>
                  Yhteensä
                </td>
                <td className="px-[10px] py-[5px] text-right tabular-nums text-[var(--text-muted)]">
                  {`Muutos ${muotoileEuro(ryhma.muutos)}`}
                </td>
                <td className="px-[10px] py-[5px] text-right tabular-nums">
                  {muotoileEuro(ryhma.debet)}
                </td>
                <td className="px-[10px] py-[5px] text-right tabular-nums">
                  {muotoileEuro(ryhma.kredit)}
                </td>
                <td className="px-[10px] py-[5px] text-right tabular-nums">
                  {muotoileEuro(ryhma.loppusaldo)}
                </td>
              </tr>
            )}
          </tbody>
        );
      })}
    </table>
  );
}
