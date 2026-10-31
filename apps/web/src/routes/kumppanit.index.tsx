import { useInit, useKumppanit, useTallennaKumppani, useTositteet } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import {
  EI_TOSITTEITA,
  type Kertyma,
  type KumppaninTilasto,
  kumppaneidenTilastot,
  liitettavatTositteet,
} from '@/kumppanit/kumppaninTositteet';
import { type LiitosTulos, useLiitaKumppanit } from '@/kumppanit/useLiitaKumppanit';
import { useValittuTilikausi } from '@/tilikausi/valittuTilikausi';
import type { Kumppani, Tilikausi, UusiKumppani } from '@penni/engine';
import { muotoileEuro } from '@penni/euro';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo, useRef, useState } from 'react';

export const Route = createFileRoute('/kumppanit/')({ component: Kumppanilista });

/** Listalla suoraan muokattavat kentät; muut (osoite, IBANit, ...) muokataan lomakkeella. */
type Kentta = 'nimi' | 'alvtunnus';

/** Kirjatut tositteet koko kirjanpidon ajalta (tilastot ja kumppanien liittäminen). */
const KAIKKI_KIRJATUT = {};
const EI_TILASTOJA = new Map<number, KumppaninTilasto>();

/** Sarakeotsikon kausi: "2026", tai kalenterivuodesta poikkeavalle kaudelle "2025–2026". */
function kaudenNimi(kausi: Pick<Tilikausi, 'alkaa' | 'loppuu'> | undefined): string {
  if (!kausi) return 'Kausi';
  const [a, b] = [kausi.alkaa.slice(0, 4), kausi.loppuu.slice(0, 4)];
  return a === b ? a : `${a}–${b}`;
}

function KertymaSolu({ k }: { k: Kertyma }) {
  return k.kpl === 0 ? (
    <span className="text-[var(--text-subtle)]">—</span>
  ) : (
    <span className="tabular-nums">{k.kpl}</span>
  );
}

function SummaSolu({ k }: { k: Kertyma }) {
  return k.kpl === 0 ? (
    <span className="text-[var(--text-subtle)]">—</span>
  ) : (
    <span className="tabular-nums">{muotoileEuro(k.summa)}</span>
  );
}

/**
 * Taulukon solu tekstikenttänä: Enter tai poistuminen tallentaa muuttuneen arvon, Esc perii
 * muutoksen. Epäonnistunut tallennus palauttaa tallennetun arvon. Solu mountataan uudelleen
 * kun tallennettu arvo muuttuu (key), joten luonnosta ei tarvitse synkronoida erikseen.
 */
function MuokattavaSolu({
  arvo,
  ariaLabel,
  onTallenna,
}: {
  arvo: string;
  ariaLabel: string;
  onTallenna: (arvo: string) => Promise<boolean>;
}) {
  const [luonnos, setLuonnos] = useState(arvo);
  const peru = useRef(false);

  function valmis() {
    const uusi = luonnos.trim();
    if (peru.current || uusi === arvo) {
      peru.current = false;
      setLuonnos(arvo);
      return;
    }
    void onTallenna(uusi).then((ok) => {
      if (!ok) setLuonnos(arvo);
    });
  }

  return (
    <input
      aria-label={ariaLabel}
      value={luonnos}
      placeholder="—"
      onChange={(e) => setLuonnos(e.target.value)}
      onBlur={valmis}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          peru.current = true;
          e.currentTarget.blur();
        }
      }}
      className="w-full rounded-[4px] border border-transparent bg-transparent px-[6px] py-[3px] placeholder:text-[var(--text-subtle)] hover:border-[var(--border)] focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:outline-none"
    />
  );
}

