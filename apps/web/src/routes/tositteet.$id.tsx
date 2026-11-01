import { useKpClient } from '@/app/KpClientProvider';
import {
  avaimet,
  useAvattavaTosite,
  useInit,
  useKohdennukset,
  useLiitteet,
  usePoistaLiite,
  useTallennaLiite,
} from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { KirjausYhteenveto } from '@/editori/KirjausYhteenveto';
import { SegmentedControl } from '@/editori/SegmentedControl';
import { TYYPPIVAIHTOEHDOT, TositeEditori } from '@/editori/TositeEditori';
import { alustaTila } from '@/editori/reducer';
import { tositeEditorille } from '@/editori/tositeEditorille';
import type { TositeEditoriTila } from '@/editori/types';
import {
  mitatoiTallennuksenKyselyt,
  tallennusVirhe,
  tyypinVaihtoSyote,
  useTositeTallennus,
} from '@/editori/useTositeTallennus';
import { onLasku, tositeTyyppiLabel, tyypinVoiVaihtaa } from '@/lib/tosite';
import { JAETTU_ASETTELU, JAETTU_PAA, LiitePaneeli } from '@/liitteet/LiitePaneeli.js';
import type { LadattavaLiite } from '@/liitteet/LiitteidenLataus.js';
import { LiitteidenLataus } from '@/liitteet/LiitteidenLataus.js';
import { avaaLiiteErikseen } from '@/liitteet/avaaLiite.js';
import { laskeSha } from '@/liitteet/laskeSha.js';
import { TallennuksenTila } from '@/tallennus/TallennuksenTila';
import {
  type TallennuksenPysaytys,
  useAutomaattinenTallennus,
} from '@/tallennus/useAutomaattinenTallennus';
import { useTallentamatonVaroitus } from '@/tallentamaton/useTallentamatonVaroitus';
import { tositeVertailuun } from '@/tallentamaton/vertailu';
import { lueTositteenTiliote } from '@/tiliote/tiliotetiedot';
import { EdellinenSeuraava, useTositeNaapurit } from '@/tositteet/EdellinenSeuraava.js';
import { LISTALTA, onListalta } from '@/tositteet/listanJarjestys.js';
import {
  type IsoDate,
  ResourceError,
  type StoredTosite,
  type Tili,
  TositeTila,
  TositeTyyppi,
  lataaKartta,
  onKirjanpidossa,
  onkoAlvVelvollinen,
  tasmayksenPankkitili,
  nimi as tilinNimi,
} from '@penni/engine';
import { muotoileEuro, muotoilePvm } from '@penni/euro';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useMemo, useState } from 'react';

export const Route = createFileRoute('/tositteet/$id')({ component: TositeReitti });

/** Edellinen/Seuraava vaihtaa vain parametria: avain nollaa tositekohtaisen tilan (virheet ym.). */
function TositeReitti() {
  const { id } = Route.useParams();
  return <TositeNaytto key={id} />;
}

/**
 * Ruudukkoeditorissa muokattavat tositetyypit: tyyppivalitsimen tyypit ja Muu (laskuilla on
 * omat lomakkeensa). Monimutkainen tuotu tiliote jää silti vain luku -tilaan, jos sen viennit
 * eivät palaudu riveiksi (tositeEditorille).
 */
const RUUDUKKOTYYPIT: ReadonlySet<number> = new Set([
  TositeTyyppi.MUU,
  ...TYYPPIVAIHTOEHDOT.map((t) => t.arvo),
]);

/** Osuuko kirjattu tosite lukittuun kauteen (sama sääntö kuin moottorissa). */
function onLukittu(tosite: StoredTosite, raja: IsoDate | undefined): boolean {
  if (raja === undefined || raja === '' || tosite.tila < TositeTila.KIRJANPIDOSSA) return false;
  return tosite.pvm <= raja || tosite.viennit.some((v) => v.pvm <= raja);
}

/**
 * Miksi tosite näytetään vain luku -muodossa (ei lukittu kausi): kerrotaan todellinen syy, ei
 * oletettua laskua tai alv-erittelyä.
 */
