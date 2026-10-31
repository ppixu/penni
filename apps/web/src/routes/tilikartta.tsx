import { useInit, useTallennaTili } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { TiliEditori } from '@/tilikartta/TiliEditori';
import { ryhmanVihje, tilinSelite, tyypinSelite } from '@/tilikartta/selitteet';
import {
  NAKYMAT,
  type Nakyma,
  type TiliRyhma,
  type TilienSaldot,
  type TilinKaytto,
  alkunakyma,
  etuliitteenNumero,
  lahinOtsikko,
  lueTiliHaku,
  naytettavaSaldo,
  onNakyma,
  onTapahtumia,
  ryhmanSaldo,
  ryhmienEtuliitteet,
  ryhmitteleTilit,
  tasmaaTiliHakuun,
  tilinRyhmat,
  tilitNakymassa,
  useTilienKaytto,
  useTilienSaldot,
} from '@/tilikartta/tilinakyma';
import { useTiliSuosio } from '@/tilikartta/tilisuosio';
import { useValittuTilikausi } from '@/tilikausi/valittuTilikausi';
import { type Tili, lataaKartta, nimi, tyyppiKoodilla } from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { BookOpen, ChevronDown, ChevronRight, Eye, EyeOff, Pencil } from 'lucide-react';
import {
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * Osoitteen hakuparametrit: valittu näkymä säilyy, kun sivulta palataan, ja `tili` vie
 * kaikki-näkymässä tilin kohdalle (esim. `/tilikartta?nakyma=kaikki&tili=4000`).
 */
interface TilikarttaHaku {
  nakyma?: Nakyma | undefined;
  tili?: number | undefined;
}

export const Route = createFileRoute('/tilikartta')({
  // Tuntematon arvo putoaa oletukseen (ks. tositteet.index.tsx: puuttuva avain nollataan).
  validateSearch: (haku: Record<string, unknown>): TilikarttaHaku => ({
    nakyma: onNakyma(haku.nakyma) ? haku.nakyma : undefined,
    tili: lueTiliHaku(haku.tili),
  }),
  component: Tilikartta,
});

/**
 * Tilikartta listana lehtitilejä (otsikkotaso === 0) kolmessa näkymässä: suosikit, viimeksi
 * käytetyt (valittu + edellinen tilikausi) ja kaikki. Kartan omia otsikkorivejä ei näytetä
 * sellaisinaan; kaikki-näkymä ryhmittelee tilit kahdelle tasolle kokoontaitettaviin ryhmiin
 * (1000, 1100, …), joiden nimet tulevat kartan otsikoista (ks. ryhmitteleTilit). Suosikit ja
 * viimeksi käytetyt ovat tasaisia listoja (lyhyitä; viimeksi käytetyt päiväjärjestyksessä), ja
 * niissä sekä hakutuloksissa rivin valinta hyppää tilin kohdalle kaikki-näkymässä avaten tilin
 * ryhmät. Haku kaikki-näkymässä pitää ryhmittelyn mutta avaa kaikki osumaryhmät. Jokaiselta
 * riviltä pääsee tilin tai tiliryhmän pääkirjaan valitulla tilikaudella, ja nimen voi vaihtaa
 * rivillä (kynä tai F2). TiliEditori saa kartan kokonaisena.
 */
function Tilikartta() {
  const navigate = useNavigate();
  const { data: init } = useInit();
  const { nakyma: valittu, tili: kohdeTili } = Route.useSearch();
  const { suosikit, piilotetut, asetaSuosikki, asetaPiilotettu, virheviesti } = useTiliSuosio();
  const valinta = useValittuTilikausi();
  const kaytto = useTilienKaytto(valinta);
  const tilienSaldot = useTilienSaldot(valinta.kausi);
  const [haku, setHaku] = useState('');
  const [naytaPiilotetut, setNaytaPiilotetut] = useState(false);
  const [vainTapahtumat, setVainTapahtumat] = useState(false);
  // Kaikki-näkymän kokoontaitetut ryhmät etuliitteinä: "1" = 1000-ryhmä, "11" = 1100-alaryhmä.
  const [suljetut, setSuljetut] = useState<ReadonlySet<string>>(new Set());
  // null = closed; 'uusi' = add; a Tili = edit that leaf.
  const [muokattava, setMuokattava] = useState<Tili | 'uusi' | null>(null);
  // Tili, jonka nimeä muokataan rivillä.
  const [nimettava, setNimettava] = useState<number | null>(null);
  const { tallenna: tallennaTili, virheviesti: tiliVirhe } = useTallennaTili();

  const kartta = useMemo(() => (init ? lataaKartta(init.tilit) : []), [init]);
  const lehdet = useMemo(() => kartta.filter((t) => t.otsikkotaso === 0), [kartta]);
  const otsikkoHaku = useMemo(() => lahinOtsikko(kartta), [kartta]);

  // Oletusnäkymä lukitaan ensimmäisellä kerralla kun data on saatavilla, jottei näkymä
  // vaihdu alta esim. ensimmäisen tähden painalluksen jälkeen.
  const [oletus, setOletus] = useState<Nakyma | null>(null);
  const laskettuOletus: Nakyma | null =
    init === undefined
      ? null
      : suosikit.size > 0
        ? 'suosikit'
        : kaytto === undefined
          ? null
          : alkunakyma(0, kaytto.size);
  if (oletus === null && laskettuOletus !== null) setOletus(laskettuOletus);
  const nakyma: Nakyma | null =
    valittu ?? (kohdeTili !== undefined ? 'kaikki' : (oletus ?? laskettuOletus));

  // Hyppy tilin kohdalle: osoitteen tili-arvo käsitellään kerran, kun kartta on ladattu.
  // Haku tyhjennetään ja piilotettu kohde tuodaan näkyviin, jotta rivi on listassa.
  // Tuntematon tili ei tee mitään (näytetään pelkkä kaikki-näkymä).
  const [kasiteltyTili, setKasiteltyTili] = useState<number | undefined>(undefined);
  const [vieritettava, setVieritettava] = useState<number | null>(null);
  const [korostettu, setKorostettu] = useState<number | null>(null);
  function tuoNakyviin(numero: number): void {
    setHaku('');
    if (piilotetut.has(numero)) setNaytaPiilotetut(true);
    const avattavat = tilinRyhmat(numero);
    setSuljetut((s) =>
      avattavat.some((r) => s.has(r)) ? new Set([...s].filter((r) => !avattavat.includes(r))) : s,
    );
    setVieritettava(numero);
  }
  if (init && kohdeTili !== kasiteltyTili) {
    setKasiteltyTili(kohdeTili);
    if (
      nakyma === 'kaikki' &&
      kohdeTili !== undefined &&
      lehdet.some((t) => t.numero === kohdeTili)
    )
      tuoNakyviin(kohdeTili);
  }

  const piilotettujaLkm = useMemo(
    () => lehdet.filter((t) => piilotetut.has(t.numero)).length,
    [lehdet, piilotetut],
  );

  const naytettavat = useMemo<Tili[]>(() => {
    if (nakyma === null) return [];
    // Saldojen latautuessa suodatin ei vielä rajaa mitään.
    const tapahtumissa = (t: Tili) =>
      !vainTapahtumat || tilienSaldot === undefined || onTapahtumia(t.numero, tilienSaldot);
    return tilitNakymassa(lehdet, nakyma, { suosikit, piilotetut, kaytto, naytaPiilotetut }).filter(
      (t) => tasmaaTiliHakuun(t.numero, nimi(t), haku) && tapahtumissa(t),
    );
  }, [
    nakyma,
    lehdet,
    suosikit,
    piilotetut,
    kaytto,
    naytaPiilotetut,
    haku,
    vainTapahtumat,
    tilienSaldot,
  ]);

  // Ryhmät vain kaikki-näkymässä; haun aikana kaikki ryhmät ovat auki, jottei osuma jää piiloon.
  const ryhmat = useMemo(
    () => (nakyma === 'kaikki' ? ryhmitteleTilit(naytettavat, kartta) : null),
    [nakyma, naytettavat, kartta],
  );
  const haetaan = haku.trim() !== '';

  function asetaAuki(etuliite: string, auki: boolean): void {
    setSuljetut((s) => {
      if (s.has(etuliite) !== auki) return s;
      const uusi = new Set(s);
      if (auki) uusi.delete(etuliite);
      else uusi.add(etuliite);
      return uusi;
    });
  }

  // Tyhjä tai muuttumaton nimi ei tallennu. Muut kielet ja kartan avaimet säilyvät.
  async function nimea(tili: Tili, uusiNimi: string | null): Promise<void> {
    setNimettava(null);
    const uusi = uusiNimi?.trim() ?? '';
    if (uusi === '' || uusi === nimi(tili)) return;
    await tallennaTili(tili.numero, {
      ...tili.data,
      numero: tili.numero,
      tyyppi: tili.tyyppiKoodi,
      nimi: { ...tili.nimi, fi: uusi },
    });
  }

  function valitseNakyma(arvo: Nakyma): void {
    void navigate({ to: '/tilikartta', search: { nakyma: arvo }, replace: true });
  }

  // Uusi historiamerkintä, jotta selaimen Takaisin palaa lähtönäkymään. Jos osoite on jo
  // sama (hakutulos kaikki-näkymässä), navigointi ei muuta mitään, joten hypätään suoraan.
  function hyppaa(numero: number): void {
    if (nakyma === 'kaikki' && kohdeTili === numero) tuoNakyviin(numero);
    else void navigate({ to: '/tilikartta', search: { nakyma: 'kaikki', tili: numero } });
  }

  // Rivi vieritetään keskelle ja kohdistetaan vasta kun se on DOMissa (piilotettujen
  // näyttäminen ja haun tyhjennys renderöivät listan ensin). jsdomissa ei ole scrollIntoViewta.
  const osioRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (vieritettava === null || naytettavat.length === 0) return;
    const rivi = osioRef.current?.querySelector<HTMLElement>(`tr[data-tili="${vieritettava}"]`);
    if (!rivi) return;
    rivi.scrollIntoView?.({ block: 'center' });
    rivi.focus({ preventScroll: true });
    setVieritettava(null);
    setKorostettu(vieritettava);
  }, [vieritettava, naytettavat]);

  // Korostus haalistuu pois (taustan transitio rivillä).
  useEffect(() => {
    if (korostettu === null) return;
    const ajastin = setTimeout(() => setKorostettu(null), 1600);
    return () => clearTimeout(ajastin);
  }, [korostettu]);

  if (!init || nakyma === null) {
    return (
      <>
        <TopBar otsikko="Tilikartta" />
        <p className="px-[22px] py-5 text-[var(--text-muted)]">Ladataan…</p>
      </>
    );
  }

  const viimeksiSarakkeet = nakyma === 'viimeksi';
  const hyppytila = nakyma !== 'kaikki' || haku.trim() !== '';
  const sarakkeita = viimeksiSarakkeet ? 8 : 7;
  const tyhjaTeksti =
    haku.trim() !== ''
      ? 'Ei hakua vastaavia tilejä.'
      : vainTapahtumat && nakyma !== 'viimeksi'
        ? 'Ei tilejä, joilla on tapahtumia valitulla tilikaudella.'
        : nakyma === 'suosikit'
          ? 'Ei suosikkitilejä. Merkitse tili suosikiksi tähdestä.'
          : nakyma === 'viimeksi'
            ? 'Tileille ei ole kirjauksia valitulla tai edellisellä tilikaudella.'
            : 'Ei tilejä.';

  const rivi = (t: Tili) => (
    <TiliRivi
      key={t.numero}
      tili={t}
      suosikki={suosikit.has(t.numero)}
      piilotettu={piilotetut.has(t.numero)}
      kaytto={viimeksiSarakkeet ? (kaytto?.get(t.numero) ?? null) : undefined}
      saldo={tilienSaldot && naytettavaSaldo(t, tilienSaldot.saldot)}
      viennit={tilienSaldot && (tilienSaldot.maarat.get(t.numero) ?? 0)}
      selite={tilinSelite(t, otsikkoHaku(t.numero))}
      korostettu={korostettu === t.numero}
      nimetaan={nimettava === t.numero}
      sisennetty={ryhmat !== null}
      onAvaa={() => setMuokattava(t)}
      onAloitaNimeys={() => setNimettava(t.numero)}
      onNimea={(uusi) => void nimea(t, uusi)}
      {...(hyppytila ? { onHyppaa: () => hyppaa(t.numero) } : {})}
      onSuosikki={(arvo) => void asetaSuosikki(t.numero, arvo)}
      onPiilota={(arvo) => void asetaPiilotettu(t.numero, arvo)}
    />
  );

  return (
    <>
      <TopBar
        otsikko="Tilikartta"
        toiminnot={
          <Button size="compact" onClick={() => setMuokattava('uusi')}>
            Uusi tili
          </Button>
        }
      />
      <section
        ref={osioRef}
        aria-label="tilikartta"
        className="flex-1 overflow-auto px-[22px] py-5"
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <fieldset className="inline-flex w-fit gap-[2px] rounded-[9px] bg-[var(--track)] p-[3px]">
            <legend className="sr-only">Näkymä</legend>
            {NAKYMAT.map((n) => (
              <button
                key={n.arvo}
                type="button"
                aria-pressed={nakyma === n.arvo}
                onClick={() => valitseNakyma(n.arvo)}
                className={`whitespace-nowrap rounded-[6px] px-[13px] py-1.5 text-[12.5px] ${
                  nakyma === n.arvo
                    ? 'bg-[var(--surface)] font-semibold text-[var(--accent)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                    : 'font-medium text-[var(--text-muted)]'
                }`}
              >
                {n.label}
              </button>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
            Hae
            <input
              type="search"
              aria-label="Hae tiliä"
              value={haku}
              onChange={(e) => setHaku(e.target.value)}
              placeholder="Numero tai nimi"
              className="w-[220px] rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]"
            />
          </label>
          {nakyma !== 'viimeksi' && (
            <label
              title="Piilota tilit, joilla ei ole vientejä eikä saldoa valitulla tilikaudella."
              className="flex items-center gap-2 pb-2 text-[12.5px] text-[var(--text-muted)]"
            >
              <input
                type="checkbox"
                checked={vainTapahtumat}
                onChange={(e) => setVainTapahtumat(e.target.checked)}
              />
              Vain tilit, joilla tapahtumia
            </label>
          )}
          {nakyma === 'kaikki' && (
            <label className="flex items-center gap-2 pb-2 text-[12.5px] text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={naytaPiilotetut}
                onChange={(e) => setNaytaPiilotetut(e.target.checked)}
              />
              {`Näytä piilotetut (${piilotettujaLkm})`}
            </label>
          )}
          {ryhmat !== null && !haetaan && ryhmat.length > 0 && (
            <div className="ml-auto flex gap-2 pb-[3px]">
              <Button variant="sec" size="compact" onClick={() => setSuljetut(new Set())}>
                Avaa kaikki
              </Button>
              <Button
                variant="sec"
                size="compact"
                onClick={() => setSuljetut(new Set(ryhmienEtuliitteet(ryhmat)))}
              >
                Sulje kaikki
              </Button>
            </div>
          )}
        </div>

        {(virheviesti ?? tiliVirhe) && (
          <p role="alert" className="mb-3 text-[12.5px] text-[var(--danger)]">
            {virheviesti ?? tiliVirhe}
          </p>
        )}

        {naytettavat.length === 0 ? (
          <p className="text-[13.5px] text-[var(--text-muted)]">{tyhjaTeksti}</p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
                <th className="w-[36px] pb-[7px]">
                  <span className="sr-only">Suosikki</span>
                </th>
                <th className="w-[64px] px-[10px] pb-[7px]">Numero</th>
                <th className="px-[10px] pb-[7px]">Nimi</th>
                <th className="px-[10px] pb-[7px]">Tyyppi</th>
                {viimeksiSarakkeet && <th className="px-[10px] pb-[7px]">Viimeksi</th>}
                <th
                  title="Saldo valitun tilikauden lopussa: taseen tileillä kertynyt saldo, tuloslaskelman tileillä kauden summa. Kulut näytetään positiivisina."
                  className="px-[10px] pb-[7px] text-right"
                >
                  Saldo
                </th>
                <th
                  title="Vientien määrä valitulla tilikaudella."
                  className="px-[10px] pb-[7px] text-right"
                >
                  Viennit
                </th>
                <th className="w-[96px] pb-[7px]">
                  <span className="sr-only">Toiminnot</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ryhmat === null
                ? naytettavat.map(rivi)
                : ryhmat.map((r) => (
                    <RyhmanRivit
                      key={r.etuliite}
                      ryhma={r}
                      auki={(etuliite) => haetaan || !suljetut.has(etuliite)}
                      sarakkeita={sarakkeita}
                      tilienSaldot={tilienSaldot}
                      onAseta={asetaAuki}
                      rivi={rivi}
                    />
                  ))}
            </tbody>
          </table>
        )}
      </section>
      {muokattava !== null && (
        <TiliEditori
          {...(muokattava !== 'uusi' ? { tili: muokattava } : {})}
          kartta={kartta}
          onPeruuta={() => setMuokattava(null)}
          onSuljeJaPaivita={() => setMuokattava(null)}
        />
      )}
    </>
  );
}

const SOLU = 'px-[10px] py-[9px]';

/** Rivin toimintonappien yhteinen tyyli; piilossa kunnes rivi on hiiren alla tai kohdistettuna. */
const TOIMINTO =
  'inline-flex rounded-[4px] p-[4px] text-[var(--text-subtle)] hover:text-[var(--text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]';
const PIILOSSA = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100';

/** Ryhmitellyn näkymän sisennys tasoittain: alaryhmä (1100) yhden askeleen, tilit kaksi. */
const SISENNYS = ['', 'pl-[20px]', 'pl-[48px]'] as const;

/** Pääryhmän otsikko ja sen alaryhmät tileineen; suljetun ryhmän sisältö ei renderöidy. */
function RyhmanRivit({
  ryhma,
  auki,
  sarakkeita,
  tilienSaldot,
  onAseta,
  rivi,
}: {
  ryhma: TiliRyhma;
  auki: (etuliite: string) => boolean;
  sarakkeita: number;
  tilienSaldot: TilienSaldot | undefined;
  onAseta: (etuliite: string, auki: boolean) => void;
  rivi: (t: Tili) => ReactNode;
}) {
  const paaAuki = auki(ryhma.etuliite);
  return (
    <>
      <RyhmaRivi
        ryhma={ryhma}
        auki={paaAuki}
        sarakkeita={sarakkeita}
        tilienSaldot={tilienSaldot}
        onAseta={(arvo) => onAseta(ryhma.etuliite, arvo)}
      />
      {paaAuki &&
        ryhma.alaryhmat.map((a) => {
          const alaAuki = auki(a.etuliite);
          return (
            <Fragment key={a.etuliite}>
              <RyhmaRivi
                ryhma={a}
                auki={alaAuki}
                sarakkeita={sarakkeita}
                tilienSaldot={tilienSaldot}
                onAseta={(arvo) => onAseta(a.etuliite, arvo)}
              />
              {alaAuki && a.tilit.map(rivi)}
            </Fragment>
          );
        })}
    </>
  );
}

/** Etuliitteen tilinumeroväli otsikkoon: "11" → "1100–1199". */
function etuliitteenVali(etuliite: string): string {
  return `${etuliitteenNumero(etuliite)}–${etuliite.padEnd(4, '9')}`;
}

/** Saldo- ja viennit-solut; tyhjä, kun saldo on nolla tai tietoja ei vielä ole. */
function SaldoSolut({ saldo, viennit }: { saldo: Cents | undefined; viennit: number | undefined }) {
  return (
    <>
      <td data-testid="saldo" className={`${SOLU} whitespace-nowrap text-right tabular-nums`}>
        {saldo ? muotoileEuro(saldo) : ''}
      </td>
      <td
        data-testid="viennit"
        className={`${SOLU} text-right tabular-nums text-[var(--text-muted)]`}
      >
        {viennit || ''}
      </td>
    </>
  );
}

/**
 * Ryhmäotsikko (1000 tai 1100): kartan otsikon nimi (toistuvalla nimellä tarkenne sulkeissa),
 * tilien määrä sekä tilien yhteissaldo ja viennit. Hiiren alla otsikon selite ja sisältö.
 * Klikkaus, Enter ja välilyönti taittavat, nuoli oikealle avaa ja vasemmalle sulkee.
 * Kirja-kuvake vie ryhmän pääkirjaan.
 */
function RyhmaRivi({
  ryhma: { etuliite, nimi, tarkenne, otsikko, sisalto, tilit },
  auki,
  sarakkeita,
  tilienSaldot,
  onAseta,
}: {
  ryhma: Pick<TiliRyhma, 'etuliite' | 'nimi' | 'tarkenne' | 'otsikko' | 'sisalto' | 'tilit'>;
  auki: boolean;
  sarakkeita: number;
  tilienSaldot: TilienSaldot | undefined;
  onAseta: (auki: boolean) => void;
}) {
  const Nuoli = auki ? ChevronDown : ChevronRight;
  const maara = tilit.length;
  const vihje = ryhmanVihje(otsikko, sisalto);
  const ylin = etuliite.length === 1;
  const numero = etuliitteenNumero(etuliite);
  return (
    <tr
      data-ryhma={etuliite}
      className={`group border-t border-[var(--border)] ${ylin ? 'bg-[var(--bg-subtle)]' : ''}`}
    >
      <td colSpan={sarakkeita - 3} className="p-0">
        <button
          type="button"
          aria-expanded={auki}
          title={vihje || undefined}
          onClick={() => onAseta(!auki)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' && !auki) onAseta(true);
            else if (e.key === 'ArrowLeft' && auki) onAseta(false);
            else return;
            e.preventDefault();
          }}
          className={`flex w-full items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
            ylin
              ? 'py-[8px] text-[12.5px] font-semibold'
              : `${SISENNYS[1]} py-[6px] text-[12.5px] font-medium`
          }`}
        >
          {/* Leveydet seuraavat tilirivin tähti- ja numerosarakkeita. */}
          <span className="flex w-[36px] shrink-0 justify-center text-[var(--text-subtle)]">
            <Nuoli size={ylin ? 14 : 13} aria-hidden />
          </span>
          <span
            className={`w-[64px] shrink-0 px-[10px] tabular-nums ${ylin ? '' : 'text-[var(--text-muted)]'}`}
          >
            {numero}
          </span>
          <span className="px-[10px]">
            {nimi || `${numero}-alkuiset tilit`}
            {tarkenne && (
              <span className="font-normal text-[var(--text-muted)]">{` (${tarkenne})`}</span>
            )}
            <span className="ml-2 font-normal text-[var(--text-subtle)]">{maara}</span>
          </span>
        </button>
      </td>
      <SaldoSolut
        saldo={tilienSaldot && ryhmanSaldo(tilit, tilienSaldot.saldot)}
        viennit={
          tilienSaldot && tilit.reduce((n, t) => n + (tilienSaldot.maarat.get(t.numero) ?? 0), 0)
        }
      />
      <td className="pr-[4px] text-right">
        <ViennitLinkki
          haku={{ tiliryhma: Number(etuliite) }}
          otsikko={`Näytä viennit ${etuliitteenVali(etuliite)}`}
        />
      </td>
    </tr>
  );
}

