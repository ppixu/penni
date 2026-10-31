import { TaittuvaOtsikko } from '@/components/TaittuvaOtsikko';
import {
  type AlvErittely,
  type AlvLaskelmaTulos,
  type Tili,
  ryhmitteleAlvErittely,
  nimi as tilinNimi,
} from '@penni/engine';
import { type Cents, muotoileEuro } from '@penni/euro';
import { Link } from '@tanstack/react-router';
import { Fragment, type ReactNode, useId, useMemo } from 'react';
import type { AlvKausi } from './alvKaudet.js';
import { koodiRivit } from './alvKoodit.js';

/** 'YYYY-MM-DD' -> 'dd.mm.yyyy' etunollin (Kitsas toString("dd.MM.yyyy"), alvlaskelma.cpp:111). */
export function kitsasPvm(iso: string): string {
  const [vuosi, kuukausi, paiva] = iso.split('-');
  if (vuosi === undefined || kuukausi === undefined || paiva === undefined) return iso;
  return `${paiva}.${kuukausi}.${vuosi}`;
}

/** Verokanta sadasosina -> "25,50" (Kitsas %L1 'f' 2, alvlaskelma.cpp:392) kokonaisluvuin. */
export function muotoileKanta(kanta: number): string {
  const merkki = kanta < 0 ? '−' : '';
  const a = Math.abs(kanta);
  return `${merkki}${Math.trunc(a / 100)},${String(a % 100).padStart(2, '0')}`;
}

/** Summa ilman perässä olevaa €-merkkiä — sarakkeen otsikko on "€" (alvlaskelma.cpp:118, :126). */
export function muotoileSumma(c: Cents): string {
  return muotoileEuro(c).replace(/\u00A0€$/, '');
}

const SARAKKEET = ['Pvm', 'Tosite', 'Asiakas/Toimittaja', 'Selite', '%', '€'] as const;
const OTSIKKO =
  'pb-[6px] text-left text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const OSIO = 'pt-4 pb-2 text-[14px] font-[650]';
const NUMERO = 'text-right tabular-nums';
const RIVI = 'print:break-inside-avoid';
/** Otsikkorivi pysyy tulosteessa yhdessä seuraavan rivinsä kanssa (ei jää sivun viimeiseksi). */
const OTSIKKORIVI = `${RIVI} print:break-after-avoid`;
const TAULU = 'w-full table-fixed border-collapse';
/** Taitettu osio pysyy DOMissa ja tulostuu aina kokonaan. */
const TAITETTU_RIVIT = 'hidden print:table-row-group';

/** Dokumentin taittuvat osiot; tila elää kutsujalla, jotta se säilyy kauden vaihdon yli. */
export type DokumenttiOsio = 'laskelma' | 'erittely';

/** Kitsasin sarakkeet (alvlaskelma.cpp:113-127); <thead> toistuu tulosteen jokaisella sivulla. */
function Sarakkeet({ auki }: { auki: boolean }) {
  return (
    <>
      <colgroup>
        <col className="w-[88px]" />
        <col className="w-[64px]" />
        <col />
        <col />
        <col className="w-[56px]" />
        <col className="w-[104px]" />
      </colgroup>
      <thead className={auki ? undefined : 'hidden print:table-header-group'}>
        <tr className="border-b border-[var(--border)]">
          {SARAKKEET.map((s, i) => (
            <th key={s} scope="col" className={`${OTSIKKO} ${i >= 4 ? 'text-right' : ''}`}>
              {s}
            </th>
          ))}
        </tr>
      </thead>
    </>
  );
}

/**
 * Kitsas-mallinen arvonlisäverolaskelma (AlvLaskelma::kirjoitaLaskelma, alvlaskelma.cpp:42-55):
 * ilmoituksen tiedot (koodiRivit, 308 aina) ja erittely koodi -> kanta -> tili. Kaikki luvut
 * tulevat moottorista; komponentti vain ryhmittelee (ryhmitteleAlvErittely) ja muotoilee.
 */
