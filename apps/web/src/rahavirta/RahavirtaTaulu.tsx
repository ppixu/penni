import { useInit } from '@/app/kysely';
import { LajiteltavaOtsikko } from '@/components/LajiteltavaOtsikko';
import { Button } from '@/components/ui/button';
import { MuistutusDialog } from '@/laskutus/MuistutusDialog';
import { SuoritusDialog } from '@/laskutus/SuoritusDialog';
import { laskuTila } from '@/laskutus/laskuTila';
import { LISTALTA } from '@/tositteet/listanJarjestys';
import { AlkuperaLippu, LiiteMerkki } from '@/tositteet/merkit';
import {
  type RahavirtaRivi,
  TositeTila,
  TositeTyyppi,
  lataaKartta,
  tiliAsetuksesta,
} from '@penni/engine';
import { muotoileEuro, muotoilePvm } from '@penni/euro';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import {
  RAHAVIRTA_KENTAN_NIMI,
  type RahavirtaLajittelu,
  type RahavirtaLajittelukentta,
  onRahavirtaLajittelukentta,
  seuraavaRahavirtaLajittelu,
} from './lajittelu.js';

export type RahavirtaLaji = 'tulot' | 'menot';

/**
 * Onko rivi lasku (Laji-sarake 'Lasku' vs 'Suora' sekä rivin klikkauksen kohde). Vakaat
 * viitteet: lajittelu lasketaan uudelleen vain, kun predikaatti vaihtuu.
 *
 * Tulot: MYYNTILASKU (210), MAKSUMUISTUTUS (216) ja HYVITYSLASKU (214), jolla on alkuperäinen lasku — hyvityslaskun
 * dokumenttinäkymä ('/myyntilaskut/$id') tulostaa alkuperäisen rivit, joten alkuperäisettömän
 * (esim. Kitsas-tuonnin) hyvityslaskun dokumentti olisi tyhjä; se avautuu tositteena.
 *
 * Menot: ostolasku jakaa tositetyypin (MENO/100) suoran menon kanssa, ja era !== undefined YKSIN
 * ei riitä: laskun hyvitys säilyttää eran mutta kääntää ostovelkarivin kredit-puolen debetiksi,
 * jolloin '/ostolaskut/$id' ei löytäisi mitään näytettävää. eraKredit on true vain kun era-rivi
 * on yhä ostovelan puolella — sama ehto kuin listaaOstolaskutilla (ostolaskuResource.ts:159-162).
 */
export const ONKO_LASKU: Record<RahavirtaLaji, (r: RahavirtaRivi) => boolean> = {
  tulot: (r) =>
    r.tyyppi === TositeTyyppi.MYYNTILASKU ||
    r.tyyppi === TositeTyyppi.MAKSUMUISTUTUS ||
    (r.tyyppi === TositeTyyppi.HYVITYSLASKU && r.alkuperainenTosite !== undefined),
  menot: (r) => r.era !== undefined && r.eraKredit === true,
};

/** Laskurivin dokumenttinäkymä. Suljettu literaaliunioni, jotta navigate({ to }) tyypittyy. */
const LASKUPOLKU: Record<RahavirtaLaji, '/myyntilaskut/$id' | '/ostolaskut/$id'> = {
  tulot: '/myyntilaskut/$id',
  menot: '/ostolaskut/$id',
};

/**
 * Voiko rivin laskusta tehdä muistutuksen (spec §4.1, UI-ennakkotarkistus): kirjattu myyntilasku,
 * jolla on avointa saldoa ja jonka eräpäivä on ohi. Muistutusrivillä (216) avoin on aina 0 ja
 * "Muistuta" kuuluu alkuperäisen laskun riville; moottori tekee lopullisen tarkistuksen.
 */
export const voiMuistuttaa = (r: RahavirtaRivi, tanaan: string): boolean =>
  r.tyyppi === TositeTyyppi.MYYNTILASKU &&
  r.tila >= TositeTila.KIRJANPIDOSSA &&
  !r.muistutus &&
  r.avoin > 0 &&
  r.erapvm !== undefined &&
  r.erapvm < tanaan;

const onLuonnos = (r: RahavirtaRivi): boolean =>
  r.tila >= TositeTila.LUONNOS && r.tila < TositeTila.KIRJANPIDOSSA;

/**
 * Tulojen/menojen taulukko tositelistassa (Tulot/Menot-rajaus): netto/alv/summa-erittely,
 * Laji (Suora/Lasku), eräpäivä, avoin saldo tilavärein sekä Kirjaa maksu -toiminto
 * (SuoritusDialog) avoimille laskuille. Lasku-rivi avaa laskun dokumenttinäkymän, muut rivit
 * (myös luonnokset — niillä ei ole kirjattua laskua) tositteen.
 */
