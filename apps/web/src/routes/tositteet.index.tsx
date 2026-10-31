import { useKumppanit, useMenot, useTositteet, useTulot } from '@/app/kysely';
import { LajiteltavaOtsikko } from '@/components/LajiteltavaOtsikko';
import { TositeSumma } from '@/components/TositeSumma';
import { TositeTyyppiIkoni } from '@/components/TositeTyyppiIkoni';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { tositeTyyppiLabel, tositteenSumma } from '@/lib/tosite';
import { ONKO_LASKU, RahavirtaTaulu } from '@/rahavirta/RahavirtaTaulu';
import {
  OLETUSLAJITTELU as RAHAVIRTA_OLETUSLAJITTELU,
  type RahavirtaLajittelu,
  lajitteleRivit,
  onRahavirtaLajittelukentta,
} from '@/rahavirta/lajittelu';
import { Aikavalitsin, Segmentit, useAikavali } from '@/tositteet/Aikavalitsin';
import {
  KENTAN_NIMI_OMISTUSMUODOSSA,
  type Lajittelu,
  type Lajittelukentta,
  OLETUSLAJITTELU,
  lajittele,
  onLajittelukentta,
  onLajittelusuunta,
  seuraavaLajittelu,
} from '@/tositteet/lajittelu';
import { LISTALTA, tallennaListanJarjestys } from '@/tositteet/listanJarjestys';
import { AlkuperaLippu, LiiteMerkki } from '@/tositteet/merkit';
import {
  LAJIT,
  type ListaBucket,
  type Maksutila,
  type TositeLaji,
  type TositeSuodattimet,
  lueTositeSuodattimet,
  tallennaTositeSuodattimet,
} from '@/tositteet/suodattimet';
import {
  type Kumppani,
  type ListattuTosite,
  type RahavirtaRivi,
  type RahavirtaSuodatin,
  tositteenKumppani,
} from '@penni/engine';
import { type Cents, Euro, muotoileEuro, muotoilePvm } from '@penni/euro';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useEffect, useMemo, useState } from 'react';

/**
 * Osoitteen hakuparametrit: laji (Kaikki/Tulot/Menot) ja lajittelu. Osoite voittaa muistetut
 * valinnat (ks. tositteet/suodattimet.ts) — /tulot ja /menot ohjaavat tänne lajin kanssa.
 * Lajittelukenttä tulkitaan näkymässä lajin mukaan: Tulot/Menot-taulukolla on omat sarakkeensa.
 * Kumppanirajaus (kumppanilistalta) elää vain osoitteessa eikä tallennu muistiin.
 */
interface TositeHaku {
  laji?: TositeLaji | undefined;
  jarj?: string | undefined;
  suunta?: Lajittelu['suunta'] | undefined;
  kumppani?: number | undefined;
}

const onLaji = (x: unknown): x is TositeLaji =>
  typeof x === 'string' && (LAJIT as readonly string[]).includes(x);

/** Kumppanin id osoitteesta: positiivinen kokonaisluku (numerona tai merkkijonona). */
function kumppaniId(x: unknown): number | undefined {
  const n = typeof x === 'string' && /^\d+$/.test(x) ? Number(x) : x;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;
}

export const Route = createFileRoute('/tositteet/')({
  // Tuntematon tai vioittunut arvo putoaa oletukseen eikä kaada sivua. Puuttuvat avaimet on
  // nollattava eksplisiittisesti: yläreitti päästää raa'an haun läpi ja yhdistyy tähän
  // tulokseen, joten pelkkä {} jättäisi roskaparametrit voimaan.
  validateSearch: (haku: Record<string, unknown>): TositeHaku => {
    const lajittelu =
      (onLajittelukentta(haku.jarj) || onRahavirtaLajittelukentta(haku.jarj)) &&
      onLajittelusuunta(haku.suunta);
    return {
      laji: onLaji(haku.laji) ? haku.laji : undefined,
      jarj: lajittelu ? (haku.jarj as string) : undefined,
      suunta: lajittelu ? (haku.suunta as Lajittelu['suunta']) : undefined,
      kumppani: kumppaniId(haku.kumppani),
    };
  },
  component: Selaus,
});

const BUCKETIT: { arvo: ListaBucket; label: string }[] = [
  { arvo: 'kirjanpidossa', label: 'Kirjanpidossa' },
  { arvo: 'luonnos', label: 'Luonnokset' },
  { arvo: 'poistetut', label: 'Poistetut' },
];