export function AlvLaskelmaDokumentti({
  nimi,
  kausi,
  laskelma,
  erittely,
  tilit,
  auki,
  onVaihda,
  toiminnot,
}: {
  nimi?: string | undefined;
  kausi: AlvKausi;
  laskelma: Pick<AlvLaskelmaTulos, 'koodit' | 'maksettava'>;
  /** null = erittelyn haku epäonnistui: ilmoituksen tiedot näytetään, erittelyn tilalla virherivi. */
  erittely: AlvErittely | null;
  tilit: readonly Tili[];
  auki: Record<DokumenttiOsio, boolean>;
  onVaihda: (osio: DokumenttiOsio) => void;
  /** Kauden toiminnot (Tilitä/Tulosta) ilmoituksen tietojen ja erittelyn väliin; ei tulosteessa. */
  toiminnot?: ReactNode;
}) {
  const laskelmaId = useId();
  const erittelyId = useId();
  const ryhmat = useMemo(() => ryhmitteleAlvErittely(erittely?.rivit ?? []), [erittely]);
  const tiliOtsikko = (numero: number): string => {
    const tili = tilit.find((t) => t.numero === numero && t.otsikkotaso === 0);
    return tili ? `${numero} ${tilinNimi(tili)}` : String(numero);
  };

  return (
    <article aria-label="arvonlisäverolaskelma" className="flex flex-col text-[12.5px]">
      <header className="mb-3">
        <h2 className="text-[15px] font-[650] uppercase tracking-[0.4px]">Arvonlisäverolaskelma</h2>
        {nimi ? <p>{nimi}</p> : null}
        <p className="tabular-nums">
          {kitsasPvm(kausi.alkupvm)} – {kitsasPvm(kausi.loppupvm)}
        </p>
      </header>

      <table aria-label="alv-laskelma" className={TAULU}>
        <Sarakkeet auki={auki.laskelma} />
        <tbody>
          <tr>
            <td colSpan={6} className={OSIO}>
              <TaittuvaOtsikko
                auki={auki.laskelma}
                hallitsee={laskelmaId}
                onVaihda={() => onVaihda('laskelma')}
              >
                Arvonlisäveroilmoituksen tiedot
              </TaittuvaOtsikko>
            </td>
          </tr>
        </tbody>
        <tbody id={laskelmaId} className={auki.laskelma ? undefined : TAITETTU_RIVIT}>
          {koodiRivit(laskelma).map((r) => (
            <tr key={r.koodi} className={RIVI}>
              <td />
              <td className="py-[3px] tabular-nums">{r.koodi}</td>
              <td colSpan={3} className={`py-[3px] ${r.lihava ? 'font-semibold' : ''}`}>
                {r.nimi}
              </td>
              <td className={`py-[3px] ${NUMERO} ${r.lihava ? 'font-semibold' : ''}`}>
                {muotoileSumma(r.arvo)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {toiminnot && <div className="mt-4 flex justify-end gap-2 print:hidden">{toiminnot}</div>}

      {erittely === null ? (
        <p role="alert" className="mt-6 text-[12.5px] text-[var(--danger)]">
          Erittelyn haku epäonnistui.
        </p>
      ) : (
        <table
          aria-label="alv-erittely"
          className={`mt-6 ${TAULU} print:mt-0 print:break-before-page`}
        >
          <Sarakkeet auki={auki.erittely} />
          <tbody>
            <tr>
              <td colSpan={6} className={OSIO}>
                <TaittuvaOtsikko
                  auki={auki.erittely}
                  hallitsee={erittelyId}
                  onVaihda={() => onVaihda('erittely')}
                >
                  Erittely
                </TaittuvaOtsikko>
              </td>
            </tr>
          </tbody>
          <tbody id={erittelyId} className={auki.erittely ? undefined : TAITETTU_RIVIT}>
            {ryhmat.length === 0 && (
              <tr>
                <td colSpan={6} className="py-[3px] text-[var(--text-muted)]">
                  Kaudella ei ole arvonlisäverollisia vientejä.
                </td>
              </tr>
            )}
            {ryhmat.map((ryhma) => (
              <Fragment key={`${ryhma.alvKoodi}:${ryhma.kanta}`}>
                <tr className={`font-semibold ${OTSIKKORIVI}`}>
                  <td colSpan={4} className="pt-3 pb-[3px]">
                    {ryhma.nimi}
                  </td>
                  <td className={`pt-3 pb-[3px] ${NUMERO}`}>{muotoileKanta(ryhma.kanta)}</td>
                  <td className={`pt-3 pb-[3px] ${NUMERO}`}>{muotoileSumma(ryhma.summa)}</td>
                </tr>
                {ryhma.tilit.map((tili) => (
                  <Fragment key={tili.tili}>
                    <tr className={OTSIKKORIVI}>
                      <td colSpan={6} className="pt-1 pb-[2px]">
                        {tiliOtsikko(tili.tili)}
                      </td>
                    </tr>
                    {tili.rivit.map((v, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: vakaa järjestys, read-only näyttö
                      <tr key={i} className={RIVI}>
                        <td className="py-[2px] tabular-nums">{kitsasPvm(v.pvm)}</td>
                        <td className="py-[2px] tabular-nums">
                          {v.tosite !== undefined ? (
                            <Link
                              to="/tositteet/$id"
                              params={{ id: String(v.tosite) }}
                              className="text-[var(--accent)] hover:underline print:text-inherit print:no-underline"
                            >
                              {v.tositeNumero}
                            </Link>
                          ) : null}
                        </td>
                        <td className="break-words py-[2px]">{v.kumppani}</td>
                        <td className="break-words py-[2px]">
                          {v.selite === v.kumppani ? '' : v.selite}
                        </td>
                        <td className={`py-[2px] ${NUMERO}`}>{muotoileKanta(ryhma.kanta)}</td>
                        <td className={`py-[2px] ${NUMERO}`}>{muotoileSumma(v.summa)}</td>
                      </tr>
                    ))}
                    <tr className={RIVI}>
                      <td colSpan={4} className="pb-3" />
                      <td className={`border-t border-[var(--border)] pt-[3px] pb-3 ${NUMERO}`}>
                        {muotoileKanta(ryhma.kanta)}
                      </td>
                      <td className={`border-t border-[var(--border)] pt-[3px] pb-3 ${NUMERO}`}>
                        {muotoileSumma(tili.summa)}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