function vainLukuSyy(tosite: StoredTosite): string {
  const alku = 'Tätä tositetta ei voi muokata ruudukossa';
  if (onLasku(tosite)) return `${alku} (lasku).`;
  if (tosite.tyyppi >= TositeTyyppi.JARJESTELMATOSITE)
    return `${alku} (järjestelmän muodostama tosite).`;
  if (!RUUDUKKOTYYPIT.has(tosite.tyyppi))
    return `${alku} (tyyppi ${tositeTyyppiLabel(tosite.tyyppi)}).`;
  return `${alku} (viennit tai alv-erittely, jotka eivät palaudu riveiksi).`;
}

function TilinNimi({ tili }: { tili: Tili | undefined }) {
  if (!tili) return null;
  return <span className="ml-2 text-[var(--text-muted)]">{tilinNimi(tili)}</span>;
}

function poistoVirhe(e: unknown): string {
  if (e instanceof ResourceError && e.code === 'PVMLUKITTU')
    return 'Tosite osuu lukittuun tilikauteen, eikä sitä voi poistaa.';
  return e instanceof Error && e.message ? e.message : 'Tositteen poisto epäonnistui.';
}

/**
 * Tositteen muokkaus ruudukkoeditorissa; muutokset tallentuvat automaattisesti (PUT säilyttää
 * numeron). Kirjattu tosite tallentuu vain kelvollisena (täsmää, ei estäviä virheitä);
 * Palauta tallentaa avaushetken tilan takaisin. Luonnos tallentuu luonnoksena, ja Kirjaa
 * numeroi sen.
 */
function TositeMuokkaus({
  tosite,
  chart,
  alkutila,
  nro,
  lisatoiminnot,
  ilmoitukset,
  sivupaneeli,
  onKirjattu,
}: {
  tosite: StoredTosite;
  chart: readonly Tili[];
  alkutila: NonNullable<ReturnType<typeof tositeEditorille>>;
  nro: string;
  /** Yläpalkin toiminnot; Poista pysäyttää automaattisen tallennuksen ennen poistoa. */
  lisatoiminnot: (tallennus: TallennuksenPysaytys) => ReactNode;
  ilmoitukset: ReactNode;
  sivupaneeli: ReactNode;
  /** Luonnos kirjattiin: reitti näyttää kirjatun tositteen. */
  onKirjattu: (kirjattu: StoredTosite) => void;
}) {
  const { data: init } = useInit();
  const { data: kohdennukset } = useKohdennukset();
  const client = useKpClient();
  const pankkitili = init ? tasmayksenPankkitili(init.asetukset, chart) : undefined;
  const tallennus = useTositeTallennus(chart, tosite);
  const auto = useAutomaattinenTallennus<TositeEditoriTila>({
    tallenna: tallennus.paivita,
    vertailuun: tositeVertailuun,
    este: tallennus.este,
    kuvaaVirhe: tallennusVirhe,
  });
  const varoitus = useTallentamatonVaroitus(auto.onkoMenossaHukkaan);
  const kirjattu = onKirjanpidossa(tosite.tila);
  /** Avaushetken tila: Palauta tallentaa sen takaisin. */
  const [avattu] = useState(() => alustaTila(alkutila));
  /** Palauta luo editorin uudelleen avaushetken tilasta. */
  const [editori, setEditori] = useState({ avain: 0, alku: avattu });

  async function palauta() {
    if (await auto.pakotaTallennus(avattu))
      setEditori((e) => ({ avain: e.avain + 1, alku: avattu }));
  }

  /** Luonnoksen kirjaus samassa jonossa kesken olevan tallennuksen kanssa. */
  async function kirjaa(tila: TositeEditoriTila) {
    const t = await auto.jonossa(() => tallennus.kirjaa(tila));
    if (!t) return undefined;
    auto.asetaPohja(tila);
    onKirjattu(t);
    return t;
  }

  return (
    <>
      <TositeEditori
        key={editori.avain}
        chart={chart}
        kohdennukset={kohdennukset}
        alkupaiva={tosite.pvm}
        initial={editori.alku}
        otsikko={`${tositeTyyppiLabel(tosite.tyyppi)} · ${nro}`}
        alaotsikko={
          kirjattu
            ? 'Muutokset tallentuvat automaattisesti · numero säilyy'
            : 'Luonnos · numero annetaan kirjattaessa'
        }
        {...(init
          ? { onkoAlvVelvollinen: (pvm: string) => onkoAlvVelvollinen(init.asetukset, pvm) }
          : {})}
        onMuutos={auto.muuttui}
        onKenttaPoistui={auto.kenttaPoistui}
        pankkitili={pankkitili}
        onLueTiliote={() => lueTositteenTiliote(client, tosite.id, pankkitili)}
        {...(kirjattu ? {} : { onTallenna: kirjaa })}
        tallennaTeksti="Kirjaa"
        tallennaJaUusi={false}
        virheviesti={tallennus.virheviesti}
        lisatoiminnot={
          <>
            <TallennuksenTila
              tila={auto.tila}
              syy={auto.syy}
              tallennettuKerran={auto.tallennettuKerran}
              tallennettuTeksti={kirjattu ? 'Tallennettu' : 'Tallennettu luonnoksena'}
            />
            {kirjattu && auto.tallennettuKerran ? (
              <Button variant="sec" type="button" onClick={() => void palauta()}>
                Palauta
              </Button>
            ) : null}
            {lisatoiminnot({ lopeta: auto.lopeta, jatka: auto.jatka })}
          </>
        }
        ilmoitukset={ilmoitukset}
        sivupaneeli={sivupaneeli}
        lomakkeenNimi="tosite"
      />
      {varoitus}
    </>
  );
}