const LAJI_VALINNAT: { arvo: TositeLaji; label: string }[] = [
  { arvo: 'kaikki', label: 'Kaikki' },
  { arvo: 'tulot', label: 'Tulot' },
  { arvo: 'menot', label: 'Menot' },
];

const MAKSUTILAT: { arvo: Maksutila; label: string }[] = [
  { arvo: 'kaikki', label: 'Kaikki' },
  { arvo: 'avoimet', label: 'Avoimet' },
  { arvo: 'eraantyneet', label: 'Erääntyneet' },
];

/** Tulot/Menot-rajauksen tyhjä tila: oma kehotus ja luontilinkki kuten entisillä listoilla. */
const TYHJA_RAHAVIRTA = {
  tulot: { teksti: 'Ei tuloja. Luo ensimmäinen lasku.', linkki: 'Luo lasku' },
  menot: { teksti: 'Ei menoja. Luo ensimmäinen ostolasku.', linkki: 'Luo ostolasku' },
} as const;

const sarakkeet: ColumnDef<ListattuTosite>[] = [
  { id: 'pvm', header: 'Pvm', accessorFn: (t) => muotoilePvm(t.pvm) },
  {
    id: 'tyyppi',
    header: 'Tyyppi',
    accessorFn: (t) => tositeTyyppiLabel(t.tyyppi),
    cell: ({ row, getValue }) => (
      <span className="inline-flex items-center gap-2">
        <TositeTyyppiIkoni tyyppi={row.original.tyyppi} className="h-5 w-5" />
        {getValue<string>()}
      </span>
    ),
  },
  {
    id: 'nro',
    header: 'Nro',
    accessorFn: (t) => (t.tunniste > 0 ? `${t.sarja} ${t.tunniste}`.trim() : 'Luonnos'),
  },
  { id: 'selite', header: 'Selite', accessorFn: (t) => t.otsikko ?? '—' },
  {
    id: 'summa',
    header: 'Summa',
    accessorFn: (t) => muotoileEuro(tositteenSumma(t)),
    cell: ({ row }) => <TositeSumma tosite={row.original} />,
    meta: { oikealle: true },
  },
  {
    id: 'merkit',
    header: () => <span className="sr-only">Kuitti ja alkuperä</span>,
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-2">
        <LiiteMerkki liitteita={row.original.liitteita} />
        <AlkuperaLippu alkupera={row.original.alkupera} />
      </span>
    ),
  },
];

/** Hakusana rahamääräksi (sentit), jos se on summa ("86,40", "1 234,5", "250 €"); muuten undefined. */
function hakuSumma(haku: string): Cents | undefined {
  const t = haku.replace(/€/g, '').trim();
  if (!/^-?[\d\s]+([.,]\d{1,2})?$/.test(t)) return undefined;
  try {
    return Euro.abs(Euro.fromString(t));
  } catch {
    return undefined;
  }
}

/** Täsmääkö tosite hakuun: otsikko sisältää tekstin, numero täsmää, tai summa tai jokin vienti täsmää. */
function tasmaaHakuun(t: ListattuTosite, haku: string): boolean {
  const q = haku.trim().toLowerCase();
  if (q === '') return true;
  const summa = hakuSumma(q);
  if (
    summa !== undefined &&
    (tositteenSumma(t) === summa || t.viennit.some((v) => v.debet === summa || v.kredit === summa))
  )
    return true;
  const nro = t.tunniste > 0 ? `${t.sarja} ${t.tunniste}`.trim() : '';
  return (t.otsikko ?? '').toLowerCase().includes(q) || nro.toLowerCase() === q;
}

/** Sama haku tulo-/menoriville: otsikko, laskun numero/viite, kumppani tai summa. */
function riviTasmaaHakuun(r: RahavirtaRivi, haku: string): boolean {
  const q = haku.trim().toLowerCase();
  if (q === '') return true;
  const summa = hakuSumma(q);
  if (summa !== undefined && [r.summa, r.netto, r.avoin].some((x) => Euro.abs(x) === summa))
    return true;
  return [r.otsikko, r.numero, r.viite, r.kumppaniNimi].some((x) =>
    (x ?? '').toLowerCase().includes(q),
  );
}