/** Pääkirja rajattuna tiliin tai tiliryhmään; tilikausi tulee sivupalkin valinnasta. */
function ViennitLinkki({
  haku,
  otsikko,
}: {
  haku: { tili: number } | { tiliryhma: number };
  otsikko: string;
}) {
  return (
    <Link
      to="/raportit"
      search={{ raportti: 'paakirja', ...haku }}
      aria-label={otsikko}
      title={otsikko}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className={`${TOIMINTO} ${PIILOSSA}`}
    >
      <BookOpen size={14} aria-hidden />
    </Link>
  );
}

/**
 * Nimen muokkaus rivillä: Enter tai poistuminen tallentaa, Esc peruu. Kohdistus palaa riville,
 * jotta näppäimistöllä voi jatkaa.
 */
function NimiKentta({
  alkuarvo,
  numero,
  onValmis,
}: {
  alkuarvo: string;
  numero: number;
  onValmis: (uusi: string | null) => void;
}) {
  // Enter/Esc sulkee kentän, minkä jälkeen selain voi vielä laukaista blurin; vain ensimmäinen
  // lopetus lasketaan.
  const valmis = useRef(false);
  function lopeta(uusi: string | null, kentta: HTMLInputElement, palaaRiville: boolean) {
    if (valmis.current) return;
    valmis.current = true;
    if (palaaRiville) kentta.closest('tr')?.focus();
    onValmis(uusi);
  }
  const pysayta = (e: MouseEvent) => e.stopPropagation();
  return (
    <input
      aria-label={`Tilin ${numero} nimi`}
      defaultValue={alkuarvo}
      // biome-ignore lint/a11y/noAutofocus: kenttä avataan nimenomaan muokkausta varten
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onClick={pysayta}
      onDoubleClick={pysayta}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') lopeta(e.currentTarget.value, e.currentTarget, true);
        else if (e.key === 'Escape') lopeta(null, e.currentTarget, true);
      }}
      onBlur={(e) => lopeta(e.currentTarget.value, e.currentTarget, false)}
      className="-my-[3px] w-full max-w-[360px] rounded-[5px] border border-[var(--accent)] px-[7px] py-[3px] text-[12.5px] focus-visible:outline-none"
    />
  );
}