function TositeNaytto() {
  const { id } = Route.useParams();
  const { tosite, haettu } = useAvattavaTosite(Number(id));
  const { data: liitteet } = useLiitteet(Number(id));
  const { data: init } = useInit();
  const chart = useMemo(() => (init ? lataaKartta(init.tilit) : []), [init]);
  const tilit = useMemo(() => new Map(chart.map((t) => [t.numero, t])), [chart]);
  const client = useKpClient();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { tallenna } = useTallennaLiite();
  const { poista } = usePoistaLiite(Number(id));
  const [liiteVirhe, setLiiteVirhe] = useState<string | null>(null);
  /** Luonnoksen kirjaus luo editorin uudelleen kirjatusta tositteesta. */
  const [versio, setVersio] = useState(0);
  const [toimintoVirhe, setToimintoVirhe] = useState<string | null>(null);
  const [poistetaan, setPoistetaan] = useState(false);
  const [tyyppiaVaihdetaan, setTyyppiaVaihdetaan] = useState(false);
  // Listalta avattu tosite selataan listan järjestyksessä; merkintä kulkee selauksen mukana.
  const listalta = useLocation({ select: (l) => onListalta(l.state) });
  const naapurit = useTositeNaapurit(tosite, listalta);

  /** Pehmeä poisto vahvistuksen jälkeen; onnistuessa takaisin tositeluetteloon. */
  async function poistaTosite(nimi: string, tallennus?: TallennuksenPysaytys) {
    if (!window.confirm(`Poistetaanko tosite ${nimi}? Poisto kirjataan tositelokiin.`)) return;
    setToimintoVirhe(null);
    setPoistetaan(true);
    // Odottava automaattinen tallennus ei saa kirjoittaa poistettua tositetta takaisin.
    await tallennus?.lopeta();
    try {
      await client.poistaTosite(Number(id));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tositteet'] }),
        qc.invalidateQueries({ queryKey: ['saldot'] }),
        qc.invalidateQueries({ queryKey: ['viennit'] }),
        qc.invalidateQueries({ queryKey: ['raportti'] }),
        // Kohdennusten käyttömäärät ja kohdennus-/budjettiraporttien toteuma.
        qc.invalidateQueries({ queryKey: ['kohdennukset'] }),
        qc.invalidateQueries({ queryKey: ['kohdennusRaportti'] }),
        qc.invalidateQueries({ queryKey: ['budjettivertailu'] }),
      ]);
      // Poisto on jo vahvistettu: keskeneräiset muokkaukset poistetulle tositteelle eivät estä.
      await navigate({ to: '/tositteet', ignoreBlocker: true });
    } catch (e) {
      tallennus?.jatka();
      setToimintoVirhe(poistoVirhe(e));
      setPoistetaan(false);
    }
  }

  /**
   * Vain luku -näkymän tyypin vaihto: tallennettu tosite päivitetään sellaisenaan, vain tyyppi
   * vaihtuu (viennit, numero, sarja, päivä, otsikko ja liitteet säilyvät). Loki syntyy moottorin
   * tavallisesta päivityspolusta.
   */
  async function vaihdaTyyppi(tyyppi: number) {
    if (!tosite || tyyppi === tosite.tyyppi || tyyppiaVaihdetaan) return;
    setToimintoVirhe(null);
    setTyyppiaVaihdetaan(true);
    try {
      const tallennettu = await client.paivitaTosite(tosite.id, tyypinVaihtoSyote(tosite, tyyppi));
      qc.setQueryData(['tosite', tallennettu.id], tallennettu);
      mitatoiTallennuksenKyselyt(qc, tallennettu.id);
    } catch (e) {
      setToimintoVirhe(tallennusVirhe(e));
    } finally {
      setTyyppiaVaihdetaan(false);
    }
  }

  /** Hae liitteen tavudata ja avaa se erikseen (PDF/kuva uuteen ikkunaan, muu ladataan). */
  async function avaaLiite(liiteId: number) {
    setLiiteVirhe(null);
    setLiiteVirhe(await avaaLiiteErikseen(client, liiteId));
  }

  /** Laske sha, leimaa luontiaika ja tallenna uusi liite tositteelle. */
  async function lataaLiite(l: LadattavaLiite) {
    const sha = await laskeSha(l.data);
    await tallenna({
      tosite: Number(id),
      nimi: l.nimi,
      tyyppi: l.tyyppi,
      sha,
      luotu: new Date().toISOString(),
      data: l.data,
    });
  }

  /** Poista liite; virhe näytetään eikä jää käsittelemättömäksi hylkäykseksi. */
  async function poistaLiite(liiteId: number) {
    setLiiteVirhe(null);
    try {
      await poista(liiteId);
    } catch {
      setLiiteVirhe('Liitteen poisto epäonnistui.');
    }
  }

  // Kartta (useInit) tarvitaan, jotta tiedetään, avautuuko tosite suoraan editoriin.
  if (!haettu || (tosite && !init))
    return <p className="px-[22px] py-5 text-[var(--text-muted)]">Ladataan…</p>;
  if (!tosite)
    return (
      <>
        <TopBar otsikko="Tositetta ei löytynyt" />
        <section className="flex-1 px-[22px] py-5 text-[var(--text-muted)]">
          Tositetta {id} ei ole.
        </section>
      </>
    );

  const nro = tosite.tunniste > 0 ? `${tosite.sarja} ${tosite.tunniste}`.trim() : 'Luonnos';
  const raja = init?.asetukset.TilitPaatetty;
  const lukittu = onLukittu(tosite, typeof raja === 'string' ? raja : undefined);
  // Poistettu (Poistetut-lista) näytetään vain luku -tilassa: sitä ei muokata eikä poisteta uudelleen.
  const poistettu = tosite.tila === TositeTila.POISTETTU;
  // Viennitön lasku (esim. eräpäivällinen laskun runko) jää vain luku -näkymään: editorin
  // tyyppivalinta irrottaisi sen laskusta.
  const alkutila =
    init &&
    RUUDUKKOTYYPIT.has(tosite.tyyppi) &&
    !(tosite.rivit && tosite.rivit.length > 0) &&
    (tosite.viennit.length > 0 || !onLasku(tosite))
      ? tositeEditorille(tosite, chart)
      : null;

  const toiminnot = (tallennus?: TallennuksenPysaytys) => (
    <>
      <EdellinenSeuraava
        naapurit={naapurit}
        onSiirry={(seuraavaId) =>
          void navigate({
            to: '/tositteet/$id',
            params: { id: String(seuraavaId) },
            ...(listalta ? { state: LISTALTA } : {}),
          })
        }
      />
      <Button
        variant="sec"
        type="button"
        disabled={lukittu || poistettu || poistetaan}
        onClick={() =>
          void poistaTosite(`${tositeTyyppiLabel(tosite.tyyppi)} ${nro}`.trim(), tallennus)
        }
      >
        Poista
      </Button>
    </>
  );
  const toimintoVirheViesti = toimintoVirhe ? (
    <p role="alert" className="text-[12.5px] text-[var(--danger)]">
      {toimintoVirhe}
    </p>
  ) : null;
  const liitePaneeli = (
    <LiitePaneeli
      liitteet={liitteet ?? []}
      onAvaaErikseen={(liiteId) => void avaaLiite(liiteId)}
      onPoista={(liiteId) => void poistaLiite(liiteId)}
    >
      {liiteVirhe ? (
        <p role="alert" className="text-[12.5px] text-[var(--danger)]">
          {liiteVirhe}
        </p>
      ) : null}
      <LiitteidenLataus onLataa={lataaLiite} />
    </LiitePaneeli>
  );

  // Muokattava tosite avautuu suoraan ruudukkoeditoriin kuitin esikatselun viereen.
  if (alkutila && !lukittu && !poistettu)
    return (
      <TositeMuokkaus
        key={`${tosite.id}:${versio}`}
        tosite={tosite}
        chart={chart}
        alkutila={alkutila}
        nro={nro}
        onKirjattu={(kirjattu) => {
          qc.setQueryData(avaimet.tosite(kirjattu.id), kirjattu);
          setToimintoVirhe(null);
          setVersio((v) => v + 1);
        }}
        lisatoiminnot={toiminnot}
        ilmoitukset={toimintoVirheViesti}
        sivupaneeli={liitePaneeli}
      />
    );

  return (
    <>
      <TopBar
        otsikko={`${tositeTyyppiLabel(tosite.tyyppi)} · ${nro}`}
        alaotsikko={`${muotoilePvm(tosite.pvm)}${tosite.otsikko ? ` · ${tosite.otsikko}` : ''}`}
        toiminnot={toiminnot()}
      />
      <div className={JAETTU_ASETTELU}>
        <section aria-label="tosite" className={`px-[22px] py-5 ${JAETTU_PAA}`}>
          {poistettu ? (
            <p className="mb-3 text-[12.5px] text-[var(--text-muted)]">
              Tosite on poistettu, eikä sitä voi muokata.
            </p>
          ) : lukittu ? (
            <p className="mb-3 text-[12.5px] text-[var(--text-muted)]">
              Tosite on lukitulla kaudella (tilit päätetty{' '}
              {typeof raja === 'string' ? muotoilePvm(raja) : ''}), eikä sitä voi muokata tai
              poistaa.
            </p>
          ) : (
            <p className="mb-3 text-[12.5px] text-[var(--text-muted)]">{vainLukuSyy(tosite)}</p>
          )}
          {!lukittu && tyypinVoiVaihtaa(tosite) ? (
            <div className="mb-3">
              <SegmentedControl
                nimi="Tyyppi"
                vaihtoehdot={TYYPPIVAIHTOEHDOT}
                arvo={tosite.tyyppi}
                onMuutos={(t) => void vaihdaTyyppi(t)}
              />
            </div>
          ) : null}
          {toimintoVirhe ? <div className="mb-3">{toimintoVirheViesti}</div> : null}
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Tili', 'Selite', 'Debet', 'Kredit'].map((h, i) => (
                  <th
                    key={h}
                    className={`px-[10px] pb-[7px] text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)] ${
                      i >= 2 ? 'text-right' : 'text-left'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tosite.viennit.map((v, i) => (
                <tr
                  // Vienneillä ei ole omaa id:tä; rivijärjestys on vakaa ja näkymä read-only.
                  // biome-ignore lint/suspicious/noArrayIndexKey: vakaa järjestys, read-only näyttö
                  key={i}
                  className="border-t border-[var(--border)]"
                >
                  <td className="px-[10px] py-[9px]">
                    <span className="tabular-nums">{v.tili}</span>
                    <TilinNimi tili={tilit.get(v.tili)} />
                  </td>
                  <td className="px-[10px] py-[9px] text-[var(--text-muted)]">{v.selite ?? '—'}</td>
                  <td className="px-[10px] py-[9px] text-right tabular-nums">
                    {v.debet ? muotoileEuro(v.debet) : '—'}
                  </td>
                  <td className="px-[10px] py-[9px] text-right tabular-nums">
                    {v.kredit ? muotoileEuro(v.kredit) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4">
            <KirjausYhteenveto viennit={tosite.viennit} chart={chart} />
          </div>
        </section>
        {liitePaneeli}
      </div>
    </>
  );
}
