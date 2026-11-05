import { useKpClient } from '@/app/KpClientProvider';
import { avaimet, useInit } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import {
  HenkilonRivit,
  type LomakeRivi,
  lomakeRiviksi,
  lomakkeestaSyotteeksi,
} from '@/palkat/HenkilonRivit';
import { AjonSummat, HenkilonLaskelma } from '@/palkat/LaskelmaYhteenveto';
import { KENTTA_LUOKKA, LABEL_LUOKKA, VIHJE_LUOKKA, VIRHE_LUOKKA } from '@/palkat/lomakeLuokat';
import {
  type AiempiAjo,
  type KirjanPalkkatiedot,
  type PalkkaAjoLuonnos,
  PalkkaAjoVirhe,
  edeltavatAjot,
  haePalkkaAjot,
  laskeHenkilo,
  luePalkkatiedot,
  tarkistaLuonnos,
} from '@/palkat/palkkaAjoTiedot';
import { tallennaPalkkaAjo } from '@/palkat/tallennaPalkkaAjo';
import {
  type IsoDate,
  type PalkkaHenkilo,
  type StoredTosite,
  type Tili,
  lataaKartta,
} from '@penni/engine';
import {
  PalkatVirhe,
  type SyoteRivi,
  type Taulukko,
  type Tyontekija,
  haeTaulukko,
  oletusRivit,
  taulukkoHaku,
} from '@penni/palkat';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

/**
 * Palkanmaksun lomake (uusi ja muokkaus): maksupäivä ja kausi, henkilöt, henkilöittäin rivit ja
 * jokaisen muutoksen jälkeen laskettu esikatselu. Tallennus estetään, kun jokin rivi on
 * virheellinen, laskenta ei onnistu, nettopalkka on negatiivinen tai maksutili puuttuu.
 */

const p2 = (n: number) => String(n).padStart(2, '0');
const isoPaiva = (d: Date): IsoDate =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/** Oletukset: maksupäivä tänään, kausi kuluva kuukausi. */
function oletusPaivat(): Pick<PalkkaAjoLuonnos, 'maksupaiva' | 'kausiAlkaa' | 'kausiLoppuu'> {
  const nyt = new Date();
  const alku = new Date(nyt.getFullYear(), nyt.getMonth(), 1);
  const loppu = new Date(nyt.getFullYear(), nyt.getMonth() + 1, 0);
  return { maksupaiva: isoPaiva(nyt), kausiAlkaa: isoPaiva(alku), kausiLoppuu: isoPaiva(loppu) };
}

/** Työntekijän oletusrivit (`oletusRivit`); puhelinedun summa lasketaan aina taulukosta uudelleen. */
function oletusLomakeRivit(
  t: Tyontekija,
  kausiLoppuu: IsoDate,
  tiedot: KirjanPalkkatiedot,
): LomakeRivi[] {
  let taulukko: Taulukko;
  try {
    taulukko = taulukkoHaku(tiedot.ohitus)(Number(kausiLoppuu.slice(0, 4)), ['puhelinetuKk']);
  } catch {
    // Puuttuva taulukko näytetään esikatselussa; rivien muoto ei riipu siitä.
    taulukko = { puhelinetuKk: 0 } as Taulukko;
  }
  return oletusRivit(t, taulukko, kausiLoppuu).map(lomakeRiviksi);
}

/** Viimeksi käytetty kulukorvauksen tili (uusimmasta palkka-ajosta). */
function viimeisinKulutili(ajot: readonly AiempiAjo[]): number | undefined {
  const jarjestetty = [...ajot].sort((a, b) =>
    a.pvm < b.pvm ? 1 : a.pvm > b.pvm ? -1 : b.id - a.id,
  );
  for (const a of jarjestetty) {
    for (const h of a.palkka.henkilot) {
      for (const r of h.rivit) if (r.laji === 'kulukorvaus' && r.tili !== undefined) return r.tili;
    }
  }
  return undefined;
}

interface Tila {
  maksupaiva: IsoDate;
  kausiAlkaa: IsoDate;
  kausiLoppuu: IsoDate;
  valitut: string[];
  rivit: Record<string, LomakeRivi[]>;
}

