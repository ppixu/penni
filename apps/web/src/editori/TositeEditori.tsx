import { TositeTyyppiIkoni } from '@/components/TositeTyyppiIkoni';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { tositeTyyppiLabel } from '@/lib/tosite';
import { cn } from '@/lib/utils';
import { JAETTU_ASETTELU, JAETTU_PAA } from '@/liitteet/LiitePaneeli';
import type { Tili, TilioteTiedot } from '@penni/engine';
import { TositeTyyppi } from '@penni/engine';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { KirjausYhteenveto } from './KirjausYhteenveto.js';
import { SegmentedControl } from './SegmentedControl.js';
import { TasmaaPalkki, type TasmaaTila } from './TasmaaPalkki.js';
import { TiliotePaneeli } from './TiliotePaneeli.js';
import { VientiGrid } from './VientiGrid.js';
import { johdaViennit } from './johdaViennit.js';
import { reducer } from './reducer.js';
import type { TositeEditoriTila } from './types.js';
import { useGridFocus } from './useGridFocus.js';
import { useTositeEditori } from './useTositeEditori.js';

/**
 * Tositteen tyyppivaihtoehdot (ruudukkoeditori ja vain luku -näkymän tyypin vaihto): Kitsaksen
 * käsin lisättävät tyypit (tositetyyppimodel.cpp:31-50) ilman laskuja — kulu- ja
 * verkkolaskut kulkevat omien lomakkeidensa kautta — ja ilman harvinaisia Liitetieto, Tuonti
 * ja Muu. Kuvake on sama kuin tositelistassa ja kojelaudalla.
 */
const tyyppi = (arvo: number, label: string) => ({
  arvo,
  label,
  ikoni: <TositeTyyppiIkoni tyyppi={arvo} className="h-5 w-5" />,
});
export const TYYPPIVAIHTOEHDOT = [
  tyyppi(TositeTyyppi.MENO, 'Meno'),
  tyyppi(TositeTyyppi.TULO, 'Tulo'),
  tyyppi(TositeTyyppi.SIIRTO, 'Siirto'),
  tyyppi(TositeTyyppi.TILIOTE, 'Tiliote'),
  tyyppi(TositeTyyppi.PALKKA, 'Palkka'),
  tyyppi(TositeTyyppi.MUISTIO, 'Muistio'),
];

/** Outcome of a save: the stored voucher's assigned id, or undefined if it failed/was blocked. */
export interface TallennusTulos {
  id: number;
  /** Tallennetun tositteen numero, sarja ja tyyppi (vahvistusviestiin). */
  tunniste?: number;
  sarja?: string;
  tyyppi?: number;
}

/** "Meno 79" / "Meno A 12": tyyppi + sarja + numero. */
export function tositteenNimi(t: TallennusTulos): string {
  const nro = t.tunniste !== undefined && t.tunniste > 0 ? `${t.sarja ?? ''} ${t.tunniste}` : '';
  return `${tositeTyyppiLabel(t.tyyppi ?? 0)} ${nro.trim()}`.trim();
}

/** Ulkoa tuleva lomakkeen täyttö (esim. luettu kuitti). */
export interface LomakkeenTaytto {
  /** Vaihtuva avain: jokainen uusi arvo käynnistää yhden täytön. */
  avain: number;
  /** Puhdas funktio: React voi ajaa sen kehitystilassa (StrictMode) kahdesti. */
  laske: (
    nykyinen: TositeEditoriTila,
    /** Lomakkeen oletuspäivä: alkupäivä tai "Tallenna ja uusi" -toiminnon säilyttämä päivä. */
    oletusPaiva: string,
    /** Käyttäjä kirjoittaa riviin parhaillaan (vahvistamaton syöte): rivejä ei saa korvata. */
    rivitKaytossa: boolean,
  ) => { tila: TositeEditoriTila; kuvaus: string; lahde?: string } | null;
}