export function RahavirtaTaulu({
  laji,
  rivit,
  lajittelu,
  onLajittelu,
}: {
  laji: RahavirtaLaji;
  /**
   * Rivit valmiiksi lajiteltuina (`lajitteleRivit` lajittelulla `lajittelu`): sivu lajittelee
   * kerran ja tallentaa saman järjestyksen Edellinen/Seuraava-selausta varten.
   */
  rivit: RahavirtaRivi[];
  lajittelu: RahavirtaLajittelu;
  onLajittelu: (seuraava: RahavirtaLajittelu) => void;
}) {
  const navigate = useNavigate();
  const { data: init } = useInit();
  const [maksuRivi, setMaksuRivi] = useState<RahavirtaRivi | null>(null);
  // Muistutettavat laskut (valintaruudut tai rivin Muistuta-nappi) ja luonnosten luonnin ilmoitus.
  const [valitut, setValitut] = useState<ReadonlySet<number>>(new Set());
  const [muistutettavat, setMuistutettavat] = useState<RahavirtaRivi[] | null>(null);
  const [ilmoitus, setIlmoitus] = useState<number | null>(null);
  const onkoLasku = ONKO_LASKU[laji];

  // "Tänään" luetaan renderöintihetkellä (UI-tilaväritys, ei rahaa).
  const tanaan = new Date().toISOString().slice(0, 10);

  const kartta = useMemo(() => (init ? lataaKartta(init.tilit) : []), [init]);
  const oletusRahatili = init ? tiliAsetuksesta(init.asetukset, 'LaskuMaksutili') : undefined;

  // Valinta rajataan rivien nykyiseen joukkoon: suodatin tai päivitys voi poistaa valitun rivin.
  const valitutRivit = rivit.filter((r) => valitut.has(r.tosite) && voiMuistuttaa(r, tanaan));
  function vaihdaValinta(tosite: number, paalla: boolean) {
    setValitut((vanha) => {
      const uusi = new Set(vanha);
      if (paalla) uusi.add(tosite);
      else uusi.delete(tosite);
      return uusi;
    });
  }

  const sarakkeet: ColumnDef<RahavirtaRivi>[] = [
    ...(laji === 'tulot'
      ? [
          {
            id: 'valinta',
            header: () => <span className="sr-only">Valitse muistutettavaksi</span>,
            cell: ({ row }) => {
              const r = row.original;
              if (!voiMuistuttaa(r, tanaan)) return null;
              return (
                <input
                  type="checkbox"
                  aria-label={`Valitse lasku ${r.numero ?? r.tosite} muistutettavaksi`}
                  checked={valitut.has(r.tosite)}
                  onChange={(e) => vaihdaValinta(r.tosite, e.target.checked)}
                  onClick={(e) => e.stopPropagation()} // ei rivinavigointia
                  onKeyDown={(e) => e.stopPropagation()}
                />
              );
            },
          } satisfies ColumnDef<RahavirtaRivi>,
        ]
      : []),
    { id: 'pvm', header: 'Pvm', accessorFn: (r) => muotoilePvm(r.pvm) },
    {
      id: 'otsikko',
      header: 'Selite',
      // Nro (myyntilasku) tai Viite (ostolasku) taitetaan Selite-soluun — numero ensin: se on
      // myyntilaskun ihmisluettava tunniste, viite on vain maksuviite.
      accessorFn: (r) => {
        const tunniste = r.numero ?? r.viite;
        if (tunniste && r.otsikko) return `${tunniste} · ${r.otsikko}`;
        return tunniste ?? r.otsikko ?? '—';
      },
    },
    { id: 'kumppani', header: 'Kumppani', accessorFn: (r) => r.kumppaniNimi ?? '—' },
    {
      id: 'laji',
      header: 'Laji',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5">
          {row.original.muistutus ? 'Muistutus' : onkoLasku(row.original) ? 'Lasku' : 'Suora'}
          {row.original.muistutettu !== undefined && (
            <span className="rounded-[4px] bg-[var(--track)] px-1.5 py-[1px] text-[10.5px] font-semibold text-[var(--text-muted)]">
              Muistutettu ×{row.original.muistutettu}
            </span>
          )}
          {onLuonnos(row.original) && (
            <span className="rounded-[4px] bg-[var(--track)] px-1.5 py-[1px] text-[10.5px] font-semibold text-[var(--text-muted)]">
              Luonnos
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'netto',
      header: 'Netto',
      accessorFn: (r) => muotoileEuro(r.netto),
      meta: { oikealle: true },
    },
    {
      id: 'alv',
      header: 'ALV',
      accessorFn: (r) => muotoileEuro(r.alv),
      meta: { oikealle: true },
    },
    {
      id: 'summa',
      header: 'Summa',
      accessorFn: (r) => muotoileEuro(r.summa),
      meta: { oikealle: true },
    },
    {
      id: 'erapvm',
      header: 'Eräpvm',
      accessorFn: (r) => (r.erapvm ? muotoilePvm(r.erapvm) : '—'),
      meta: { oikealle: true },
    },
    {
      id: 'avoin',
      header: 'Avoin',
      meta: { oikealle: true },
      cell: ({ row }) => {
        const r = row.original;
        // Muistutusrivillä ei ole omaa tilaa: yhteinen erä kuuluu alkuperäisen laskun riville.
        if (r.muistutus) return <span className="text-[var(--text-subtle)]">—</span>;
        const tila = laskuTila(r, tanaan);
        const luokka =
          tila === 'maksettu'
            ? 'text-[var(--text-subtle)]'
            : tila === 'eraantynyt'
              ? 'text-[var(--danger)]'
              : '';
        // Tilan nimi tooltipiksi; erällinen rivi, jonka avoin poikkeaa summasta, on osittain maksettu.
        const nimi =
          r.era === undefined
            ? undefined
            : tila === 'maksettu'
              ? 'Maksettu'
              : r.avoin !== r.summa
                ? tila === 'eraantynyt'
                  ? 'Osittain maksettu, erääntynyt'
                  : 'Osittain maksettu'
                : tila === 'eraantynyt'
                  ? 'Erääntynyt'
                  : 'Avoin';
        return (
          <span className={luokka} data-tila={tila} title={nimi}>
            {muotoileEuro(r.avoin)}
          </span>
        );
      },
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
    {
      id: 'maksu',
      header: '',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5">
          {voiMuistuttaa(row.original, tanaan) && (
            <Button
              variant="sec"
              size="compact"
              type="button"
              aria-label={`Muistuta laskusta ${row.original.numero ?? row.original.tosite}`}
              onClick={(e) => {
                e.stopPropagation(); // ei rivinavigointia
                setMuistutettavat([row.original]);
              }}
            >
              Muistuta
            </Button>
          )}
          {row.original.avoin !== 0 && (
            <Button
              variant="sec"
              size="compact"
              type="button"
              onClick={(e) => {
                e.stopPropagation(); // ei rivinavigointia
                setMaksuRivi(row.original);
              }}
            >
              Kirjaa maksu
            </Button>
          )}
        </span>
      ),
    },
  ];

  const table = useReactTable({
    data: rivit,
    columns: sarakkeet,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <>
      {ilmoitus !== null && (
        <output className="mb-3 flex items-center gap-3 rounded-[6px] bg-[var(--accent-soft)] px-3 py-2 text-[12.5px]">
          <span>
            {ilmoitus === 1 ? '1 muistutus odottaa' : `${ilmoitus} muistutusta odottaa`} Lähtevissä.
          </span>
          <Link
            to="/tositteet"
            search={{ laji: 'tulot', valilehti: 'lahtevat' }}
            className="font-medium text-[var(--accent)] underline"
          >
            Avaa Lähtevät
          </Link>
        </output>
      )}
      {valitutRivit.length > 0 && (
        <div className="mb-3 flex items-center gap-3">
          <Button type="button" size="compact" onClick={() => setMuistutettavat(valitutRivit)}>
            Muistuta ({valitutRivit.length})
          </Button>
          <span className="text-[12.5px] text-[var(--text-muted)]">
            {valitutRivit.length} erääntynyttä laskua valittu
          </span>
        </div>
      )}
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const kentta = h.column.id;
                if (!onRahavirtaLajittelukentta(kentta)) {
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
                    saavutettavaNimi={`Lajittele ${RAHAVIRTA_KENTAN_NIMI[kentta as RahavirtaLajittelukentta]} mukaan`}
                    oikealle={h.column.columnDef.meta?.oikealle}
                    onLajittele={() => onLajittelu(seuraavaRahavirtaLajittelu(lajittelu, kentta))}
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
            const r = row.original;
            // Tositteeksi avattu rivi selataan listan järjestyksessä (ks. listanJarjestys.ts).
            const avaa = () =>
              onkoLasku(r) && !onLuonnos(r)
                ? navigate({ to: LASKUPOLKU[laji], params: { id: String(r.tosite) } })
                : navigate({
                    to: '/tositteet/$id',
                    params: { id: String(r.tosite) },
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

      {muistutettavat && (
        <MuistutusDialog
          laskut={muistutettavat}
          onPeruuta={() => setMuistutettavat(null)}
          onValmis={(luodut) => {
            setMuistutettavat(null);
            setValitut(new Set());
            setIlmoitus(luodut.length);
          }}
        />
      )}
      {maksuRivi && (
        <SuoritusDialog
          lasku={maksuRivi}
          tilit={kartta}
          oletusRahatili={oletusRahatili}
          onPeruuta={() => setMaksuRivi(null)}
          onSuljeJaPaivita={() => setMaksuRivi(null)}
        />
      )}
    </>
  );
}