function TiliRivi({
  tili,
  suosikki,
  piilotettu,
  kaytto,
  saldo,
  viennit,
  selite,
  korostettu,
  nimetaan,
  sisennetty,
  onAvaa,
  onHyppaa,
  onAloitaNimeys,
  onNimea,
  onSuosikki,
  onPiilota,
}: {
  tili: Tili;
  suosikki: boolean;
  piilotettu: boolean;
  /** Rivi on ryhmän alla (kaikki-näkymä): sisennetään alaryhmän otsikkoa syvemmälle. */
  sisennetty: boolean;
  /** undefined = sarakkeet eivät ole näkyvissä; null = ei käyttöä. */
  kaytto: TilinKaytto | null | undefined;
  /** Valitun tilikauden saldo ja viennit; undefined latautuessa. */
  saldo: Cents | undefined;
  viennit: number | undefined;
  /** Hiiren alla nimen päällä: mitä tilille kirjataan. */
  selite: string | undefined;
  /** Hetken korostus hypyn jälkeen. */
  korostettu: boolean;
  /** Nimi on muokattavana rivillä. */
  nimetaan: boolean;
  onAvaa: () => void;
  /** Annettuna klikkaus ja Enter hyppäävät tilin kohdalle editorin avaamisen sijaan. */
  onHyppaa?: () => void;
  onAloitaNimeys: () => void;
  /** Uusi nimi, tai null kun muokkaus perutaan. */
  onNimea: (uusi: string | null) => void;
  onSuosikki: (suosikki: boolean) => void;
  onPiilota: (piilotettu: boolean) => void;
}) {
  // Rivin toimintonapit eivät saa avata editoria tai hypätä (klikkaus, tuplaklikkaus tai
  // Enter rivillä).
  const pysayta = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();
  const valitse = onHyppaa ?? onAvaa;
  return (
    <tr
      tabIndex={0}
      data-tili={tili.numero}
      data-korostettu={korostettu || undefined}
      title={onHyppaa ? 'Näytä tilikartassa' : undefined}
      onClick={onHyppaa}
      onDoubleClick={onHyppaa ? undefined : onAvaa}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') valitse();
        else if (e.key === 'F2') {
          e.preventDefault();
          onAloitaNimeys();
        }
      }}
      className={`group border-t border-[var(--border)] transition-colors duration-700 hover:bg-[var(--bg-subtle)] focus-visible:outline-none ${
        korostettu
          ? 'bg-[var(--accent-soft)] focus-visible:bg-[var(--accent-soft)]'
          : 'focus-visible:bg-[var(--bg-subtle)]'
      } ${onHyppaa ? 'cursor-pointer' : ''} ${piilotettu ? 'text-[var(--text-muted)]' : ''}`}
    >
      <td className={`py-[5px] ${sisennetty ? SISENNYS[2] : 'pl-[4px]'}`}>
        <button
          type="button"
          aria-label={suosikki ? 'Poista suosikeista' : 'Lisää suosikkeihin'}
          aria-pressed={suosikki}
          onClick={(e) => {
            pysayta(e);
            onSuosikki(!suosikki);
          }}
          onDoubleClick={pysayta}
          onKeyDown={pysayta}
          className={`rounded-[4px] px-[6px] py-[2px] text-[15px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
            suosikki
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-subtle)] opacity-60 hover:opacity-100'
          }`}
        >
          {suosikki ? '★' : '☆'}
        </button>
      </td>
      <td className={`${SOLU} tabular-nums text-[var(--text-subtle)]`}>{tili.numero}</td>
      <td className={SOLU} title={selite}>
        {nimetaan ? (
          <NimiKentta alkuarvo={nimi(tili)} numero={tili.numero} onValmis={onNimea} />
        ) : (
          <>
            {nimi(tili)}
            {piilotettu && (
              <span className="ml-2 rounded-[4px] bg-[var(--bg-subtle)] px-[6px] py-[1px] text-[10.5px] text-[var(--text-muted)]">
                piilotettu
              </span>
            )}
          </>
        )}
      </td>
      <td
        title={tyypinSelite(tili.tyyppiKoodi)}
        className={`${SOLU} cursor-help text-[var(--text-muted)]`}
      >
        {tyyppiKoodilla(tili.tyyppiKoodi).kuvaus}
      </td>
      {kaytto !== undefined && (
        <td className={`${SOLU} tabular-nums text-[var(--text-muted)]`}>
          {kaytto ? muotoilePvm(kaytto.viimeksi) : '—'}
        </td>
      )}
      <SaldoSolut saldo={saldo} viennit={viennit} />
      <td className="whitespace-nowrap py-[5px] pr-[4px] text-right">
        <button
          type="button"
          aria-label={`Nimeä tili ${tili.numero} uudelleen`}
          title="Nimeä uudelleen (F2)"
          onClick={(e) => {
            pysayta(e);
            onAloitaNimeys();
          }}
          onDoubleClick={pysayta}
          onKeyDown={pysayta}
          className={`${TOIMINTO} ${PIILOSSA}`}
        >
          <Pencil size={14} aria-hidden />
        </button>
        <ViennitLinkki
          haku={{ tili: tili.numero }}
          otsikko={`Näytä tilin ${tili.numero} viennit`}
        />
        <button
          type="button"
          aria-label={piilotettu ? 'Näytä tili' : 'Piilota tili'}
          title={piilotettu ? 'Näytä tili' : 'Piilota tili'}
          onClick={(e) => {
            pysayta(e);
            onPiilota(!piilotettu);
          }}
          onDoubleClick={pysayta}
          onKeyDown={pysayta}
          className={`${TOIMINTO} ${piilotettu ? '' : PIILOSSA}`}
        >
          {piilotettu ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}
        </button>
      </td>
    </tr>
  );
}
