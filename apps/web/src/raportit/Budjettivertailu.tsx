import { useBudjetti, useBudjettivertailu, useInit, useKohdennukset } from '@/app/kysely';
import { budjetoitavatKohdennukset } from '@/budjetti/budjettiTaulukko';
import { Button } from '@/components/ui/button';
import { useValittuTilikausi } from '@/tilikausi/valittuTilikausi';
import {
  type BudjettivertailuParams,
  type BudjettivertailuRivi,
  KohdennusTyyppi,
  YLEINEN_ID,
  kohdennuksenPolku,
} from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Lataustila } from './Lataustila';
import type { RaporttiProps } from './raporttiProps';

const NBSP = ' ';
const MINUS = '−'; // sama miinusmerkki kuin muotoileEuro

/**
 * Prosentti sadasosista kokonaislukuina (ei liukulukuja): 12000 → "120,00 %", -550 → "−5,50 %".
 * Tuhaterotin ja miinus kuten muotoileEuro.
 */
export function muotoileProsentti(sadasosat: number): string {
  const abs = Math.abs(sadasosat);
  const kokonaiset = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const merkki = sadasosat < 0 ? MINUS : '';
  return `${merkki}${kokonaiset},${String(abs % 100).padStart(2, '0')}${NBSP}%`;
}

const VALITSIN_OTSIKKO =
  'flex max-w-xs flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const VALITSIN =
  'rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] normal-case tracking-normal font-normal text-[var(--text)]';
const SARAKE = 'whitespace-nowrap px-3 py-[5px] text-right font-semibold';

const ISO_PVM = /^\d{4}-\d{2}-\d{2}$/;

const euro = (c: Cents | null): string => (c === null ? '' : muotoileEuro(c));

/**
 * Budjettivertailu (Kitsas: Budjettivertailu-raportti): koko tilikauden budjetti ja toteuma
 * tilikauden alusta valittuun päivään asti, jotta hallitus näkee tilanteen kesken vuoden.
 * Tilikausi valitaan näkymässä (oletus sivupalkin kausi), samoin kohdennus (kustannuspaikat,
 * projektit ja Yleinen; ei merkkauksia, koska niillä ei ole budjettia). Tuloste saa oman
 * otsikkonsa, koska kausi ja päivä ovat näkymän omia valintoja.
 */