interface HenkilonTulos {
  id: string;
  tyontekija: Tyontekija | undefined;
  rivivirheet: (string | null)[];
  henkilo?: PalkkaHenkilo;
  virhe?: string;
}

interface PuuttuvaTaulukko {
  vuosi: number;
  puuttuvat: string[];
}

function onPuuttuvaTaulukko(x: unknown): x is PuuttuvaTaulukko {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as PuuttuvaTaulukko).vuosi === 'number' &&
    Array.isArray((x as PuuttuvaTaulukko).puuttuvat)
  );
}

function virheTeksti(e: unknown): string {
  if (e instanceof PalkkaAjoVirhe || e instanceof PalkatVirhe) return e.message;
  if (e instanceof Error && e.message) return `Tallennus epäonnistui: ${e.message}`;
  return 'Tallennus epäonnistui.';
}

export function PalkkaAjoLomake({
  alku,
  olemassaOlevaId,
}: {
  /** Muokattavan ajon luonnos (`luonnosTositteesta`); puuttuu uudelta ajolta. */
  alku?: PalkkaAjoLuonnos;
  olemassaOlevaId?: number;
}) {
  const client = useKpClient();
  const { data: init } = useInit();
  const ajot = useQuery({
    queryKey: ['tositteet', 'palkka-ajot'],
    queryFn: () => haePalkkaAjot(client),
  });
  const luku = useMemo(() => {
    if (!init) return null;
    try {
      return { tiedot: luePalkkatiedot(init.asetukset) };
    } catch (e) {
      return { virhe: e instanceof Error ? e.message : 'Palkkatiedot ovat virheelliset.' };
    }
  }, [init]);
  const tilit = useMemo(() => (init ? lataaKartta(init.tilit) : []), [init]);

  if (!init || !luku || ajot.isLoading) {
    return <p className="px-[22px] py-5 text-[13.5px] text-[var(--text-muted)]">Ladataan…</p>;
  }
  if (!luku.tiedot) {
    return (
      <p role="alert" className="px-[22px] py-5 text-[13px] text-[var(--danger)]">
        {luku.virhe}{' '}
        <Link to="/palkat/tyontekijat" className="underline">
          Tarkista työntekijät
        </Link>{' '}
        ja{' '}
        <Link to="/palkat/asetukset" className="underline">
          palkka-asetukset
        </Link>
        .
      </p>
    );
  }
  return (
    <Lomake
      tiedot={luku.tiedot}
      ajot={ajot.data ?? []}
      ajotVirhe={ajot.isError}
      haeAjotUudelleen={() => void ajot.refetch()}
      tilit={tilit}
      {...(alku ? { alku } : {})}
      {...(olemassaOlevaId !== undefined ? { olemassaOlevaId } : {})}
    />
  );
}

function alkutila(alku: PalkkaAjoLuonnos | undefined, tiedot: KirjanPalkkatiedot): Tila {
  if (alku) {
    return {
      maksupaiva: alku.maksupaiva,
      kausiAlkaa: alku.kausiAlkaa,
      kausiLoppuu: alku.kausiLoppuu,
      valitut: alku.syotteet.map((s) => s.tyontekijaId),
      rivit: Object.fromEntries(
        alku.syotteet.map((s) => [s.tyontekijaId, s.rivit.map(lomakeRiviksi)]),
      ),
    };
  }
  const paivat = oletusPaivat();
  const aktiiviset = [...tiedot.tyontekijat.values()].filter((t) => t.aktiivinen);
  return {
    ...paivat,
    valitut: aktiiviset.map((t) => t.id),
    rivit: Object.fromEntries(
      aktiiviset.map((t) => [t.id, oletusLomakeRivit(t, paivat.kausiLoppuu, tiedot)]),
    ),
  };
}

