import { useKpClient } from '@/app/KpClientProvider';
import { useInit, useKohdennukset, usePaivitaAsetukset } from '@/app/kysely';
import { Pudotusalue } from '@/components/Pudotusalue';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { TiliValitsin } from '@/editori/TiliValitsin';
import type { LadattavaLiite } from '@/liitteet/LiitteidenLataus';
import {
  CSV_SARAKKEET_ASETUS,
  type CsvEsikatselu,
  type CsvSarakkeet as CsvSarakejako,
  type Kuittilahde,
  type TyolistaTila as Tila,
  type Tili,
  type TiliotetiedostonValinnat,
  type TiliotteenLahde,
  type TyolistaRivi,
  asetaTiliSamannimisille,
  csvSarakkeetAsetukseksi,
  haeCsvSarakkeet,
  irrotaKuitti,
  kuittiEhdokkaat,
  lataaKartta,
  liitaKuitti,
  lisaaMenotiliSaanto,
  lueTasmaysSaannot,
  muodostaTyolista,
  paivitaRivi,
  samannimiset,
  siirraPaivia,
  tasmayksenPankkitili,
  tasmaysSaannotAsetuksiksi,
  tyolistanTositeAsetukset,
} from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';
import type { LukuEdistyminen, TasmaysAineisto, TilioteEsikatselu } from '@penni/luku';
import { useMemo, useRef, useState } from 'react';
import { CsvSarakkeet } from './CsvSarakkeet.js';
import { KasinKirjaus } from './KasinKirjaus.js';
import { type OmaLiite, RiviPaneeli } from './RiviPaneeli.js';
import { TiliotteenTallennus } from './TiliotteenTallennus.js';
import { siivoaIpcVirhe } from './ipcVirhe.js';
import { RYHMAT } from './ryhmat.js';
import { annaTasmaysSilta, onkoTasmaysSilta } from './silta.js';
import { type KirjausTulos, useKirjaaRivit } from './useKirjaaRivit.js';

const VAIHEEN_NIMI: Record<LukuEdistyminen['vaihe'], string> = {
  tiliote: 'Tiliote',
  kuitit: 'Kuitit',
};

/** Tiliotetiedoston muoto yhteenvetorivillä. */
const LAHTEEN_NIMI: Record<TiliotteenLahde, string> = {
  pdf: 'PDF',
  camt053: 'camt.053',
  camt054: 'camt.054',
  tito: 'TITO',
  csv: 'CSV',
};

/** Viimeksi luetun CSV:n esikatselu ja sillä käytetty sarakejako. */
interface LuettuCsv {
  esikatselu: CsvEsikatselu;
  sarakkeet: CsvSarakejako;
}

/** Sillan heittämä virhe näytettäväksi ilman Electronin IPC-etuliitettä. */
function virheteksti(e: unknown): string {
  return siivoaIpcVirhe(e instanceof Error ? e.message : String(e));
}

/** Ryhmät joita ei voi piilottaa: nimitäsmäys ja puuttuva kuitti vaativat aina huomion. */
const AINA_AUKI: ReadonlySet<Tila> = new Set(['nimitasmays', 'kuittiPuuttuu']);

const RYHMAN_OTSIKKO_LUOKKA =
  'text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--text-subtle)]';

/** Kopio ilman annettuja avaimia (kirjatun rivin omat liitteet pois muistista). */
function poistaAvaimet<T>(
  kartta: Record<string, T>,
  avaimet: readonly string[],
): Record<string, T> {
  const uusi = { ...kartta };
  for (const a of avaimet) delete uusi[a];
  return uusi;
}

/** Tiedoston perusnimi polusta näyttöä varten. */
function perusnimi(polku: string): string {
  return polku.split('/').pop() || polku;
}

/**
 * Vain luettava lisätietoryhmä: kuitit joille ei löytynyt pankkitapahtumaa (näin puuttuva
 * tiliotesivu paljastuu) ja kuitit jotka jäivät kokonaan lukematta. Ei valintaa eikä
 * kirjausta — nämä eivät ole työlistan rivejä vaan kertovat aineiston aukoista. Tyhjä
 * ryhmä jätetään renderöimättä, ettei työlistan alle jää kohinaa.
 */