/**
 * Kumppanirajaus tehdään täällä eikä hakuna: kumppanittomat (Pennissä luodut) tositteet
 * tunnistetaan otsikosta (tositteenKumppani), mitä varaston kumppani-suodatin ei näe.
 */
const EI_KUMPPANEITA: Kumppani[] = [];
function kumppanilleRajaus(kumppani: number | undefined, kumppanit: readonly Kumppani[]) {
  return (t: { kumppani?: number | undefined; otsikko?: string | undefined }) =>
    kumppani === undefined || tositteenKumppani(t, kumppanit) === kumppani;
}

// Vakaa viite myös haun aikana: uusi [] käynnistäisi taulukon automaattisen
// sivunollauksen jokaisella renderöinnillä ja voisi jäädyttää renderöijän.
const EI_TOSITTEITA: ListattuTosite[] = [];
const EI_RIVEJA: RahavirtaRivi[] = [];

function Selaus() {
  const navigate = useNavigate();
  const haku = Route.useSearch();
  // Muistetut valinnat (katsojakohtaisesti, ks. tositteet/suodattimet.ts); osoite voittaa.
  const [muisti, setMuisti] = useState<TositeSuodattimet>(lueTositeSuodattimet);
  const [hakusana, setHakusana] = useState('');
  const kumppani = haku.kumppani;
  const { data: kumppanit } = useKumppanit();
  const kumppaninNimi = kumppanit?.find((k) => k.id === kumppani)?.nimi;

  const laji: TositeLaji = haku.laji ?? muisti.laji;
  const rahavirta = laji === 'kaikki' ? null : laji;
  const [jarj, suunta] =
    haku.jarj !== undefined && haku.suunta !== undefined
      ? [haku.jarj, haku.suunta]
      : [muisti.jarj, muisti.suunta];
  const lajittelu = useMemo<Lajittelu>(
    () => (onLajittelukentta(jarj) && suunta ? { kentta: jarj, suunta } : OLETUSLAJITTELU),
    [jarj, suunta],
  );
  const rahavirtaLajittelu = useMemo<RahavirtaLajittelu>(
    () =>
      onRahavirtaLajittelukentta(jarj) && suunta
        ? { kentta: jarj, suunta }
        : RAHAVIRTA_OLETUSLAJITTELU,
    [jarj, suunta],
  );

  const { vali, haku: hakuvali, valmis } = useAikavali(muisti.valinta, muisti.oma);

  /** Päivitä valinnat ja muista ne; osoitteesta tullut laji/lajittelu tallentuu samalla. */
  function paivita(muutos: Partial<TositeSuodattimet>): TositeSuodattimet {
    const uusi: TositeSuodattimet = {
      ...muisti,
      laji,
      ...(jarj !== undefined && suunta !== undefined ? { jarj, suunta } : {}),
      ...muutos,
    };
    setMuisti(uusi);
    tallennaTositeSuodattimet(uusi);
    return uusi;
  }

  /** Osoite seuraa lajia ja lajittelua; oletukset jätetään pois, replace ei kasvata historiaa.
   *  Kumppanirajaus kulkee mukana, kunnes se poistetaan. */
  function paivitaOsoite(uusiLaji: TositeLaji, l: { kentta: string; suunta: string } | null) {
    void navigate({
      to: '/tositteet',
      search: {
        ...(uusiLaji !== 'kaikki' ? { laji: uusiLaji } : {}),
        ...(l ? { jarj: l.kentta, suunta: l.suunta as Lajittelu['suunta'] } : {}),
        ...(kumppani !== undefined ? { kumppani } : {}),
      },
      replace: true,
    });
  }

  function poistaKumppanirajaus(): void {
    void navigate({
      to: '/tositteet',
      search: ({ kumppani: _pois, ...muut }) => muut,
      replace: true,
    });
  }

  function valitseLaji(uusi: TositeLaji): void {
    const s = paivita({ laji: uusi });
    // Lajittelu ei välttämättä päde uuden lajin sarakkeisiin; muistista se tulkitaan uudelleen.
    paivitaOsoite(uusi, s.jarj && s.suunta ? { kentta: s.jarj, suunta: s.suunta } : null);
  }

  function vaihdaLajittelu(seuraava: { kentta: string; suunta: Lajittelu['suunta'] }): void {
    paivita({ jarj: seuraava.kentta, suunta: seuraava.suunta });
    const oletus = seuraava.kentta === 'pvm' && seuraava.suunta === 'laskeva';
    paivitaOsoite(laji, oletus ? null : seuraava);
  }

  const rajaus = {
    bucket: muisti.bucket,
    ...(hakuvali.alkupvm ? { alkupvm: hakuvali.alkupvm } : {}),
    ...(hakuvali.loppupvm ? { loppupvm: hakuvali.loppupvm } : {}),
  };
  // "Tänään" erääntymiselle luetaan renderöintihetkellä (UI-suodatin, ei rahaa).
  const tanaan = new Date().toISOString().slice(0, 10);
  const rahavirtaSuodatin: RahavirtaSuodatin = {
    ...rajaus,
    ...(muisti.maksutila === 'avoimet' ? { avoin: true } : {}),
    ...(muisti.maksutila === 'eraantyneet' ? { eraantynyt: tanaan } : {}),
  };
  const tositeKysely = useTositteet(rajaus, valmis && rahavirta === null);
  const tuloKysely = useTulot(rahavirtaSuodatin, valmis && rahavirta === 'tulot');
  const menoKysely = useMenot(rahavirtaSuodatin, valmis && rahavirta === 'menot');
  const kysely =
    rahavirta === 'tulot' ? tuloKysely : rahavirta === 'menot' ? menoKysely : tositeKysely;

  // Hakusuodatus ja lajittelu (oletuksena uusin ensin); ilman dataa vakaa tyhjä (ks. yllä).
  const tositteet = tositeKysely.data;
  const kaikkiKumppanit = kumppanit ?? EI_KUMPPANEITA;
  const naytettavat = useMemo(() => {
    if (!tositteet) return EI_TOSITTEITA;
    const kuuluu = kumppanilleRajaus(kumppani, kaikkiKumppanit);
    return lajittele(
      tositteet.filter((t) => kuuluu(t) && tasmaaHakuun(t, hakusana)),
      lajittelu,
    );
  }, [tositteet, hakusana, lajittelu, kumppani, kaikkiKumppanit]);
  const rahavirtaData = rahavirta === 'tulot' ? tuloKysely.data : menoKysely.data;
  // Tulot/Menot-rivit lajitellaan tässä kerran: sama järjestys näytetään (RahavirtaTaulu) ja
  // tallennetaan selausta varten.
  const rivit = useMemo(() => {
    if (!rahavirtaData || !rahavirta) return EI_RIVEJA;
    const kuuluu = kumppanilleRajaus(kumppani, kaikkiKumppanit);
    return lajitteleRivit(
      rahavirtaData.filter((r) => kuuluu(r) && riviTasmaaHakuun(r, hakusana)),
      rahavirtaLajittelu,
      ONKO_LASKU[rahavirta],
    );
  }, [rahavirtaData, hakusana, rahavirta, rahavirtaLajittelu, kumppani, kaikkiKumppanit]);

  const table = useReactTable({
    data: naytettavat,
    columns: sarakkeet,
    getCoreRowModel: getCoreRowModel(),
  });

  const lataa = !valmis || (kysely.isFetching && !kysely.data);
  const tyhja = rahavirta ? rivit.length === 0 : table.getRowModel().rows.length === 0;

  // Näytettyjen rivien tositteet täsmälleen näytetyssä järjestyksessä (suodattimet, haku ja
  // lajittelu huomioiden) tositesivun Edellinen/Seuraava-selausta varten.
  const naytetytIdt = useMemo(() => {
    if (lataa || kysely.isError || !kysely.data) return null;
    return rahavirta ? rivit.map((r) => r.tosite) : naytettavat.map((t) => t.id);
  }, [lataa, kysely.isError, kysely.data, rahavirta, rivit, naytettavat]);
  useEffect(() => {
    if (naytetytIdt) tallennaListanJarjestys(muisti.bucket, naytetytIdt);
  }, [naytetytIdt, muisti.bucket]);

  return (
    <>
      <TopBar
        otsikko="Tositteet"
        toiminnot={
          <>
            <Button variant="sec" size="compact" asChild>
              <Link to="/myyntilaskut/uusi">+ Myyntilasku</Link>
            </Button>
            <Button variant="sec" size="compact" asChild>
              <Link to="/ostolaskut/uusi">+ Ostolasku</Link>
            </Button>
            <Button size="compact" asChild>
              <Link to="/tositteet/uusi">+ Uusi tosite</Link>
            </Button>
          </>
        }
      />
      <section aria-label="tositteselaus" className="flex-1 overflow-auto px-[22px] py-5">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Segmentit
              otsikko="Tositteiden tila"
              vaihtoehdot={BUCKETIT}
              valittu={muisti.bucket}
              onValitse={(bucket) => paivita({ bucket })}
            />
            <Segmentit
              otsikko="Laji"
              vaihtoehdot={LAJI_VALINNAT}
              valittu={laji}
              onValitse={valitseLaji}
            />
            {rahavirta && (
              <Segmentit
                otsikko="Maksutila"
                vaihtoehdot={MAKSUTILAT}
                valittu={muisti.maksutila}
                onValitse={(maksutila) => paivita({ maksutila })}
              />
            )}
            {kumppani !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-[6px] bg-[var(--accent-soft)] py-1 pr-1 pl-[10px] text-[12.5px] font-medium text-[var(--accent)]">
                <span>Kumppani: {kumppaninNimi ?? '…'}</span>
                <button
                  type="button"
                  aria-label="Poista kumppanirajaus"
                  onClick={poistaKumppanirajaus}
                  className="rounded-[4px] px-[5px] leading-none hover:bg-[var(--surface)]"
                >
                  ×
                </button>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Aikavalitsin
              valinta={muisti.valinta}
              vali={vali}
              onValinta={(valinta) => paivita({ valinta })}
              onPaiva={(kentta, arvo) =>
                paivita({ valinta: null, oma: { ...vali, [kentta]: arvo } })
              }
            />
            <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
              Haku
              <input
                type="search"
                aria-label="Hae tositteita"
                value={hakusana}
                onChange={(e) => setHakusana(e.target.value)}
                placeholder="Otsikko, numero tai summa"
                className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] normal-case tracking-normal"
              />
            </label>
          </div>
        </div>

        {kysely.isError ? (
          <p role="alert">Tositteiden lataaminen epäonnistui. Kokeile uudelleen.</p>
        ) : lataa ? (
          <output className="block">Ladataan tositteita…</output>
        ) : tyhja ? (
          rahavirta && hakusana.trim() === '' && kumppani === undefined ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-[13.5px] text-[var(--text-muted)]">
                {TYHJA_RAHAVIRTA[rahavirta].teksti}
              </p>
              <Button variant="sec" asChild>
                <Link to={rahavirta === 'tulot' ? '/myyntilaskut/uusi' : '/ostolaskut/uusi'}>
                  {TYHJA_RAHAVIRTA[rahavirta].linkki}
                </Link>
              </Button>
            </div>
          ) : (
            <p className="text-[13.5px] text-[var(--text-muted)]">
              Ei tositteita valituilla ehdoilla.
            </p>
          )
        ) : rahavirta ? (
          <RahavirtaTaulu
            laji={rahavirta}
            rivit={rivit}
            lajittelu={rahavirtaLajittelu}
            onLajittelu={vaihdaLajittelu}
          />
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const kentta = h.column.id;
                    if (!onLajittelukentta(kentta)) {
                      return (
                        <th key={h.id} className="px-[10px] pb-[7px]">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      );
                    }
                    return (
                      <LajiteltavaOtsikko
                        key={h.id}
                        aktiivinen={lajittelu.kentta === kentta}
                        nouseva={lajittelu.suunta === 'nouseva'}
                        saavutettavaNimi={`Lajittele ${KENTAN_NIMI_OMISTUSMUODOSSA[kentta]} mukaan`}
                        oikealle={h.column.columnDef.meta?.oikealle}
                        onLajittele={() => vaihdaLajittelu(seuraavaLajittelu(lajittelu, kentta))}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </LajiteltavaOtsikko>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const avaa = () =>
                  navigate({
                    to: '/tositteet/$id',
                    params: { id: String(row.original.id) },
                    state: LISTALTA,
                  });
                return (
                  <tr
                    key={row.id}
                    onClick={avaa}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        avaa();
                      }
                    }}
                    tabIndex={0}
                    className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--bg-subtle)]"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={`px-[10px] py-[9px] tabular-nums ${
                          cell.column.columnDef.meta?.oikealle ? 'text-right' : ''
                        }`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