export function Budjettivertailu({ alkupvm, muoto }: RaporttiProps) {
  const { data: init } = useInit();
  const { kaudet } = useValittuTilikausi();
  const { data: kohdennukset } = useKohdennukset();
  const [valittuKausi, setValittuKausi] = useState<string | undefined>();
  // undefined = tilikauden loppu.
  const [asti, setAsti] = useState<string | undefined>();
  // undefined = koko organisaatio (kaikki kohdennukset).
  const [kohdennus, setKohdennus] = useState<number | undefined>();

  const kausi = kaudet.find((k) => k.alkaa === (valittuKausi ?? alkupvm));
  // Keskeneräinen tai kauden ulkopuolinen päivä ei vaihda raporttia.
  const pvm =
    kausi && asti && ISO_PVM.test(asti) && asti >= kausi.alkaa && asti <= kausi.loppuu
      ? asti
      : kausi?.loppuu;

  const naytaKohdennus = (kohdennukset ?? []).some(
    (k) => k.tyyppi === KohdennusTyyppi.KUSTANNUSPAIKKA || k.tyyppi === KohdennusTyyppi.PROJEKTI,
  );
  const valittu = kohdennukset?.find((k) => k.id === kohdennus);
  const valitunNimi =
    kohdennus === YLEINEN_ID
      ? 'Yleinen'
      : valittu
        ? kohdennuksenPolku(valittu, kohdennukset ?? [])
        : undefined;
  // Kauden budjetti: budjetoitu kohdennus on valittavissa, vaikka se ei olisi voimassa kaudella.
  const { data: budjetti } = useBudjetti(kausi?.alkaa);
  const valittavat = useMemo(() => {
    if (!kausi || !kohdennukset) return [];
    const voimassa = budjetoitavatKohdennukset(kohdennukset, kausi, budjetti ?? []);
    // Valittu pysyy valittavana, vaikka se ei olisi voimassa vaihdetulla kaudella.
    return valittu && !voimassa.includes(valittu) ? [...voimassa, valittu] : voimassa;
  }, [kohdennukset, kausi, valittu, budjetti]);

  const params: BudjettivertailuParams = {
    muoto: muoto ?? '',
    tilikausi: kausi?.alkaa ?? '',
    ...(kausi && pvm && pvm !== kausi.loppuu ? { pvm } : {}),
    ...(kohdennus !== undefined ? { kohdennus } : {}),
  };
  const { data: rivit, isError } = useBudjettivertailu(params, Boolean(muoto && kausi));

  if (!muoto) {
    return (
      <p className="text-[13px] text-[var(--text-muted)]">Raporttikaavaa ei ole määritetty.</p>
    );
  }
  if (!kausi || !pvm) return <Lataustila virhe={false} />;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-5 print:hidden">
        <label className={VALITSIN_OTSIKKO}>
          Tilikausi
          <select
            value={kausi.alkaa}
            onChange={(e) => {
              setValittuKausi(e.target.value);
              setAsti(undefined);
            }}
            className={VALITSIN}
          >
            {kaudet.map((k) => (
              <option key={k.alkaa} value={k.alkaa}>
                {`${muotoilePvm(k.alkaa)} – ${muotoilePvm(k.loppuu)}`}
              </option>
            ))}
          </select>
        </label>
        <label className={VALITSIN_OTSIKKO}>
          Toteutunut asti
          <input
            type="date"
            value={asti ?? kausi.loppuu}
            min={kausi.alkaa}
            max={kausi.loppuu}
            onChange={(e) => setAsti(e.target.value)}
            className={`${VALITSIN} tabular-nums`}
          />
        </label>
        {naytaKohdennus && (
          <label className={VALITSIN_OTSIKKO}>
            Kohdennus
            <select
              aria-label="Kohdennus"
              value={kohdennus ?? ''}
              onChange={(e) =>
                setKohdennus(e.target.value === '' ? undefined : Number(e.target.value))
              }
              className={VALITSIN}
            >
              <option value="">Kaikki</option>
              <option value={YLEINEN_ID}>Yleinen</option>
              {valittavat.map((k) => (
                <option key={k.id} value={k.id}>
                  {kohdennuksenPolku(k, kohdennukset ?? [])}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button asChild variant="sec" size="compact" className="mb-[3px]">
          <Link to="/budjetti" search={{ tilikausi: kausi.alkaa, kohdennus }}>
            Muokkaa budjettia
          </Link>
        </Button>
      </div>
      <h1 className="mb-4 hidden text-[15px] font-semibold print:block">
        {[
          init?.asetukset.Nimi,
          `Budjettivertailu ${muotoilePvm(kausi.alkaa)} – ${muotoilePvm(pvm)}`,
          valitunNimi,
        ]
          .filter(Boolean)
          .join(' – ')}
      </h1>
      {pvm !== kausi.loppuu && (
        <p className="mb-4 text-[12.5px] text-[var(--text-muted)]">
          {`Budjetti on koko tilikaudelta ${muotoilePvm(kausi.alkaa)} – ${muotoilePvm(kausi.loppuu)}, toteutunut ${muotoilePvm(pvm)} asti.`}
        </p>
      )}
      {rivit ? <VertailuTaulu rivit={rivit} /> : <Lataustila virhe={isError} />}
    </>
  );
}

function VertailuTaulu({ rivit }: { rivit: readonly BudjettivertailuRivi[] }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label="Budjettivertailu" className="border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th scope="col" className="min-w-[220px] py-[5px] pr-4 text-left font-semibold">
              <span className="sr-only">Rivi</span>
            </th>
            <th scope="col" className={SARAKE}>
              Budjetti
            </th>
            <th scope="col" className={SARAKE}>
              Toteutunut
            </th>
            <th scope="col" className={SARAKE}>
              Ero €
            </th>
            <th scope="col" className={SARAKE}>
              Toteutunut %
            </th>
          </tr>
        </thead>
        <tbody>
          {rivit.map((r, i) => {
            // Uudelleenlaskettu, read-only rivilista: vakaa indeksi käy avaimeksi.
            if (r.tyhja) {
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: vakaa järjestys, read-only näyttö
                <tr key={i} aria-hidden>
                  <td className="h-3" colSpan={5} />
                </tr>
              );
            }
            const lihava = r.lihava ? 'font-semibold' : '';
            const solu = `whitespace-nowrap px-3 py-[5px] text-right tabular-nums ${lihava}`;
            const huonompi = r.ero !== null && r.ero < 0;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: vakaa järjestys, read-only näyttö
              <tr key={i} className="border-b border-[var(--border-faint)]">
                <td
                  className={`py-[5px] pr-4 ${lihava}`}
                  style={{ paddingLeft: `${r.sisennys * 16}px` }}
                >
                  {r.teksti}
                </td>
                <td className={solu}>{euro(r.budjetti)}</td>
                <td className={solu}>{euro(r.toteutunut)}</td>
                {/* Negatiivinen ero = budjettia huonompi sekä tuloilla että menoilla. */}
                <td className={`${solu} ${huonompi ? 'text-[var(--danger)]' : ''}`}>
                  {euro(r.ero)}
                </td>
                <td className={solu}>
                  {r.prosentti === undefined ? '' : muotoileProsentti(r.prosentti)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