function TietoRyhma({
  otsikko,
  rivit,
}: {
  otsikko: string;
  rivit: readonly string[];
}): React.ReactElement | null {
  const [auki, setAuki] = useState(false);
  if (rivit.length === 0) return null;
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <h3 className={RYHMAN_OTSIKKO_LUOKKA}>
          {otsikko} ({rivit.length})
        </h3>
        <button
          type="button"
          onClick={() => setAuki((edellinen) => !edellinen)}
          className="text-[11px] text-[var(--accent)] underline"
        >
          {auki ? 'Piilota' : 'Näytä'}
        </button>
      </div>
      {auki && (
        <ul className="flex flex-col gap-[2px]">
          {rivit.map((teksti) => (
            <li key={teksti} className="px-2 text-[12.5px] text-[var(--text-muted)]">
              {teksti}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Tyhjän sivun käyttöohje: tiliote ja kuittikansio yhdistetään tapahtumiksi, jotka
 * tarkistetaan ja kirjataan kerralla. Näytetään kunnes työlistalla on rivejä.
 */
function Ohje(): React.ReactElement {
  const vaiheet: [string, string][] = [
    [
      'Valitse tiliote',
      'Pankin tiliote PDF:nä, camt-XML:nä, TITO-tiedostona tai CSV:nä. Jokaisesta tilitapahtumasta tulee työlistalle rivi.',
    ],
    [
      'Valitse kuittikansio',
      'Valinnainen. Penni lukee kansion kuitit ja yhdistää ne tapahtumiin summan, päivän ja myyjän perusteella. Ilman kansiota rivit kirjataan kuitittomina.',
    ],
    [
      'Tarkista rivit',
      'Rivit ryhmitellään tilan mukaan. "Summa ei täsmää" ja "Kuitti puuttuu" vaativat huomiota: valitse rivi, niin voit vaihtaa tiliä, liittää kuitin tai lisätä tiedoston oikealla.',
    ],
    [
      'Kirjaa valitut',
      'Kirjaamattomat rivit on valittu valmiiksi; poista valinta niiltä, joita et halua vielä kirjata. Valitut kirjataan kerralla tositteiksi kuitteineen.',
    ],
  ];
  return (
    <div className="max-w-[560px]">
      <h3 className="mb-1 text-[14px] font-semibold">Tiliotteen tuonti</h3>
      <p className="mb-4 text-[13px] text-[var(--text-muted)]">
        Tuo kuukauden tiliote ja kuitit yhdellä kertaa: Penni yhdistää kuitit pankkitapahtumiin ja
        kirjaa ne tositteiksi erässä.
      </p>
      <ol className="flex flex-col gap-3">
        {vaiheet.map(([otsikko, teksti], i) => (
          <li key={otsikko} className="flex gap-3 text-[13px]">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[12px] font-semibold text-[var(--accent)]">
              {i + 1}
            </span>
            <span>
              <span className="font-medium">{otsikko}</span>
              <span className="block text-[var(--text-muted)]">{teksti}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Merkki({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={ok ? 'text-[var(--positive)]' : 'text-[var(--danger)]'}>
      {ok ? '✓' : '✗'} {children}
    </span>
  );
}

/**
 * Luetun tiliotteen yhteenveto: tiedostomuoto (CSV:lle tunnistettu pankki), kausi — tiedoston
 * ilmoittama tai tapahtumista päätelty — ja tapahtumien määrä, kuukausitiliotteelle lisäksi
 * alku- ja loppusaldo sekä kaksi täsmäytystä —
 * tapahtumien summa = loppusaldo − alkusaldo (poiminta on täydellinen) ja tiliotteen
 * alkusaldo = kirjanpidon pankkitilin saldo kautta edeltävänä päivänä (edelliset kaudet
 * on kirjattu). Tapahtumat-viennillä ei ole saldoja, jolloin näytetään vain kausi.
 */
function TilioteYhteenveto({
  tiliote,
  kirjanpidonAlkusaldo,
  pankki,
  onVaihdaSarakkeet,
}: {
  tiliote: TasmaysAineisto['tiliote'];
  kirjanpidonAlkusaldo: Cents | undefined;
  /** CSV:n tunnistettu pankki. */
  pankki?: string | undefined;
  /** CSV:lle: avaa sarakejaon uudelleen. */
  onVaihdaSarakkeet?: (() => void) | undefined;
}): React.ReactElement | null {
  const { kausi, alkusaldo, loppusaldo, tapahtumat, lahde } = tiliote;
  if (!kausi && alkusaldo === undefined && !lahde) return null;
  const summa = tapahtumat.reduce((s, t) => s + t.maara, 0);
  const kuvaus = [
    lahde && LAHTEEN_NIMI[lahde],
    lahde === 'csv' && pankki,
    kausi &&
      `${tiliote.kausiPaatelty ? 'Tapahtumat' : 'Kausi'} ${muotoilePvm(kausi.alkaa)}–${muotoilePvm(kausi.loppuu)}`,
    `${tapahtumat.length} tapahtumaa`,
  ].filter(Boolean);
  return (
    <section
      aria-label="tiliotteen saldot"
      className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-[var(--border)] px-[22px] py-2 text-[12.5px]"
    >
      <span className="text-[var(--text-muted)]">{kuvaus.join(' · ')}</span>
      {onVaihdaSarakkeet && (
        <button
          type="button"
          onClick={onVaihdaSarakkeet}
          className="text-[11px] text-[var(--accent)] underline"
        >
          Vaihda sarakkeet
        </button>
      )}
      {alkusaldo !== undefined && loppusaldo !== undefined && (
        <>
          <span className="tabular-nums">
            Alkusaldo {muotoileEuro(alkusaldo)} · Loppusaldo {muotoileEuro(loppusaldo)}
          </span>
          <Merkki ok={summa === loppusaldo - alkusaldo}>
            {summa === loppusaldo - alkusaldo
              ? 'tapahtumat täsmäävät saldoihin'
              : `tapahtumat eivät täsmää saldoihin (erotus ${muotoileEuro((loppusaldo - alkusaldo - summa) as Cents)})`}
          </Merkki>
          {kausi && kirjanpidonAlkusaldo !== undefined && (
            <Merkki ok={kirjanpidonAlkusaldo === alkusaldo}>
              {kirjanpidonAlkusaldo === alkusaldo
                ? `kirjanpidon saldo ${muotoilePvm(siirraPaivia(kausi.alkaa, -1))} täsmää`
                : `kirjanpidon saldo ${muotoilePvm(siirraPaivia(kausi.alkaa, -1))} ${muotoileEuro(kirjanpidonAlkusaldo)} (erotus ${muotoileEuro((alkusaldo - kirjanpidonAlkusaldo) as Cents)})`}
            </Merkki>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Julkinen näkymä: pelkkä työpöytäsillan tarkistus, ei yhtään hookia. `TasmaysSisalto`
 * (kaikki hookit — useKpClient, useInit, useState, ...) mountataan vain kun silta on
 * olemassa, joten selaimessa (ei sisältöä) mikään hook ei koskaan yritä lukea puuttuvaa
 * KpClientProvider/QueryClientProvider-kontekstia. Ehto ei myöskään riko Hooks-sääntöä,
 * koska TasmaysNakyma itse ei kutsu yhtään hookia kummallakaan polulla.
 */
export function TasmaysNakyma(): React.ReactElement {
  if (!onkoTasmaysSilta()) {
    return <p>Tiliotteen tuonti on käytettävissä vain työpöytäsovelluksessa.</p>;
  }
  return <TasmaysSisalto />;
}

function TasmaysSisalto(): React.ReactElement {
  const client = useKpClient();
  const { data: init } = useInit();
  // Meno- ja tulorivit saavat tilinsä oletuskohdennuksen (TositeAsetukset.kohdennukset).
  const { data: kohdennukset } = useKohdennukset();
  const paivitaAsetukset = usePaivitaAsetukset();
  const { kirjaa, kaynnissa } = useKirjaaRivit();

  const [tiliotePolku, setTiliotePolku] = useState<string | null>(null);
  const [kuittikansioPolku, setKuittikansioPolku] = useState<string | null>(null);
  const [pankkitiliValittu, setPankkitiliValittu] = useState<number | undefined>(undefined);
  const [aineisto, setAineisto] = useState<TasmaysAineisto | null>(null);
  const [rivit, setRivit] = useState<TyolistaRivi[]>([]);
  const [kuititIlmanTapahtumaa, setKuititIlmanTapahtumaa] = useState<Kuittilahde[]>([]);
  const [valittuAvain, setValittuAvain] = useState<string | null>(null);
  const [edistyminen, setEdistyminen] = useState<LukuEdistyminen | null>(null);
  const [virhe, setVirhe] = useState<string | null>(null);
  const [tulokset, setTulokset] = useState<KirjausTulos[]>([]);
  const [avoimet, setAvoimet] = useState<ReadonlySet<Tila>>(new Set());
  const [lukemassa, setLukemassa] = useState(false);
  const [kirjanpidonAlkusaldo, setKirjanpidonAlkusaldo] = useState<Cents | undefined>(undefined);
  /** Käyttäjän riveille lisäämät tiedostot rivin avaimella (tallennetaan kirjauksessa). */
  const [omatLiitteet, setOmatLiitteet] = useState<Record<string, OmaLiite[]>>({});
  const seuraavaLiiteId = useRef(1);
  /** Käsin editorissa kirjattava rivi; näkymä vaihtuu editoriin ja tila säilyy taustalla. */
  const [kasinAvain, setKasinAvain] = useState<string | null>(null);
  /** Luetun CSV:n sarakejako: kuittikansion uudelleenluku ja "Vaihda sarakkeet" käyttävät sitä. */
  const [luettuCsv, setLuettuCsv] = useState<LuettuCsv | null>(null);
  /** Avoin sarakejako: tiedosto odottaa, että käyttäjä vahvistaa sarakkeiden roolit. */
  const [sarakejako, setSarakejako] = useState<{
    polku: string;
    esikatselu: CsvEsikatselu;
    alku: CsvSarakejako;
  } | null>(null);
  /**
   * Vanhentuneen tuloksen vartijat: `valintaNro` kasvaa jokaisesta tiedoston valinnasta,
   * `lukuNro` jokaisesta luvusta. Hitaan aiemman esikatselun tai luvun tulos hylätään, jos
   * uudempi on jo alkanut — muuten väärän tiliotteen rivit päätyisivät oikean nimen alle.
   */
  const valintaNro = useRef(0);
  const lukuNro = useRef(0);

  const chart = useMemo<Tili[]>(() => (init ? lataaKartta(init.tilit) : []), [init]);
  const saannot = useMemo(
    () =>
      init
        ? lueTasmaysSaannot(init.asetukset)
        : {
            menotiliSaannot: [],
            vendorAliakset: [],
            omistajanNimet: [],
            omistajanNimetTallennettu: false,
          },
    [init],
  );
  const pankkitiliOletus = useMemo(
    () => (init ? tasmayksenPankkitili(init.asetukset, chart) : undefined),
    [init, chart],
  );
  const pankkitili = pankkitiliValittu ?? pankkitiliOletus;

  const ryhmitellyt = useMemo(() => {
    const kartta = new Map<Tila, TyolistaRivi[]>();
    for (const ryhma of RYHMAT) kartta.set(ryhma.tila, []);
    for (const rivi of rivit) kartta.get(rivi.tila)?.push(rivi);
    for (const lista of kartta.values()) {
      lista.sort((a, b) =>
        a.tapahtuma.pvm < b.tapahtuma.pvm ? -1 : a.tapahtuma.pvm > b.tapahtuma.pvm ? 1 : 0,
      );
    }
    return kartta;
  }, [rivit]);

  const valittuRivi = rivit.find((r) => r.avain === valittuAvain);

  /**
   * Rakentaa työlistan luetusta aineistosta moottorin `muodostaTyolista`-polulla (sama kuin
   * CLI:n `tiliote`-komennossa): jo kirjatut rivit (luonnokset mukaan lukien, jottei osittain
   * kirjattua erää ehdoteta kahteen kertaan), kirjaushistorian ehdotukset ja kuukausitiliotteen
   * alkusaldon vertailu kirjanpitoon.
   */
  async function paivitaTyolista(
    a: TasmaysAineisto,
    pankkitiliArvo: number | undefined,
    nro: number,
  ) {
    if (pankkitiliArvo === undefined) {
      setVirhe('Valitse pankkitili ennen täsmäytystä.');
      return;
    }
    const tulos = await muodostaTyolista(client, a.tiliote, a.kuitit, {
      pankkitili: pankkitiliArvo,
      chart,
      saannot,
    });
    if (nro !== lukuNro.current) return;
    setRivit(tulos.rivit);
    setKuititIlmanTapahtumaa(tulos.kuititIlmanTapahtumaa);
    setKirjanpidonAlkusaldo(tulos.kirjanpidonAlkusaldo);
  }

  /**
   * Lukee aineiston ja rakentaa työlistan. true vain, kun luku onnistui ja on yhä uusin;
   * vanhentunut luku ei koske tilaan lainkaan.
   */
  async function lueJaTasmaa(
    tiliotePolkuArvo: string,
    kuittikansioArvo: string | null,
    valinnat: TiliotetiedostonValinnat | undefined,
  ): Promise<boolean> {
    const nro = ++lukuNro.current;
    const ajantasainen = () => nro === lukuNro.current;
    setVirhe(null);
    setAineisto(null);
    setRivit([]);
    setKuititIlmanTapahtumaa([]);
    setKirjanpidonAlkusaldo(undefined);
    setTulokset([]);
    setValittuAvain(null);
    setOmatLiitteet({});
    setLukemassa(true);
    try {
      const luettu = await annaTasmaysSilta().lueAineisto(
        tiliotePolkuArvo,
        kuittikansioArvo,
        (e) => {
          if (ajantasainen()) setEdistyminen(e);
        },
        valinnat,
      );
      if (!ajantasainen()) return false;
      setAineisto(luettu);
      await paivitaTyolista(luettu, pankkitili, nro);
      return ajantasainen();
    } catch (e) {
      if (ajantasainen()) setVirhe(virheteksti(e));
      return false;
    } finally {
      if (ajantasainen()) {
        setEdistyminen(null);
        setLukemassa(false);
      }
    }
  }

  /**
   * Lukee valitun tiliotteen heti — kuittikansio on valinnainen, ja kansion valinta täsmää
   * uudelleen. CSV:n sarakejako muistetaan uudelleenlukua ja "Vaihda sarakkeet" -linkkiä varten.
   */
  async function lueTiliote(polku: string, csv?: LuettuCsv): Promise<boolean> {
    setTiliotePolku(polku);
    setLuettuCsv(csv ?? null);
    setSarakejako(null);
    return lueJaTasmaa(polku, kuittikansioPolku, csv ? { csvSarakkeet: csv.sarakkeet } : undefined);
  }

  /**
   * Valitun tiedoston esikatselu ratkaisee, miten se luetaan: CSV:lle kirjaan tallennettu
   * sarakejako, sitten tunnistetun pankin profiili, muuten käyttäjä valitsee sarakkeet.
   * Esikatselun virhe (väärä tiedosto) ei koske aiemmin luettuun työlistaan. `nro` on
   * valinnan järjestysnumero: uudemman valinnan jälkeen valmistuva esikatselu hylätään.
   */
  async function kasittelePolku(polku: string, nro = ++valintaNro.current) {
    setVirhe(null);
    let esikatselu: TilioteEsikatselu;
    try {
      esikatselu = await annaTasmaysSilta().esikatseleTiliote(polku);
    } catch (e) {
      if (nro === valintaNro.current) setVirhe(virheteksti(e));
      return;
    }
    if (nro !== valintaNro.current) return;
    const csv = esikatselu.csv;
    if (esikatselu.lahde !== 'csv' || !csv) {
      await lueTiliote(polku);
      return;
    }
    const tallennettu = init ? haeCsvSarakkeet(init.asetukset, csv.avain) : undefined;
    if (tallennettu) await lueTiliote(polku, { esikatselu: csv, sarakkeet: tallennettu });
    else if (csv.pankki) await lueTiliote(polku, { esikatselu: csv, sarakkeet: csv.ehdotus });
    else setSarakejako({ polku, esikatselu: csv, alku: csv.ehdotus });
  }

  /**
   * Vahvistettu sarakejako luetaan, ja vasta onnistunut luku muistetaan kirjaan otsikkorivin
   * mukaan: rivillä 30 kaatuva jako ei saa korvata toimivaa tallennettua jakoa.
   */
  async function vahvistaSarakkeet(sarakkeet: CsvSarakejako) {
    if (!sarakejako) return;
    const { polku, esikatselu } = sarakejako;
    const asetukset = init?.asetukset;
    const onnistui = await lueTiliote(polku, { esikatselu, sarakkeet });
    if (onnistui && asetukset)
      await paivitaAsetukset.tallenna({
        [CSV_SARAKKEET_ASETUS]: csvSarakkeetAsetukseksi(asetukset, esikatselu.avain, sarakkeet),
      });
  }

  /** Avaa sarakejaon uudelleen viimeksi luetulle (tai luettavaksi yritetylle) CSV:lle. */
  const avaaSarakejako =
    luettuCsv && tiliotePolku !== null
      ? () =>
          setSarakejako({
            polku: tiliotePolku,
            esikatselu: luettuCsv.esikatselu,
            alku: luettuCsv.sarakkeet,
          })
      : undefined;

  /** Kirjan asetukset (tallennetut sarakejaot) ja pankkitili tarvitaan ennen ensimmäistä lukua. */
  function kirjaLadattu(): boolean {
    if (init) return true;
    setVirhe('Kirjanpito latautuu vielä. Valitse tiliote hetken kuluttua uudelleen.');
    return false;
  }

  /** Vanhan työpöytäversion natiivi tiedostodialogi. */
  async function valitseTiliotePolku() {
    setVirhe(null);
    try {
      const polku = await annaTasmaysSilta().valitseTiliote();
      if (polku === null || !kirjaLadattu()) return;
      await kasittelePolku(polku);
    } catch (e) {
      setVirhe(virheteksti(e));
    }
  }

  /** Pudotettu tai valittu tiedosto: pääprosessi antaa sen polun (ja sallii sen lukemisen). */
  async function valitseTiliotetiedosto(tiedostot: readonly File[]) {
    const [tiedosto] = tiedostot;
    const silta = annaTasmaysSilta();
    if (!tiedosto || !silta.tiliotePolku || !kirjaLadattu()) return;
    setVirhe(null);
    const nro = ++valintaNro.current;
    try {
      const polku = await silta.tiliotePolku(tiedosto);
      if (nro === valintaNro.current) await kasittelePolku(polku, nro);
    } catch (e) {
      if (nro === valintaNro.current) setVirhe(virheteksti(e));
    }
  }

  async function valitseKuittikansioPolku() {
    setVirhe(null);
    try {
      const polku = await annaTasmaysSilta().valitseKuittikansio();
      if (polku === null) return;
      setKuittikansioPolku(polku);
      // Avoin sarakejako lukee tiedoston vahvistettaessa, jolloin kansio on jo mukana.
      if (tiliotePolku !== null && !sarakejako)
        await lueJaTasmaa(
          tiliotePolku,
          polku,
          luettuCsv ? { csvSarakkeet: luettuCsv.sarakkeet } : undefined,
        );
    } catch (e) {
      setVirhe(virheteksti(e));
    }
  }

  function valitsePankkitili(numero: number) {
    setPankkitiliValittu(numero);
    if (aineisto) void paivitaTyolista(aineisto, numero, lukuNro.current);
  }

  function togglaaRyhma(tila: Tila) {
    setAvoimet((edelliset) => {
      const uudet = new Set(edelliset);
      if (uudet.has(tila)) uudet.delete(tila);
      else uudet.add(tila);
      return uudet;
    });
  }

  /**
   * Tallentaa myyjäkohtaisen menotilisäännön. Palauttaa onnistumisen paneelille, joka peruu
   * valintaruudun jos tallennus kaatui — hookin `virheviesti` näytetään lisäksi ylhäällä,
   * ettei käyttäjä jää luulemaan sääntöä tallennetuksi.
   */
  async function tallennaSaanto(hae: string, tili: number): Promise<boolean> {
    return paivitaAsetukset.tallenna(
      tasmaysSaannotAsetuksiksi(lisaaMenotiliSaanto(saannot, hae, tili)),
    );
  }

  async function kirjaaValitut() {
    const valitut = rivit.filter((r) => r.valittu);
    if (valitut.length === 0) return;
    const tositeAsetukset = {
      ...tyolistanTositeAsetukset(pankkitili, saannot),
      ...(kohdennukset ? { kohdennukset } : {}),
    };
    const tulos = await kirjaa(valitut, chart, tositeAsetukset, omatLiitteet);
    setTulokset(tulos);
    let uudet = rivit;
    for (const t of tulos) {
      if (t.ok) uudet = paivitaRivi(uudet, t.avain, { tila: 'joKirjattu', valittu: false });
    }
    setRivit(uudet);
    setOmatLiitteet((omat) =>
      poistaAvaimet(
        omat,
        tulos.filter((t) => t.ok).map((t) => t.avain),
      ),
    );
  }

  /** Liittää tapahtumaan liittämättömän kuitin riville (kuitti siirtyy pois liittämättömistä). */
  function liitaRivilleKuitti(avain: string, tiedosto: string) {
    const tulos = liitaKuitti(rivit, kuititIlmanTapahtumaa, avain, tiedosto);
    setRivit(tulos.rivit);
    setKuititIlmanTapahtumaa(tulos.kuitit);
  }

  /** Irrottaa rivin kuitin; omien tiedostojen kanssa rivi pysyy valmiina. */
  function irrotaRiviltaKuitti(avain: string) {
    const tulos = irrotaKuitti(rivit, kuititIlmanTapahtumaa, avain);
    setRivit(
      (omatLiitteet[avain]?.length ?? 0) > 0
        ? paivitaRivi(tulos.rivit, avain, { tila: 'valmis' })
        : tulos.rivit,
    );
    setKuititIlmanTapahtumaa(tulos.kuitit);
  }

  /** Koneelta lisätty tiedosto korvaa puuttuvan kuitin: rivi siirtyy valmiiksi. */
  async function lisaaOmaLiite(avain: string, liite: LadattavaLiite) {
    const id = seuraavaLiiteId.current++;
    setOmatLiitteet((omat) => ({ ...omat, [avain]: [...(omat[avain] ?? []), { ...liite, id }] }));
    setRivit((nyt) =>
      paivitaRivi(
        nyt,
        avain,
        nyt.find((r) => r.avain === avain)?.tila === 'kuittiPuuttuu'
          ? { tila: 'valmis', valittu: true }
          : {},
      ),
    );
  }

  /** Viimeisen oman tiedoston poisto palauttaa kuitittoman rivin "kuitti puuttuu" -tilaan. */
  function poistaOmaLiite(avain: string, id: number) {
    const jaljella = (omatLiitteet[avain] ?? []).filter((l) => l.id !== id);
    setOmatLiitteet((omat) => ({ ...omat, [avain]: jaljella }));
    const rivi = rivit.find((r) => r.avain === avain);
    if (jaljella.length === 0 && rivi && !rivi.kuitti && rivi.tila === 'valmis')
      setRivit(paivitaRivi(rivit, avain, { tila: 'kuittiPuuttuu' }));
  }

  const valitutMaara = rivit.filter((r) => r.valittu).length;
  const kasinRivi = rivit.find((r) => r.avain === kasinAvain);

  if (kasinRivi)
    return (
      <KasinKirjaus
        rivi={kasinRivi}
        chart={chart}
        asetukset={{
          ...tyolistanTositeAsetukset(pankkitili, saannot),
          ...(kohdennukset ? { kohdennukset } : {}),
        }}
        pankkitili={pankkitili}
        omatLiitteet={omatLiitteet[kasinRivi.avain] ?? []}
        onTakaisin={() => setKasinAvain(null)}
        onKirjattu={(tallennettu, varoitus) => {
          setRivit((nyt) =>
            paivitaRivi(nyt, kasinRivi.avain, { tila: 'joKirjattu', valittu: false }),
          );
          setOmatLiitteet((omat) => poistaAvaimet(omat, [kasinRivi.avain]));
          setTulokset((nyt) => [
            ...nyt.filter((t) => t.avain !== kasinRivi.avain),
            {
              avain: kasinRivi.avain,
              ok: true,
              tositeId: tallennettu.id,
              ...(varoitus ? { varoitus } : {}),
            },
          ]);
          setKasinAvain(null);
        }}
      />
    );

  return (
    <>
      <TopBar otsikko="Tuo tiliote" alaotsikko={init?.asetukset.Nimi} />
      <section aria-label="tasmays-sivu" className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-[22px] py-4">
          {typeof annaTasmaysSilta().tiliotePolku === 'function' ? (
            <Pudotusalue
              otsikko="Tiliote"
              ohje="PDF, camt.053/054 (XML), TITO tai CSV. Pudota tiedosto tähän tai valitse."
              monta={false}
              onValitse={(tiedostot) => void valitseTiliotetiedosto(tiedostot)}
              className="max-w-[340px]"
            />
          ) : (
            <Button variant="sec" type="button" onClick={() => void valitseTiliotePolku()}>
              Valitse tiliote
            </Button>
          )}
          <span className="text-[12px] text-[var(--text-subtle)]">
            {tiliotePolku ?? 'Ei tiliotetta valittu'}
          </span>
          <Button variant="sec" type="button" onClick={() => void valitseKuittikansioPolku()}>
            Valitse kuittikansio
          </Button>
          <span className="text-[12px] text-[var(--text-subtle)]">
            {kuittikansioPolku ?? 'Ei kuittikansiota valittu'}
          </span>
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            Pankkitili
            <TiliValitsin
              tilit={chart}
              arvo={pankkitili}
              ariaLabel="Pankkitili"
              onValitse={valitsePankkitili}
            />
          </div>
          {edistyminen && (
            <output className="text-[12px] text-[var(--text-subtle)]">
              {VAIHEEN_NIMI[edistyminen.vaihe]}: {edistyminen.valmiina} / {edistyminen.yhteensa}
            </output>
          )}
          {lukemassa && !edistyminen && (
            <output className="text-[12px] text-[var(--text-subtle)]">Luetaan…</output>
          )}
        </div>

        {(virhe ?? paivitaAsetukset.virheviesti) && (
          <div className="flex items-baseline gap-3 px-[22px] py-2">
            <p role="alert" className="text-[12.5px] text-[var(--danger)]">
              {virhe ?? paivitaAsetukset.virheviesti}
            </p>
            {/* Kaatunut CSV-luku: ilman aineistoa yhteenvedon linkkiä ei ole, joten sarakejaon
                korjaus tarjotaan virheen vierestä. */}
            {virhe && !aineisto && !sarakejako && !lukemassa && avaaSarakejako && (
              <button
                type="button"
                onClick={avaaSarakejako}
                className="text-[11px] text-[var(--accent)] underline"
              >
                Vaihda sarakkeet
              </button>
            )}
          </div>
        )}

        {aineisto && !sarakejako && (
          <TilioteYhteenveto
            tiliote={aineisto.tiliote}
            kirjanpidonAlkusaldo={kirjanpidonAlkusaldo}
            pankki={luettuCsv?.esikatselu.pankki}
            onVaihdaSarakkeet={avaaSarakejako}
          />
        )}
        {/* Vain tiedoston ilmoittama kausi: tapahtumista päätelty kausi (CSV, camt.054) ei
            saa tehdä Tiliote-tositetta, joka myöhemmin peittäisi oikean kuukausitiliotteen. */}
        {aineisto?.tiliote.kausi &&
          !aineisto.tiliote.kausiPaatelty &&
          !sarakejako &&
          pankkitili !== undefined && (
            <TiliotteenTallennus tiliote={aineisto.tiliote} pankkitili={pankkitili} />
          )}

        {rivit.length > 0 && !sarakejako && (
          <div className="flex flex-wrap gap-[6px] px-[22px] py-2">
            {RYHMAT.map((r) => (
              <span
                key={r.tila}
                className="rounded-full bg-[var(--track)] px-2 py-[2px] text-[11px] text-[var(--text-muted)]"
              >
                {r.otsikko}: {(ryhmitellyt.get(r.tila) ?? []).length}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          <section aria-label="työlista" className="flex-1 overflow-auto px-[22px] py-4">
            {sarakejako && (
              <CsvSarakkeet
                key={sarakejako.polku}
                esikatselu={sarakejako.esikatselu}
                alku={sarakejako.alku}
                onVahvista={(s) => void vahvistaSarakkeet(s)}
                onPeru={() => setSarakejako(null)}
              />
            )}
            {!sarakejako && rivit.length === 0 && !lukemassa && <Ohje />}
            {!sarakejako &&
              rivit.length > 0 &&
              RYHMAT.map((ryhma) => {
                const ryhmanRivit = ryhmitellyt.get(ryhma.tila) ?? [];
                const pakkoAuki = AINA_AUKI.has(ryhma.tila);
                const auki = pakkoAuki || avoimet.has(ryhma.tila);
                return (
                  <div key={ryhma.tila} className="mb-5">
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className={RYHMAN_OTSIKKO_LUOKKA}>
                        {ryhma.otsikko} ({ryhmanRivit.length})
                      </h3>
                      {!pakkoAuki && ryhmanRivit.length > 0 && (
                        <button
                          type="button"
                          onClick={() => togglaaRyhma(ryhma.tila)}
                          className="text-[11px] text-[var(--accent)] underline"
                        >
                          {auki ? 'Piilota' : 'Näytä'}
                        </button>
                      )}
                    </div>
                    {auki &&
                      ryhmanRivit.map((rivi) => {
                        const tulos = tulokset.find((t) => t.avain === rivi.avain);
                        // Virhe = tosite jäi syntymättä, varoitus = tosite syntyi mutta liite ei.
                        const huomio = tulos?.ok === false ? tulos.virhe : tulos?.varoitus;
                        return (
                          <div
                            key={rivi.avain}
                            className={`flex items-center gap-3 rounded-[6px] px-2 py-[7px] text-[12.5px] ${
                              rivi.avain === valittuAvain ? 'bg-[var(--accent-soft)]' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              aria-label={`Valitse ${rivi.tapahtuma.nimi}`}
                              checked={rivi.valittu}
                              onChange={(e) =>
                                setRivit(
                                  paivitaRivi(rivit, rivi.avain, { valittu: e.target.checked }),
                                )
                              }
                            />
                            <button
                              type="button"
                              onClick={() => setValittuAvain(rivi.avain)}
                              className="flex flex-1 items-center gap-3 text-left hover:bg-[var(--bg-subtle)]"
                            >
                              <span className="w-[78px] tabular-nums text-[var(--text-subtle)]">
                                {muotoilePvm(rivi.tapahtuma.pvm)}
                              </span>
                              <span className="flex-1 truncate">{rivi.tapahtuma.nimi}</span>
                              <span className="tabular-nums">
                                {muotoileEuro(rivi.tapahtuma.maara)}
                              </span>
                            </button>
                            {huomio && (
                              <span
                                className={
                                  tulos?.ok === false
                                    ? 'text-[var(--danger)]'
                                    : 'text-[var(--warning)]'
                                }
                              >
                                {huomio}
                              </span>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            {!sarakejako && (
              <>
                <TietoRyhma
                  otsikko="Kuitit ilman tapahtumaa"
                  rivit={kuititIlmanTapahtumaa.map((k) => perusnimi(k.tiedosto))}
                />
                <TietoRyhma
                  otsikko="Lukematta jääneet kuitit"
                  rivit={(aineisto?.lukematta ?? []).map(
                    (l) => `${perusnimi(l.tiedosto)} — ${l.syy}`,
                  )}
                />
              </>
            )}
          </section>

          <section
            aria-label="rivin tiedot"
            className="w-[320px] shrink-0 overflow-auto border-l border-[var(--border)] px-[18px] py-4"
          >
            {valittuRivi && !sarakejako ? (
              <RiviPaneeli
                key={valittuRivi.avain}
                rivi={valittuRivi}
                chart={chart}
                onTili={(tili) => setRivit(paivitaRivi(rivit, valittuRivi.avain, { tili }))}
                samannimisia={samannimiset(rivit, valittuRivi.avain).length}
                onSamaTiliKaikille={() =>
                  setRivit(asetaTiliSamannimisille(rivit, valittuRivi.avain))
                }
                onSaanto={tallennaSaanto}
                ehdokkaat={kuittiEhdokkaat(valittuRivi, kuititIlmanTapahtumaa)}
                onLiitaKuitti={(tiedosto) => liitaRivilleKuitti(valittuRivi.avain, tiedosto)}
                onIrrotaKuitti={() => irrotaRiviltaKuitti(valittuRivi.avain)}
                omatLiitteet={omatLiitteet[valittuRivi.avain] ?? []}
                onLisaaLiite={(l) => lisaaOmaLiite(valittuRivi.avain, l)}
                onPoistaLiite={(id) => poistaOmaLiite(valittuRivi.avain, id)}
                onKirjaaKasin={() => setKasinAvain(valittuRivi.avain)}
              />
            ) : (
              <p className="text-[13px] text-[var(--text-muted)]">Valitse rivi vasemmalta.</p>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] px-[22px] py-3">
          <Button
            type="button"
            // Avoin sarakejako piilottaa työlistan: piilossa olevia rivejä ei kirjata.
            disabled={kaynnissa || valitutMaara === 0 || sarakejako !== null}
            onClick={() => void kirjaaValitut()}
          >
            Kirjaa valitut ({valitutMaara})
          </Button>
        </div>
      </section>
    </>
  );
}