function Lomake({
  tiedot,
  ajot,
  ajotVirhe,
  haeAjotUudelleen,
  tilit,
  alku,
  olemassaOlevaId,
}: {
  tiedot: KirjanPalkkatiedot;
  ajot: readonly AiempiAjo[];
  /** Aiempien ajojen haku epäonnistui: kertymät olisivat väärät, joten tallennus on estetty. */
  ajotVirhe: boolean;
  haeAjotUudelleen: () => void;
  tilit: readonly Tili[];
  alku?: PalkkaAjoLuonnos;
  olemassaOlevaId?: number;
}) {
  const client = useKpClient();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tila, setTila] = useState<Tila>(() => alkutila(alku, tiedot));
  const [tallentaa, setTallentaa] = useState(false);
  const [virhe, setVirhe] = useState<string | null>(null);
  /** Tosite luotiin, mutta tallennus jäi kesken: ei uutta tallennusta (kaksoiskappale). */
  const [kesken, setKesken] = useState<{ id: number; viesti: string } | null>(null);
  const oletusKulutili = useMemo(() => viimeisinKulutili(ajot), [ajot]);

  // Valittavissa: aktiiviset + ajossa jo olevat (muokattaessa myös käytöstä poistetut).
  const valittavat = [...tiedot.tyontekijat.values()].filter(
    (t) => t.aktiivinen || tila.valitut.includes(t.id),
  );
  // Ajon henkilöt rekisterin järjestyksessä, tuntemattomat (rikkinäiset) lopussa.
  const jarjestys = [...tiedot.tyontekijat.keys()];
  const valitut = [...tila.valitut].sort(
    (a, b) =>
      (jarjestys.indexOf(a) + 1 || Number.MAX_SAFE_INTEGER) -
      (jarjestys.indexOf(b) + 1 || Number.MAX_SAFE_INTEGER),
  );

  const paivaVirhe = useMemo(() => {
    try {
      tarkistaLuonnos({ ...tila, syotteet: [{ tyontekijaId: '-', rivit: [] }] });
      return null;
    } catch (e) {
      return e instanceof PalkkaAjoVirhe ? e.message : 'Päivät ovat virheelliset.';
    }
  }, [tila]);

  const edeltavat = useMemo(
    () => edeltavatAjot(ajot, tila.maksupaiva, olemassaOlevaId),
    [ajot, tila.maksupaiva, olemassaOlevaId],
  );

  const { tulokset, puuttuva } = useMemo(() => {
    let puuttuva: PuuttuvaTaulukko | null = null;
    const tulokset: HenkilonTulos[] = valitut.map((id) => {
      const tyontekija = tiedot.tyontekijat.get(id);
      const muunnokset = (tila.rivit[id] ?? []).map(lomakkeestaSyotteeksi);
      const rivivirheet = muunnokset.map((m) => ('virhe' in m ? m.virhe : null));
      const tulos: HenkilonTulos = { id, tyontekija, rivivirheet };
      if (!tyontekija) {
        tulos.virhe = 'Henkilöä ei löydy työntekijärekisteristä.';
        return tulos;
      }
      if (paivaVirhe || rivivirheet.some((v) => v !== null)) return tulos;
      const rivit = muunnokset.map((m) => (m as { rivi: SyoteRivi }).rivi);
      try {
        tulos.henkilo = laskeHenkilo(tila, tyontekija, rivit, tiedot, edeltavat);
      } catch (e) {
        if (
          e instanceof PalkatVirhe &&
          e.koodi === 'TAULUKKO_PUUTTUU' &&
          onPuuttuvaTaulukko(e.tiedot)
        ) {
          const t = e.tiedot;
          if (!puuttuva) puuttuva = { vuosi: t.vuosi, puuttuvat: [...t.puuttuvat] };
          else if (puuttuva.vuosi === t.vuosi) {
            for (const k of t.puuttuvat)
              if (!puuttuva.puuttuvat.includes(k)) puuttuva.puuttuvat.push(k);
          }
          tulos.virhe = e.message;
        } else {
          tulos.virhe =
            e instanceof PalkatVirhe || e instanceof PalkkaAjoVirhe
              ? e.message
              : 'Laskenta epäonnistui.';
        }
      }
      return tulos;
    });
    // Laskenta pysähtyy ensimmäiseen puuttuvaan arvoon: luetellaan myös vuoden muut puuttuvat,
    // jotta käyttäjä voi täydentää ne kerralla.
    const p = puuttuva as PuuttuvaTaulukko | null;
    if (p) {
      const kaikki = haeTaulukko(p.vuosi, tiedot.ohitus);
      if (!kaikki.ok)
        for (const k of kaikki.puuttuvat) if (!p.puuttuvat.includes(k)) p.puuttuvat.push(k);
    }
    return { tulokset, puuttuva: p };
  }, [valitut, tila, tiedot, edeltavat, paivaVirhe]);

  const lasketut = tulokset.flatMap((t) => (t.henkilo ? [t.henkilo] : []));
  const kaikkiLaskettu = tulokset.length > 0 && lasketut.length === tulokset.length;
  const negatiivinen = lasketut.some((h) => h.tulos.nettopalkka < 0);
  const voiTallentaa =
    !tallentaa &&
    !ajotVirhe &&
    !kesken &&
    tiedot.palkkatilit !== undefined &&
    kaikkiLaskettu &&
    !negatiivinen;

  function asetaPaiva(kentta: 'maksupaiva' | 'kausiAlkaa' | 'kausiLoppuu', arvo: string) {
    setTila((t) => ({ ...t, [kentta]: arvo }));
  }

  function valitse(t: Tyontekija, valittu: boolean) {
    setTila((s) => {
      if (!valittu) return { ...s, valitut: s.valitut.filter((id) => id !== t.id) };
      const rivit = s.rivit[t.id] ?? oletusLomakeRivit(t, s.kausiLoppuu, tiedot);
      return { ...s, valitut: [...s.valitut, t.id], rivit: { ...s.rivit, [t.id]: rivit } };
    });
  }

  async function tallenna() {
    const syotteet = tulokset.map((t) => ({
      tyontekijaId: t.id,
      rivit: (tila.rivit[t.id] ?? []).map(
        (r) => (lomakkeestaSyotteeksi(r) as { rivi: SyoteRivi }).rivi,
      ),
    }));
    const luonnos: PalkkaAjoLuonnos = {
      maksupaiva: tila.maksupaiva,
      kausiAlkaa: tila.kausiAlkaa,
      kausiLoppuu: tila.kausiLoppuu,
      syotteet,
    };
    setTallentaa(true);
    setVirhe(null);
    let tallennettu: StoredTosite;
    try {
      tallennettu = await tallennaPalkkaAjo(client, luonnos, olemassaOlevaId);
    } catch (e) {
      if (e instanceof PalkkaAjoVirhe && e.koodi === 'KESKEN' && e.tositeId !== undefined) {
        setKesken({ id: e.tositeId, viesti: e.message });
        await qc.invalidateQueries({ queryKey: ['tositteet'] });
      } else {
        setVirhe(virheTeksti(e));
      }
      setTallentaa(false);
      return;
    }
    qc.setQueryData(avaimet.tosite(tallennettu.id), tallennettu);
    await Promise.all(
      ['tositteet', 'saldot', 'viennit', 'raportti'].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
    await navigate({ to: '/palkat/$id', params: { id: String(tallennettu.id) } });
  }

  return (
    <div className="flex flex-col gap-6">
      {tiedot.palkkatilit === undefined ? (
        <p
          role="alert"
          aria-label="Maksutili puuttuu"
          className="rounded-[8px] border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--text)]"
        >
          Valitse nettopalkkojen maksutili ennen palkanmaksua:{' '}
          <Link to="/palkat/asetukset" className="font-semibold underline">
            palkka-asetukset
          </Link>
          .
        </p>
      ) : null}

      {ajotVirhe ? (
        <div
          role="alert"
          aria-label="Aiemmat palkka-ajot puuttuvat"
          className="rounded-[8px] border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--text)]"
        >
          Aiempien palkka-ajojen haku epäonnistui, joten verokortin tulokertymää ei voida laskea
          oikein. Tallennus on estetty.{' '}
          <Button variant="sec" size="compact" type="button" onClick={haeAjotUudelleen}>
            Yritä uudelleen
          </Button>
        </div>
      ) : null}

      <fieldset className="flex flex-wrap items-end gap-4">
        <legend className="sr-only">Maksupäivä ja palkkakausi</legend>
        <label className={LABEL_LUOKKA}>
          Maksupäivä
          <input
            type="date"
            aria-label="Maksupäivä"
            value={tila.maksupaiva}
            onChange={(e) => asetaPaiva('maksupaiva', e.target.value)}
            className={`${KENTTA_LUOKKA} tabular-nums`}
          />
        </label>
        <label className={LABEL_LUOKKA}>
          Kausi alkaa
          <input
            type="date"
            aria-label="Kausi alkaa"
            value={tila.kausiAlkaa}
            onChange={(e) => asetaPaiva('kausiAlkaa', e.target.value)}
            className={`${KENTTA_LUOKKA} tabular-nums`}
          />
        </label>
        <label className={LABEL_LUOKKA}>
          Kausi päättyy
          <input
            type="date"
            aria-label="Kausi päättyy"
            value={tila.kausiLoppuu}
            onChange={(e) => asetaPaiva('kausiLoppuu', e.target.value)}
            className={`${KENTTA_LUOKKA} tabular-nums`}
          />
        </label>
        {paivaVirhe ? <p className={`${VIRHE_LUOKKA} pb-2`}>{paivaVirhe}</p> : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
          Henkilöt
        </legend>
        {valittavat.length === 0 ? (
          <p className={VIHJE_LUOKKA}>
            Ei aktiivisia työntekijöitä.{' '}
            <Link to="/palkat/tyontekijat" className="underline">
              Lisää työntekijä
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {valittavat.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={tila.valitut.includes(t.id)}
                  onChange={(e) => valitse(t, e.target.checked)}
                />
                {t.nimi}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {puuttuva ? (
        <div
          role="alert"
          aria-label="Palkkataulukko puuttuu"
          className="rounded-[8px] border border-[var(--warning)] px-4 py-3 text-[13px] text-[var(--text)]"
        >
          Vuoden {(puuttuva as PuuttuvaTaulukko).vuosi} palkkataulukosta puuttuu arvoja (
          {(puuttuva as PuuttuvaTaulukko).puuttuvat.join(', ')}), joten palkkaa ei voi vielä laskea.
          Lisää omat arvot{' '}
          <Link to="/palkat/asetukset" className="font-semibold underline">
            palkka-asetuksiin
          </Link>{' '}
          tai odota, että Penniin päivitetään vuoden viralliset arvot.
        </div>
      ) : null}

      {tulokset.map((t) => {
        const nimi = t.tyontekija?.nimi ?? 'Tuntematon henkilö';
        return (
          <section
            key={t.id}
            aria-label={nimi}
            className="flex flex-col gap-3 border-t border-[var(--border)] pt-4"
          >
            <h2 className="text-[14px] font-[650] text-[var(--text)]">{nimi}</h2>
            <HenkilonRivit
              nimi={nimi}
              rivit={tila.rivit[t.id] ?? []}
              virheet={t.rivivirheet}
              lasketut={t.henkilo?.rivit}
              tilit={tilit}
              oletusKulutili={oletusKulutili}
              onMuutos={(rivit) => setTila((s) => ({ ...s, rivit: { ...s.rivit, [t.id]: rivit } }))}
            />
            {t.henkilo && !puuttuva && !ajotVirhe ? <HenkilonLaskelma henkilo={t.henkilo} /> : null}
            {t.virhe && !puuttuva ? <p className={VIRHE_LUOKKA}>{t.virhe}</p> : null}
          </section>
        );
      })}

      {kaikkiLaskettu && !puuttuva && !ajotVirhe ? (
        <div className="border-t border-[var(--border-strong)] pt-4">
          <AjonSummat henkilot={lasketut} />
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" disabled={!voiTallentaa} onClick={() => void tallenna()}>
          Tallenna
        </Button>
        {negatiivinen ? (
          <p className={VIRHE_LUOKKA}>
            Tallennus on estetty: nettopalkka ei voi olla negatiivinen. Lisää rahapalkkaa tai poista
            etu.
          </p>
        ) : null}
        {virhe ? (
          <p role="alert" className={VIRHE_LUOKKA}>
            {virhe}
          </p>
        ) : null}
        {kesken ? (
          <p role="alert" aria-label="Tallennus kesken" className={VIRHE_LUOKKA}>
            {kesken.viesti}{' '}
            <Link
              to="/palkat/$id"
              params={{ id: String(kesken.id) }}
              className="font-semibold underline"
            >
              Avaa palkanmaksu
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
