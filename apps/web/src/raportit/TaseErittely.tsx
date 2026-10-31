import { useInit, useKumppanit, useSaldot, useTositteet } from '@/app/kysely';
import {
  type IsoDate,
  type ListattuTosite,
  Luonne,
  type Tili,
  lataaKartta,
  nimi,
  onko,
  onkoVastaavaa,
} from '@penni/engine';
import { type Cents, Euro, muotoileEuro, muotoilePvm } from '@penni/euro';
import { Link } from '@tanstack/react-router';
import { Fragment, useMemo } from 'react';
import { Lataustila } from './Lataustila';
import type { RaporttiProps } from './raporttiProps';

/** Yksi tilin tilikauden vienti erittelyssä. */
export interface ErittelyRivi {
  pvm: IsoDate;
  tosite: string;
  kumppani: string;
  selite: string;
  summa: Cents;
}

/** Yksi tase-erittelyn tili: loppusaldo, ja eritellyillä tileillä myös alkusaldo ja viennit. */
export interface ErittelyTili {
  tili: Tili;
  alkusaldo: Cents;
  loppusaldo: Cents;
  /** Vain tileillä, joilla erittely > 0 (eritellaankoTase). */
  rivit?: ErittelyRivi[];
}

const nolla = Euro.fromCents(0);

/** Tositteen tunnus kuten tositelistassa: "sarja tunniste" (tositteet.index.tsx). */
function tositeTunnus(t: ListattuTosite): string {
  return t.tunniste > 0 ? `${t.sarja} ${t.tunniste}`.trim() : '';
}

/**
 * Tase-erittelyn tilit ryhmiteltynä (laatijantaseerittely.cpp:57-377). Mukaan tulevat taselaskennan
 * tilit, joilla on nollasta poikkeava loppusaldo `loppupvm`:ssä (Kitsaksen "piilota nollasaldot"
 * päällä; ei valinta Pennissä). Vastaavaa- ja vastattavaa-ryhmä jaetaan tilin luonteesta; kumpikin
 * numerojärjestyksessä (Kitsas lajittelee tilinumeron mukaan, :61-75).
 *
 * Tilit, joilla erittely > 0, saavat alkusaldon ja jakson viennit (Kitsaksen tyyppi 'M',
 * :251-285); jos jaksolla ei ole vientejä, näytetään pelkkä loppusaldo (:146-147). Kitsas erittelee lisäksi
 * tase-erät ('T', :165) ja avoimet erät ('E', :287); Pennissä ei ole eräsaldomallia, joten kaikki erittelevät tilit näytetään
 * M-tyylisenä: alkusaldo + jakson viennit + loppusaldo.
 *
 * Summat ovat tilin normaalissa etumerkissä kuten `haeSaldot` (vastaavaa debet−kredit, muut
 * kredit−debet), joten vastaavaa yhteensä = vastattavaa yhteensä.
 */
export function laadiErittely(
  tilit: readonly Tili[],
  alku: ReadonlyMap<number, Cents>,
  loppu: ReadonlyMap<number, Cents>,
  tositteet: readonly ListattuTosite[],
  alkupvm: IsoDate,
  loppupvm: IsoDate,
  kumppaniNimi: (id: number | undefined) => string,
): { vastaavaa: ErittelyTili[]; vastattavaa: ErittelyTili[] } {
  const lehdet = new Map<number, Tili>(
    tilit.filter((t) => t.otsikkotaso === 0).map((t) => [t.numero, t]),
  );
  const vastaavaa: ErittelyTili[] = [];
  const vastattavaa: ErittelyTili[] = [];

  for (const numero of [...loppu.keys()].sort((a, b) => a - b)) {
    const tili = lehdet.get(numero);
    const loppusaldo = loppu.get(numero) ?? nolla;
    if (!tili || loppusaldo === 0) continue;
    const ryhma = onko(tili.luonne, Luonne.VASTAAVAA)
      ? vastaavaa
      : onko(tili.luonne, Luonne.VASTATTAVAA)
        ? vastattavaa
        : undefined;
    if (!ryhma) continue;

    const rivi: ErittelyTili = { tili, alkusaldo: alku.get(numero) ?? nolla, loppusaldo };
    if (tili.erittely > 0) {
      const merkki = onkoVastaavaa(numero) ? 1 : -1;
      const rivit: (ErittelyRivi & { jarjestys: number })[] = [];
      for (const t of tositteet) {
        for (const v of t.viennit) {
          if (v.tili !== numero || v.pvm < alkupvm || v.pvm > loppupvm) continue;
          rivit.push({
            pvm: v.pvm,
            tosite: tositeTunnus(t),
            kumppani: kumppaniNimi(t.kumppani),
            selite: v.selite ?? t.otsikko ?? '',
            summa: Euro.fromCents(merkki * (v.debet - v.kredit)),
            jarjestys: t.id,
          });
        }
      }
      rivit.sort((a, b) => a.pvm.localeCompare(b.pvm) || a.jarjestys - b.jarjestys);
      // Ei vientejä jaksolla: pelkkä saldorivi (Kitsas :146-147).
      if (rivit.length > 0) rivi.rivit = rivit.map(({ jarjestys: _j, ...r }) => r);
    }
    ryhma.push(rivi);
  }
  return { vastaavaa, vastattavaa };
}

const summaYhteensa = (tilit: readonly ErittelyTili[]): Cents =>
  tilit.reduce<Cents>((s, t) => Euro.add(s, t.loppusaldo), nolla);

/**
 * Tase-erittely (Kitsas: laatijantaseerittely.cpp): taseen tilit loppusaldoineen ja erittelevien
 * tilien viennit. Vastaavaa ja vastattavaa omissa ryhmissään summineen.
 */
