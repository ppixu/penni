import { useKpClient } from '@/app/KpClientProvider';
import {
  useAvattavaTosite,
  useInit,
  useKohdennukset,
  useLiitteet,
  usePoistaLiite,
  useTallennaLiite,
  useTositteet,
} from '@/app/kysely';
import { type LomakkeenTaytto, TositeEditori } from '@/editori/TositeEditori';
import { oletusPankkitili } from '@/editori/oletusPankkitili';
import { tositeEditorille } from '@/editori/tositeEditorille';
import type { TositeEditoriTila } from '@/editori/types';
import { tallennusVirhe, useTositeTallennus } from '@/editori/useTositeTallennus';
import { KuitinLukuIlmoitus } from '@/kuitit/KuitinLukuIlmoitus';
import { kuittiTaytto } from '@/kuitit/kuittiTaytto';
import { useKuitinLuku } from '@/kuitit/useKuitinLuku';
import { LiitePaneeli } from '@/liitteet/LiitePaneeli';
import { type LadattavaLiite, LiitteidenLataus } from '@/liitteet/LiitteidenLataus';
import { avaaLiiteErikseen } from '@/liitteet/avaaLiite';
import { laskeSha } from '@/liitteet/laskeSha';
import { TallennuksenTila } from '@/tallennus/TallennuksenTila';
import { useAutomaattinenTallennus } from '@/tallennus/useAutomaattinenTallennus';
import { useTallentamatonVaroitus } from '@/tallentamaton/useTallentamatonVaroitus';
import { tositeVertailuun } from '@/tallentamaton/vertailu';
import { lueTiliotePdf, tilioteTaytto, tilioteTiedoiksi } from '@/tiliote/tiliotetiedot';
import {
  type StoredTosite,
  type Tili,
  type TilioteTiedot,
  TositeTila,
  lataaKartta,
  lueTasmaysSaannot,
  onkoAlvVelvollinen,
} from '@penni/engine';
import { Link, Navigate, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface UusiTositeHaku {
  /** Kesken oleva luonnos: lomake jatkaa sitä (uudelleenlataus). */
  luonnos?: number | undefined;
}

function lueLuonnos(x: unknown): number | undefined {
  const n = typeof x === 'string' ? Number(x) : x;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;
}

export const Route = createFileRoute('/tositteet/uusi')({
  validateSearch: (haku: Record<string, unknown>): UusiTositeHaku => ({
    luonnos: lueLuonnos(haku.luonnos),
  }),
  component: UusiTosite,
});

/**
 * Lataa kirjan ja osoitteen luonnoksen. Luonnos luetaan vain avattaessa: lomakkeen oma
 * luonnos päivittää osoitetta, mutta ei lataa lomaketta uudelleen.
 */
function UusiTosite() {
  const { luonnos: osoitteenLuonnos } = Route.useSearch();
  const [alkuLuonnos] = useState(osoitteenLuonnos);
  const { data: init } = useInit();
  const { data: tositteet } = useTositteet({});
  const { tosite: luonnos, haettu } = useAvattavaTosite(alkuLuonnos);
  // Chart is loaded from useInit; empty until it arrives (the editor isn't rendered until then).
  const chart = useMemo(() => (init ? lataaKartta(init.tilit) : []), [init]);
  const pankkitili = useMemo(() => oletusPankkitili(chart, tositteet ?? []), [chart, tositteet]);

  if (!init || !haettu) return <p className="px-[22px] py-5 text-[var(--text-muted)]">Ladataan…</p>;

  // Default the voucher date to TODAY, clamped into the active fiscal year so the engine never
  // throws EITILIKAUTTA. Common case (today is within the open period) => today, the right
  // daily-loop default; outside it (a past/future-only book) => the period start. new Date() is
  // fine for a UI default (it is neither money nor the audit clock). The user can change it.
  const kausi = init.tilikaudet.at(-1);
  const tanaan = new Date().toISOString().slice(0, 10);
  const alkupaiva = kausi
    ? tanaan >= kausi.alkaa && tanaan <= kausi.loppuu
      ? tanaan
      : kausi.alkaa
    : '';

  return (
    <UusiTositeAvaus
      chart={chart}
      alkupaiva={alkupaiva}
      pankkitili={pankkitili}
      haettu={luonnos ?? null}
    />
  );
}

/**
 * Osoitteen luonnos arvioidaan kerran avattaessa: Kirjaa ja uusi -toiminnon jälkeen
 * uudelleenhaettu (nyt kirjattu) luonnos ei saa ohjata pois uudelta lomakkeelta.
 */
function UusiTositeAvaus({
  chart,
  alkupaiva,
  pankkitili,
  haettu,
}: {
  chart: readonly Tili[];
  alkupaiva: string;
  pankkitili: number | undefined;
  haettu: StoredTosite | null;
}) {
  const [avaus] = useState(() => {
    const alkutila =
      haettu && haettu.tila === TositeTila.LUONNOS ? tositeEditorille(haettu, chart) : null;
    if (haettu && alkutila) return { luonnos: { tosite: haettu, alkutila } };
    // Kirjattu (tai ruudukkoon palautumaton) tosite avautuu omalle sivulleen; poistettu tai
    // puuttuva aloittaa tyhjän lomakkeen.
    return { siirry: haettu && haettu.tila >= TositeTila.LUONNOS ? haettu.id : undefined };
  });

  if ('siirry' in avaus && avaus.siirry !== undefined)
    return <Navigate to="/tositteet/$id" params={{ id: String(avaus.siirry) }} replace />;
  return (
    <UusiTositeLomake
      chart={chart}
      alkupaiva={alkupaiva}
      pankkitili={pankkitili}
      luonnos={'luonnos' in avaus ? avaus.luonnos : undefined}
    />
  );
}

/**
 * Uusi tosite tallentuu luonnokseksi kirjoitettaessa: ensimmäinen todellinen muutos (tai
 * liite) luo luonnoksen, myöhemmät päivittävät sitä. Kirjaa numeroi sen, Kirjaa ja uusi
 * aloittaa tyhjän lomakkeen. Poistuminen ei kysy, ellei muutosta voi tallentaa.
 */
function UusiTositeLomake({
  chart,
  alkupaiva,
  pankkitili,
  luonnos,
}: {
  chart: readonly Tili[];
  alkupaiva: string;
  pankkitili: number | undefined;
  luonnos: { tosite: StoredTosite; alkutila: Partial<TositeEditoriTila> } | undefined;
}) {
  const { data: init } = useInit();
  const { data: kohdennukset } = useKohdennukset();
  const client = useKpClient();
  const navigate = useNavigate();
  const router = useRouter();
  // Sama alv-sääntö lomakkeen riveille ja kuitista täytetyille riveille.
  const alvVelvollinen = useCallback(
    (pvm: string) => (init ? onkoAlvVelvollinen(init.asetukset, pvm) : false),
    [init],
  );
  const tallennus = useTositeTallennus(chart, luonnos?.tosite);
  const [luonnosId, setLuonnosId] = useState(luonnos?.tosite.id);
  const kiinni = useRef(true);
  useEffect(() => {
    kiinni.current = true;
    return () => {
      kiinni.current = false;
    };
  }, []);

  /** Ensimmäinen tallennus luo luonnoksen ja vie sen osoitteeseen; loput päivittävät sitä. */
  async function tallennaLuonnos(tila: TositeEditoriTila) {
    if (tallennus.id() !== undefined) return tallennus.paivita(tila);
    const t = await tallennus.luoLuonnos(tila);
    if (kiinni.current) setLuonnosId(t.id);
    // Poistumisen alettua valmistunut luonti ei saa palauttaa käyttäjää lomakkeelle: osoite
    // vaihdetaan vain, jos reititin on yhä menossa tälle sivulle (ei kesken olevaa siirtymää).
    if (kiinni.current && router.latestLocation.pathname === Route.fullPath)
      void navigate({
        to: '/tositteet/uusi',
        search: { luonnos: t.id },
        replace: true,
        ignoreBlocker: true,
      });
    return t;
  }

  const auto = useAutomaattinenTallennus<TositeEditoriTila>({
    tallenna: tallennaLuonnos,
    vertailuun: tositeVertailuun,
    este: tallennus.este,
    kuvaaVirhe: tallennusVirhe,
  });
  const varoitus = useTallentamatonVaroitus(auto.onkoMenossaHukkaan);

  const { data: liitteet } = useLiitteet(luonnosId ?? 0, luonnosId !== undefined);
  const { tallenna: tallennaLiite } = useTallennaLiite();
  const { poista } = usePoistaLiite(luonnosId ?? 0);
  const [liiteVirhe, setLiiteVirhe] = useState<string | null>(null);

  const luku = useKuitinLuku();
  const [taytto, setTaytto] = useState<LomakkeenTaytto | undefined>(undefined);
  const tayttoNro = useRef(0);
  /** Luettava liite: tositteen ensimmäinen liite luetaan, ja sen poisto peruu luvun. */
  const luettava = useRef<number | null>(null);
  /** Lomakkeen sukupolvi: Kirjaa ja uusi aloittaa uuden (kesken jäänyt liite ei lue siihen). */
  const lomake = useRef(0);

  useEffect(() => {
    if (luku.tila.vaihe !== 'luettu' || !init) return;
    const { kuitti } = luku.tila;
    const asetukset = {
      menotiliSaannot: lueTasmaysSaannot(init.asetukset).menotiliSaannot,
      ...(pankkitili !== undefined ? { pankkitili } : {}),
    };
    const lukittu = init.asetukset.TilitPaatetty ?? '';
    tayttoNro.current += 1;
    setTaytto({
      avain: tayttoNro.current,
      laske: (nykyinen, oletusPaiva, rivitKaytossa) =>
        kuittiTaytto(kuitti, nykyinen, {
          oletusPaiva,
          rivitKaytossa,
          chart,
          asetukset,
          sallittuPaiva: (pvm) =>
            pvm > lukittu && init.tilikaudet.some((k) => pvm >= k.alkaa && pvm <= k.loppuu),
          alvVelvollinen,
        }),
    });
    luku.kuittaa();
  }, [luku.tila, luku.kuittaa, init, chart, pankkitili, alvVelvollinen]);

  /** Liite tallennetaan luonnokselle heti (luonnos luodaan tarvittaessa). Heittää virheen. */
  async function lataaLiite(l: LadattavaLiite) {
    setLiiteVirhe(null);
    const oma = lomake.current;
    if (tallennus.id() === undefined) await auto.pakotaTallennus();
    const tosite = tallennus.id();
    if (tosite === undefined) throw new Error('Luonnosta ei voitu tallentaa');
    const meta = await tallennaLiite({
      tosite,
      nimi: l.nimi,
      tyyppi: l.tyyppi,
      sha: await laskeSha(l.data),
      luotu: new Date().toISOString(),
      data: l.data,
    });
    // Kirjaa ja uusi ehti väliin (tallennuksen tai liitteiden haun aikana): liite jää aiemmalle
    // tositteelle, uutta lomaketta ei täytetä.
    const samaLomake = () => oma === lomake.current && tallennus.id() === tosite;
    if (!samaLomake()) return;
    // Vain tositteen ensimmäinen liite luetaan.
    const ensimmainen =
      luettava.current === null && (await client.haeLiitteet(tosite)).length === 1;
    if (ensimmainen && samaLomake()) {
      luettava.current = meta.id;
      // Pankin kuukausitiliote täyttää Tiliote-tositteen; muut liitteet luetaan kuitteina.
      if (l.tyyppi === 'application/pdf' && (await taytaTiliotteena(l.data))) return;
      if (samaLomake()) luku.lue({ id: meta.id, tyyppi: l.tyyppi, data: l.data });
    }
  }

  /** Lue PDF tiliotteena ja täytä lomake; false, jos tiedosto ei ole tiliote. */
  async function taytaTiliotteena(data: Uint8Array): Promise<boolean> {
    if (pankkitili === undefined) return false;
    let tiedot: TilioteTiedot | null = null;
    try {
      const luettu = await lueTiliotePdf(
        new Blob([new Uint8Array(data)], { type: 'application/pdf' }),
      );
      tiedot = luettu && tilioteTiedoiksi(luettu.tiliote, pankkitili, luettu.iban);
    } catch {
      return false;
    }
    if (!tiedot) return false;
    const valmis = tiedot;
    tayttoNro.current += 1;
    setTaytto({ avain: tayttoNro.current, laske: (nykyinen) => tilioteTaytto(valmis, nykyinen) });
    return true;
  }

  async function poistaLiite(liiteId: number) {
    setLiiteVirhe(null);
    if (liiteId === luettava.current) {
      luku.peru();
      luettava.current = null;
    }
    try {
      await poista(liiteId);
    } catch {
      setLiiteVirhe('Liitteen poisto epäonnistui.');
    }
  }

  async function avaaLiite(liiteId: number) {
    setLiiteVirhe(null);
    setLiiteVirhe(await avaaLiiteErikseen(client, liiteId));
  }

  /** Kirjaa: odottaa kesken olevan tallennuksen ja kirjaa lopullisen tilan samassa jonossa. */
  async function kirjaa(tila: TositeEditoriTila) {
    // Kirjauksen aikana saapuva tulos ei saa muuttaa kirjattavaa lomaketta.
    luku.peru();
    const tulos = await auto.jonossa(() => tallennus.kirjaa(tila));
    if (tulos) auto.asetaPohja(tila);
    return tulos;
  }

  /** Kirjaa ja uusi: uusi lomake ilman luonnosta; seuraava muutos luo uuden. */
  function nollattu(tila: TositeEditoriTila) {
    lomake.current += 1;
    tallennus.nollaa();
    auto.nollaa(tila);
    setLuonnosId(undefined);
    luettava.current = null;
    setLiiteVirhe(null);
    void navigate({ to: '/tositteet/uusi', search: {}, replace: true, ignoreBlocker: true });
  }

  return (
    <>
      <TositeEditori
        chart={chart}
        kohdennukset={kohdennukset}
        alkupaiva={alkupaiva}
        {...(luonnos ? { initial: luonnos.alkutila } : {})}
        alaotsikko="Luonnos · numero annetaan kirjattaessa"
        pankkitili={pankkitili}
        onkoAlvVelvollinen={alvVelvollinen}
        taytto={taytto}
        onMuutos={auto.muuttui}
        onKenttaPoistui={auto.kenttaPoistui}
        onTallenna={kirjaa}
        onNollattu={nollattu}
        tallennaTeksti="Kirjaa"
        vahvistus="Kirjattu"
        virheviesti={tallennus.virheviesti}
        onTallennettu={(id) => navigate({ to: '/tositteet/$id', params: { id: String(id) } })}
        tallennettuLinkki={(t, teksti) => (
          <Link
            to="/tositteet/$id"
            params={{ id: String(t.id) }}
            className="text-[var(--accent)] underline"
          >
            {teksti}
          </Link>
        )}
        lisatoiminnot={
          <TallennuksenTila
            tila={auto.tila}
            syy={auto.syy}
            tallennettuKerran={auto.tallennettuKerran}
            tallennettuTeksti="Tallennettu luonnoksena"
          />
        }
        sivupaneeli={
          <LiitePaneeli
            liitteet={liitteet ?? []}
            onAvaaErikseen={(id) => void avaaLiite(id)}
            onPoista={(id) => void poistaLiite(id)}
          >
            {liiteVirhe ? (
              <p role="alert" className="text-[12.5px] text-[var(--danger)]">
                {liiteVirhe}
              </p>
            ) : null}
            <KuitinLukuIlmoitus tila={luku.tila} onLupa={luku.vastaaLupaan} />
            <LiitteidenLataus onLataa={lataaLiite} />
          </LiitePaneeli>
        }
      />
      {varoitus}
    </>
  );
}