function Kumppanilista() {
  const navigate = useNavigate();
  const [haku, setHaku] = useState('');
  const [virhe, setVirhe] = useState<string | null>(null);
  const { data: kumppanit, isLoading } = useKumppanit();
  const { tallenna, virheviesti } = useTallennaKumppani();
  const { data: tositteet } = useTositteet(KAIKKI_KIRJATUT);
  const { data: init } = useInit();
  const { kausi } = useValittuTilikausi();
  const { liita, kaynnissa: liittaa } = useLiitaKumppanit();
  const [liitosTulos, setLiitosTulos] = useState<LiitosTulos | null>(null);

  const tilastot = useMemo(
    () =>
      tositteet && kumppanit ? kumppaneidenTilastot(tositteet, kumppanit, kausi) : EI_TILASTOJA,
    [tositteet, kumppanit, kausi],
  );
  const lukitusraja = init?.asetukset.TilitPaatetty;
  const liitettavat = useMemo(
    () => (tositteet && kumppanit ? liitettavatTositteet(tositteet, kumppanit, lukitusraja) : []),
    [tositteet, kumppanit, lukitusraja],
  );
  // Tilastosolut lukevat refistä, jotta sarakkeita ei tarvitse rakentaa uudelleen (ks. alla).
  const tilastoRef = useRef(tilastot);
  tilastoRef.current = tilastot;

  const suodatetut = useMemo(() => {
    const h = haku.trim().toLowerCase();
    if (h === '') return kumppanit ?? [];
    return (kumppanit ?? []).filter(
      (k) => k.nimi.toLowerCase().includes(h) || (k.alvtunnus ?? '').toLowerCase().includes(h),
    );
  }, [kumppanit, haku]);

  /** Tallentaa yhden kentän: tallennus korvaa koko kumppanin, joten muut kentät kulkevat mukana. */
  async function tallennaKentta(k: Kumppani, kentta: Kentta, arvo: string): Promise<boolean> {
    if (kentta === 'nimi' && arvo === '') {
      setVirhe('Anna kumppanin nimi.');
      return false;
    }
    setVirhe(null);
    const { [kentta]: _vanha, ...muut } = k;
    const syote = (arvo === '' ? muut : { ...muut, [kentta]: arvo }) as UusiKumppani;
    return (await tallenna(syote)) !== undefined;
  }

  // Sarakkeet muistetaan: flexRender käsittelee solufunktiota komponenttityyppinä, joten joka
  // renderöinnillä uusi funktio mounttaisi kentät uudelleen ja muokattava kenttä menettäisi
  // fokuksen. Tallennus kulkee siksi refin kautta tuoreeseen tallennaKentta-funktioon.
  const tallennaRef = useRef(tallennaKentta);
  tallennaRef.current = tallennaKentta;

  // Kausi saapuu initin mukana vasta latauksen jälkeen: otsikko refistä, ettei sarakkeiden
  // uudelleenrakennus mounttaa muokattavia kenttiä uudelleen.
  const kaudelleRef = useRef(kaudenNimi(kausi));
  kaudelleRef.current = kaudenNimi(kausi);
  const sarakkeet = useMemo<ColumnDef<Kumppani>[]>(() => {
    const tilasto = (
      id: string,
      otsikko: () => string,
      Solu: typeof KertymaSolu,
      osa: keyof KumppaninTilasto,
    ): ColumnDef<Kumppani> => ({
      id,
      header: () => otsikko(),
      cell: ({ row }) => (
        <Solu k={(tilastoRef.current.get(row.original.id) ?? EI_TOSITTEITA)[osa]} />
      ),
      meta: { oikealle: true },
    });
    const muokattava = (kentta: Kentta, otsikko: string): ColumnDef<Kumppani> => ({
      id: kentta,
      header: otsikko,
      cell: ({ row }) => {
        const arvo = row.original[kentta] ?? '';
        return (
          <MuokattavaSolu
            key={arvo}
            arvo={arvo}
            ariaLabel={`${otsikko}: ${row.original.nimi}`}
            onTallenna={(uusi) => tallennaRef.current(row.original, kentta, uusi)}
          />
        );
      },
    });
    return [
      muokattava('nimi', 'Nimi'),
      muokattava('alvtunnus', 'Alv-tunnus'),
      tilasto('kausiKpl', () => `Tositteet ${kaudelleRef.current}`, KertymaSolu, 'kausi'),
      tilasto('kausiSumma', () => `Summa ${kaudelleRef.current}`, SummaSolu, 'kausi'),
      tilasto('kaikkiKpl', () => 'Tositteet yht.', KertymaSolu, 'kaikki'),
      tilasto('kaikkiSumma', () => 'Summa yht.', SummaSolu, 'kaikki'),
      {
        id: 'avaa',
        header: '',
        cell: ({ row }) => (
          <span className="flex justify-end gap-4 whitespace-nowrap px-[6px]">
            <Link
              to="/tositteet"
              search={{ kumppani: row.original.id }}
              aria-label={`Tositteet: ${row.original.nimi}`}
              className="text-[12px] text-[var(--accent)] hover:underline"
            >
              Tositteet
            </Link>
            <button
              type="button"
              aria-label={`Avaa ${row.original.nimi}`}
              onClick={() =>
                navigate({ to: '/kumppanit/$id', params: { id: String(row.original.id) } })
              }
              className="text-[12px] text-[var(--accent)] hover:underline"
            >
              Avaa
            </button>
          </span>
        ),
      },
    ];
  }, [navigate]);

  const table = useReactTable({
    data: suodatetut,
    columns: sarakkeet,
    getRowId: (k) => String(k.id),
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <>
      <TopBar
        otsikko="Kumppanit"
        toiminnot={
          <Button size="compact" onClick={() => navigate({ to: '/kumppanit/uusi' })}>
            + Uusi kumppani
          </Button>
        }
      />
      <section aria-label="kumppanilista" className="flex-1 overflow-auto px-[22px] py-5">
        <div className="mb-4">
          <input
            type="search"
            aria-label="Hae kumppania"
            placeholder="Hae nimellä tai alv-tunnuksella"
            value={haku}
            onChange={(e) => setHaku(e.target.value)}
            className="w-[320px] rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]"
          />
        </div>

        {liitettavat.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border)] px-[14px] py-[10px] text-[12.5px]">
            <span>
              {liitettavat.length === 1
                ? '1 tosite on ilman kumppania, mutta sen otsikko vastaa kumppanin nimeä.'
                : `${liitettavat.length} tositetta on ilman kumppania, mutta niiden otsikko vastaa kumppanin nimeä.`}
            </span>
            <Button
              variant="sec"
              size="compact"
              disabled={liittaa}
              onClick={async () => setLiitosTulos(await liita(liitettavat))}
            >
              {liittaa ? 'Liitetään…' : 'Liitä kumppaneihin'}
            </Button>
          </div>
        )}
        {liitosTulos && (
          <output className="mb-3 block text-[12.5px] text-[var(--text-muted)]">
            {`Liitetty ${liitosTulos.liitetty} ${liitosTulos.liitetty === 1 ? 'tosite' : 'tositetta'}.`}
            {liitosTulos.epaonnistui > 0 &&
              ` ${liitosTulos.epaonnistui} jäi liittämättä (esim. lukittu kausi).`}
          </output>
        )}

        {(virhe ?? virheviesti) && (
          <p role="alert" className="mb-3 text-[12.5px] text-[var(--danger)]">
            {virhe ?? virheviesti}
          </p>
        )}

        {!isLoading && (kumppanit ?? []).length === 0 ? (
          <p className="text-[13.5px] text-[var(--text-muted)]">Ei kumppaneita.</p>
        ) : !isLoading && suodatetut.length === 0 ? (
          <p className="text-[13.5px] text-[var(--text-muted)]">Ei hakutuloksia.</p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className={`whitespace-nowrap px-[10px] pb-[7px] text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)] ${
                        h.column.columnDef.meta?.oikealle ? 'text-right' : 'text-left'
                      }`}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-[var(--border)] hover:bg-[var(--bg-subtle)]"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={
                        cell.column.columnDef.meta?.oikealle
                          ? 'whitespace-nowrap px-[10px] py-[4px] text-right'
                          : 'px-[4px] py-[4px]'
                      }
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