export function TositeEditori({
  chart,
  alkupaiva,
  initial,
  onTallennettu,
  onTallenna,
  virheviesti,
  onkoAlvVelvollinen,
  pankkitili,
  tallennettuLinkki,
  otsikko = 'Uusi tosite',
  alaotsikko = 'Luonnos · ei numeroa ennen tallennusta',
  lisatoiminnot,
  ilmoitukset,
  sivupaneeli,
  lomakkeenNimi,
  tallennaJaUusi = true,
  taytto,
  onMuutos,
  onKenttaPoistui,
  onNollattu,
  onLueTiliote,
  tallennaTeksti = 'Tallenna',
  vahvistus = 'Tallennettu',
}: {
  chart: readonly Tili[];
  /** Kirjanpidon oletuspankkitili: Meno/Tulo-tositteen tasaava rivi esitäytetään sillä. */
  pankkitili?: number | undefined;
  /** Alv-velvollisuus päivälle (tilin alv-oletuksen esitäyttö); puuttuu = velvollinen. */
  onkoAlvVelvollinen?: (pvm: string) => boolean;
  alkupaiva: string;
  initial?: Partial<TositeEditoriTila>;
  /** Route-owned: navigate to the stored voucher (create) — passed the assigned id. */
  onTallennettu?: (id: number) => void;
  /**
   * Tallennuspainikkeen toiminto (Kirjaa / Tallenna). Palauttaa tallennetun tositteen tai
   * undefined, kun moottori esti (virhe näkyy `virheviesti`-propissa). Puuttuu = ei
   * tallennuspainikkeita (automaattisesti tallentuva kirjattu tosite).
   */
  onTallenna?: (tila: TositeEditoriTila) => Promise<TallennusTulos | undefined>;
  /** Inline error message from the injected save (Phase O maps it from ResourceError.code). */
  virheviesti?: string | null;
  /** Reitin linkki tallennettuun tositteeseen "Tallenna ja uusi" -vahvistuksessa. */
  tallennettuLinkki?: (tulos: TallennusTulos, teksti: string) => ReactNode;
  otsikko?: string;
  alaotsikko?: string;
  /** Reitin omat lisätoiminnot yläpalkkiin (esim. Poista) ennen Tallenna-painikkeita. */
  lisatoiminnot?: ReactNode;
  /** Reitin ilmoitukset lomakkeen yläosaan (esim. poistovirhe). */
  ilmoitukset?: ReactNode;
  /** Lomakkeen viereen (kapealla näytöllä alle) näytettävä paneeli, esim. kuitin esikatselu. */
  sivupaneeli?: ReactNode;
  /** Lomakkeen saavutettava nimi (esim. tositesivun "tosite"-maamerkki). */
  lomakkeenNimi?: string;
  /** false piilottaa "… ja uusi" -toiminnon (esim. täsmäytyksen käsikirjaus, avattu tosite). */
  tallennaJaUusi?: boolean;
  /**
   * Ulkoa tuleva täyttö (esim. luettu kuitti): `laske` saa lomakkeen nykyisen tilan täyttöhetkellä,
   * joten käyttäjän sillä välin kirjoittama säilyy.
   */
  taytto?: LomakkeenTaytto | undefined;
  /** Jokainen lomakkeen tila, myös alkutila: automaattinen tallennus seuraa tätä. */
  onMuutos?: ((tila: TositeEditoriTila) => void) | undefined;
  /** Kenttä menetti fokuksen (ja ⌘S, kun tallennuspainiketta ei ole): tallenna odottava heti. */
  onKenttaPoistui?: (() => void) | undefined;
  /** "… ja uusi" nollasi lomakkeen: nollattu tila ennen sen renderöintiä. */
  onNollattu?: ((tila: TositeEditoriTila) => void) | undefined;
  /** Tiliote-tyypillä: lue tiliotteen tiedot tositteen liitteestä (tiedot tai virheteksti). */
  onLueTiliote?: (() => Promise<TilioteTiedot | string>) | undefined;
  /** Tallennuspainikkeen teksti; "ja uusi" -painike saa saman alun (esim. "Kirjaa ja uusi"). */
  tallennaTeksti?: string;
  /** "… ja uusi" -vahvistuksen alku (esim. "Kirjattu: Meno 1"). */
  vahvistus?: string;
}) {
  const { tila, dispatch, summat } = useTositeEditori(chart, initial ?? { paiva: alkupaiva });
  // Tila raportoidaan layout-efektissä: kentän blur-vahvistus ehtii ennen onKenttaPoistuin ajastinta.
  const onMuutosRef = useRef(onMuutos);
  onMuutosRef.current = onMuutos;
  useLayoutEffect(() => {
    onMuutosRef.current?.(tila);
  }, [tila]);
  // Ulkoinen täyttö: laske ajetaan täyttöhetken tilalla. Ilmoitus näkyy, kunnes tila muuttuu.
  const tilaNyt = useRef(tila);
  tilaNyt.current = tila;
  const [taytetty, setTaytetty] = useState<{
    ennen: TositeEditoriTila;
    jalkeen: TositeEditoriTila;
    kuvaus: string;
    lahde: string;
  } | null>(null);
  // Oletuspäivä seuraa pohjaa: "Tallenna ja uusi" säilyttää päivän, ja siitä tulee uusi oletus.
  const oletusPaiva = useRef(initial?.paiva ?? alkupaiva);
  const ruudukko = useRef<HTMLDivElement>(null);
  /**
   * Kirjoittaako käyttäjä riviin parhaillaan? Summa- ja tilisolu vahvistavat arvonsa vasta
   * poistuttaessa (tai Enterillä), joten tila voi vielä näyttää tyhjältä. Tyhjillä riveillä
   * mikä tahansa teksti fokusoidussa solussa on vahvistamatonta syötettä. Pelkkä fokus ei
   * riitä: "Tallenna ja uusi" fokusoi tyhjän ensimmäisen tilisolun, ja kuitti pudotetaan
   * usein juuri silloin.
   */
  function rivitKaytossa(): boolean {
    const el = document.activeElement;
    return (
      el instanceof HTMLInputElement &&
      ruudukko.current?.contains(el) === true &&
      el.value.trim() !== ''
    );
  }
  const tayttoAvain = taytto?.avain;
  // biome-ignore lint/correctness/useExhaustiveDependencies: vain uusi avain käynnistää täytön; laske-funktion identiteetti vaihtuu joka renderöinnillä
  useEffect(() => {
    if (!taytto) return;
    const nykyinen = tilaNyt.current;
    const tulos = taytto.laske(nykyinen, oletusPaiva.current, rivitKaytossa());
    if (!tulos) return;
    // Uudet rivit perivät vanhojen avaimet järjestyksessä: fokusoitu solu pysyy paikallaan.
    const jalkeen =
      tulos.tila.rows === nykyinen.rows
        ? tulos.tila
        : {
            ...tulos.tila,
            rows: tulos.tila.rows.map((r, i) => {
              const vanha = nykyinen.rows[i];
              return vanha ? { ...r, avain: vanha.avain } : r;
            }),
          };
    setTaytetty({
      ennen: nykyinen,
      jalkeen,
      kuvaus: tulos.kuvaus,
      lahde: tulos.lahde ?? 'kuitista',
    });
    korvaaUlkoa(jalkeen);
  }, [tayttoAvain]);
  const naytaTaytto = taytetty !== null && taytetty.jalkeen === tila;
  const fokus = useGridFocus();
  /** Viimeksi "Tallenna ja uusi" -toiminnolla tallennettu tosite (vahvistusviesti). */
  const [tallennettu, setTallennettu] = useState<TallennusTulos | null>(null);

  // Cheap block cases the UI can know without the engine (imbalance / amount-without-account).
  const tiliPuuttuu = tila.rows.some(
    (r) => (r.debetSnt !== 0 || r.kreditSnt !== 0) && r.tili === undefined,
  );
  const estetty = !summat.tasmaa || tiliPuuttuu;
  // Tyhjä lomake ei "täsmää" vielä mitään: neutraali palkki, kunnes ensimmäinen summa syötetään.
  const palkinTila: TasmaaTila =
    summat.debetYht === 0 && summat.kreditYht === 0 ? 'tyhja' : summat.tasmaa ? 'ok' : 'block';
  // Kirjanpidon viennit (alv-erittelyineen) yhteenvetoon; keskeneräinen lomake = ei yhteenvetoa.
  const viennit = useMemo(() => {
    try {
      return johdaViennit(tila.rows, chart, tila.paiva);
    } catch {
      return [];
    }
  }, [tila.rows, chart, tila.paiva]);

  // After a row is APPENDED (Enter → addBalancingRow / addRow), focus the new last row's
  // Tili cell. Done in an effect because the new input's ref isn't registered until commit.
  // `nollausPyydetty` forces a focus to row 1's Tili after a save-and-new reset (the row
  // count shrinks to 1, so the "appended" branch wouldn't fire).
  // Ulkoa korvatut rivit (täyttö tai Kumoa) eivät ole käyttäjän lisäämiä: fokus ei siirry.
  const edellinenMaara = useRef(tila.rows.length);
  const nollausPyydetty = useRef(false);
  const ulkoaKorvatut = useRef<TositeEditoriTila['rows'] | null>(null);
  useEffect(() => {
    const ensimmainen = tila.rows[0];
    if (nollausPyydetty.current && ensimmainen) {
      fokus.pyyda(ensimmainen.avain, 'tili');
      nollausPyydetty.current = false;
    } else if (tila.rows !== ulkoaKorvatut.current && tila.rows.length > edellinenMaara.current) {
      const viim = tila.rows.at(-1);
      if (viim) fokus.pyyda(viim.avain, 'tili');
    }
    edellinenMaara.current = tila.rows.length;
  }, [tila.rows, fokus]);

  /**
   * Fokusvahti ulkoisen korvauksen jälkeen. cmdk (TiliValitsin) siirtää fokuksen omaan
   * kenttäänsä, kun sen haku muuttuu ja fokus on missä tahansa cmdk-kentässä: täytön
   * lisäämä tai muuttama tilirivi veisi fokuksen käyttäjän tilisolusta ja avaisi listansa.
   * Vahti palauttaa fokuksen käyttäjän kenttään, kunnes käyttäjä itse painaa näppäintä tai
   * osoitinta. Vain ruudukon sisäiset siirrot perutaan.
   */
  const fokusVahti = useRef<HTMLElement | null>(null);
  useEffect(() => {
    function palauta(e: FocusEvent) {
      const kohde = fokusVahti.current;
      if (!kohde || e.target === kohde) return;
      if (!kohde.isConnected) {
        fokusVahti.current = null;
        return;
      }
      if (e.target instanceof Node && ruudukko.current?.contains(e.target)) kohde.focus();
    }
    function pura() {
      fokusVahti.current = null;
    }
    document.addEventListener('focusin', palauta);
    document.addEventListener('keydown', pura, true);
    document.addEventListener('pointerdown', pura, true);
    document.addEventListener('mousedown', pura, true);
    return () => {
      document.removeEventListener('focusin', palauta);
      document.removeEventListener('keydown', pura, true);
      document.removeEventListener('pointerdown', pura, true);
      document.removeEventListener('mousedown', pura, true);
    };
  }, []);

  /** Ulkoa tuleva korvaus (täyttö tai Kumoa) ei ole käyttäjän rivin lisäys: fokus ei siirry. */
  function korvaaUlkoa(uusi: TositeEditoriTila) {
    ulkoaKorvatut.current = uusi.rows;
    const fokusoitu = document.activeElement;
    fokusVahti.current =
      fokusoitu instanceof HTMLElement && fokusoitu !== document.body ? fokusoitu : null;
    dispatch({ type: 'korvaa', tila: uusi });
  }

  async function teeTallenna(jaUusi: boolean) {
    if (!onTallenna) return; // save not wired yet (Phase O)
    const stored = await onTallenna(tila);
    if (!stored) return; // error already surfaced
    setTaytetty(null); // kuitti-ilmoitus on tallennuksen jälkeen turha
    if (jaUusi) {
      nollausPyydetty.current = true; // focus first Tili once the reset row mounts
      setTallennettu(stored);
      const nollattu = reducer(tila, { type: 'reset' });
      oletusPaiva.current = nollattu.paiva;
      onNollattu?.(nollattu);
      dispatch({ type: 'korvaa', tila: nollattu });
    } else {
      onTallennettu?.(stored.id);
    }
  }

  function onFormKeyDown(e: React.KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!onTallenna) onKenttaPoistui?.();
      else if (!estetty) void teeTallenna(false);
    } else if (meta && e.key === 'Enter') {
      e.preventDefault();
      if (onTallenna && !estetty) void teeTallenna(tallennaJaUusi);
    }
  }

  return (
    <>
      <TopBar
        otsikko={otsikko}
        alaotsikko={alaotsikko}
        toiminnot={
          <>
            {lisatoiminnot}
            {onTallenna && tallennaJaUusi ? (
              <Button
                variant="sec"
                type="button"
                disabled={estetty}
                onClick={() => void teeTallenna(true)}
              >
                {tallennaTeksti} ja uusi
              </Button>
            ) : null}
            {onTallenna ? (
              <Button type="submit" form="tosite-lomake" disabled={estetty}>
                {tallennaTeksti}
              </Button>
            ) : null}
          </>
        }
      />
      {/* Ilman sivupaneelia kääre on display: contents, eli asettelu on ennallaan. */}
      <div className={sivupaneeli ? JAETTU_ASETTELU : 'contents'}>
        <form
          id="tosite-lomake"
          aria-label={lomakkeenNimi}
          onKeyDown={onFormKeyDown}
          onBlur={() => onKenttaPoistui?.()}
          onSubmit={(e) => {
            e.preventDefault();
            if (onTallenna && !estetty) void teeTallenna(false);
          }}
          className={cn(
            'flex flex-col gap-4 px-[22px] py-5',
            sivupaneeli ? JAETTU_PAA : 'flex-1 overflow-auto',
          )}
        >
          {ilmoitukset}
          {naytaTaytto ? (
            <output className="flex items-center gap-3 text-[12.5px]">
              <span>
                Täytetty {taytetty.lahde} ({taytetty.kuvaus}) — tarkista ennen tallennusta.
              </span>
              <Button
                variant="sec"
                size="compact"
                type="button"
                onClick={() => {
                  korvaaUlkoa(taytetty.ennen);
                  setTaytetty(null);
                }}
              >
                Kumoa
              </Button>
            </output>
          ) : null}
          {/* Rivittyy, kun lomake on kapea (esim. kuitin esikatselu vieressä). */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex w-[160px] flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
              Päivä
              <input
                type="date"
                aria-label="Päivä"
                value={tila.paiva}
                onChange={(e) => dispatch({ type: 'setPaiva', pvm: e.target.value })}
                className="rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] tabular-nums"
              />
            </label>
            <SegmentedControl
              nimi="Tyyppi"
              vaihtoehdot={TYYPPIVAIHTOEHDOT}
              arvo={tila.tyyppi}
              onMuutos={(t) => dispatch({ type: 'setTyyppi', tyyppi: t })}
            />
            <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
              Selite
              <input
                type="text"
                aria-label="Selite"
                value={tila.selite}
                onChange={(e) => dispatch({ type: 'setSelite', selite: e.target.value })}
                className="rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]"
              />
            </label>
          </div>

          {tila.tyyppi === TositeTyyppi.TILIOTE ? (
            <TiliotePaneeli
              tiliote={tila.tiliote}
              chart={chart}
              pankkitili={pankkitili}
              onMuutos={(tiliote) => dispatch({ type: 'setTiliote', tiliote })}
              onLue={onLueTiliote}
            />
          ) : null}

          {tallennettu ? (
            <p aria-live="polite" className="text-[12.5px] text-[var(--positive)]">
              {vahvistus}:{' '}
              {tallennettuLinkki
                ? tallennettuLinkki(tallennettu, tositteenNimi(tallennettu))
                : tositteenNimi(tallennettu)}
            </p>
          ) : null}

          <div ref={ruudukko}>
            <VientiGrid
              rows={tila.rows}
              chart={chart}
              pvm={tila.paiva}
              dispatch={dispatch}
              fokus={fokus}
              onkoAlvVelvollinen={onkoAlvVelvollinen}
              tyyppi={tila.tyyppi}
              pankkitili={pankkitili}
            />
          </div>

          {virheviesti ? (
            <p role="alert" className="text-[12.5px] text-[var(--danger)]">
              {virheviesti}
            </p>
          ) : null}

          <KirjausYhteenveto viennit={viennit} chart={chart} />

          <TasmaaPalkki tila={palkinTila} erotus={summat.erotus} />
        </form>
        {sivupaneeli}
      </div>
    </>
  );
}