export function TaseErittely({ alkupvm, loppupvm }: RaporttiProps) {
  const { data: init, isError: initVirhe } = useInit();
  const { data: tositteet, isError: tositteetVirhe } = useTositteet({ alkupvm, loppupvm });
  const { data: kumppanit, isError: kumppanitVirhe } = useKumppanit();
  const { data: alku, isError: alkuVirhe } = useSaldot({
    pvm: alkupvm,
    alkusaldot: true,
    tase: true,
  });
  const { data: loppu, isError: loppuVirhe } = useSaldot({ pvm: loppupvm, tase: true });

  const ryhmat = useMemo(() => {
    if (!init || !tositteet || !kumppanit || !alku || !loppu) return undefined;
    const nimet = new Map(kumppanit.map((k) => [k.id, k.nimi]));
    return laadiErittely(
      lataaKartta(init.tilit),
      alku,
      loppu,
      tositteet,
      alkupvm,
      loppupvm,
      (id) => (id === undefined ? '' : (nimet.get(id) ?? '')),
    );
  }, [init, tositteet, kumppanit, alku, loppu, alkupvm, loppupvm]);

  if (!ryhmat) {
    const virhe = initVirhe || tositteetVirhe || kumppanitVirhe || alkuVirhe || loppuVirhe;
    return <Lataustila virhe={virhe} />;
  }

  const ryhmaTaulu = (otsikko: string, tilit: readonly ErittelyTili[]) => (
    <>
      <tr>
        <th
          scope="colgroup"
          colSpan={5}
          className="pb-1 pt-5 text-left text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]"
        >
          {otsikko}
        </th>
      </tr>
      {tilit.map((e) => {
        const otsikkoTeksti = `${e.tili.numero} ${nimi(e.tili)}`;
        const linkki = (
          <Link
            to="/tilikartta"
            search={{ nakyma: 'kaikki', tili: e.tili.numero }}
            className="hover:text-[var(--accent)] hover:underline"
          >
            {otsikkoTeksti}
          </Link>
        );
        if (!e.rivit) {
          // Erittelemätön tili: pelkkä loppusaldo (Kitsaksen 'S', :146-157).
          return (
            <tr key={e.tili.numero} className="border-b border-[var(--border-faint)]">
              <td colSpan={4} className="py-[5px] font-semibold">
                {linkki}
              </td>
              <td className="py-[5px] text-right font-semibold tabular-nums">
                {muotoileEuro(e.loppusaldo)}
              </td>
            </tr>
          );
        }
        return (
          <Fragment key={e.tili.numero}>
            <tr>
              <td colSpan={5} className="pb-1 pt-3 font-semibold">
                {linkki}
              </td>
            </tr>
            <tr className="border-b border-[var(--border-faint)] text-[var(--text-muted)]">
              <td colSpan={4} className="py-[3px]">
                {`Alkusaldo ${muotoilePvm(alkupvm)}`}
              </td>
              <td className="py-[3px] text-right tabular-nums">{muotoileEuro(e.alkusaldo)}</td>
            </tr>
            {e.rivit.map((r, i) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: laskettu, järjestetty lista
                key={i}
                className="border-b border-[var(--border-faint)] text-[12.5px]"
              >
                <td className="whitespace-nowrap py-[3px] pr-4">{r.tosite}</td>
                <td className="whitespace-nowrap py-[3px] pr-4">{muotoilePvm(r.pvm)}</td>
                <td className="py-[3px] pr-4 text-[var(--text-muted)]">{r.kumppani}</td>
                <td className="py-[3px] pr-4">{r.selite}</td>
                <td className="py-[3px] text-right tabular-nums">{muotoileEuro(r.summa)}</td>
              </tr>
            ))}
            <tr className="border-b border-[var(--border)] font-semibold">
              <td colSpan={4} className="py-[5px]">
                {`Tilin ${e.tili.numero} loppusaldo`}
              </td>
              <td className="py-[5px] text-right tabular-nums">{muotoileEuro(e.loppusaldo)}</td>
            </tr>
          </Fragment>
        );
      })}
      <tr className="border-t border-[var(--border)]">
        <td colSpan={4} className="py-[6px] font-semibold uppercase">
          {`${otsikko} yhteensä`}
        </td>
        <td className="py-[6px] text-right font-semibold tabular-nums">
          {muotoileEuro(summaYhteensa(tilit))}
        </td>
      </tr>
    </>
  );

  if (ryhmat.vastaavaa.length === 0 && ryhmat.vastattavaa.length === 0) {
    return (
      <p className="text-[13px] text-[var(--text-muted)]">
        Taseella ei ole saldoa tilikauden lopussa.
      </p>
    );
  }

  return (
    <table className="w-full max-w-4xl border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-[var(--border)] text-left">
          <th scope="col" className="py-[5px] pr-4 font-semibold">
            Tosite
          </th>
          <th scope="col" className="py-[5px] pr-4 font-semibold">
            Päivämäärä
          </th>
          <th scope="col" className="py-[5px] pr-4 font-semibold">
            Kumppani
          </th>
          <th scope="col" className="py-[5px] pr-4 font-semibold">
            Selite
          </th>
          <th scope="col" className="py-[5px] text-right font-semibold">
            €
          </th>
        </tr>
      </thead>
      <tbody>
        {ryhmaTaulu('Vastaavaa', ryhmat.vastaavaa)}
        {ryhmaTaulu('Vastattavaa', ryhmat.vastattavaa)}
      </tbody>
    </table>
  );
}
