import { useInit, useRaportti } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { KuukausiRaportti } from '@/raportit/KuukausiRaportti';
import { Laskut } from '@/raportit/Laskut';
import { Lataustila } from '@/raportit/Lataustila';
import { Paakirja } from '@/raportit/Paakirja';
import { Paivakirja } from '@/raportit/Paivakirja';
import { RaporttiTaulu } from '@/raportit/RaporttiTaulu';
import { TaseErittely } from '@/raportit/TaseErittely';
import { Tililuettelo } from '@/raportit/Tililuettelo';
import { Tositeluettelo } from '@/raportit/Tositeluettelo';
import type { RaporttiProps, Tilirajaus } from '@/raportit/raporttiProps';
import {
  alaryhmanOtsikko,
  etuliitteenNumero,
  lueTiliHaku,
  ryhmanOtsikko,
} from '@/tilikartta/tilinakyma';
import { useValittuTilikausi } from '@/tilikausi/valittuTilikausi';
import { type RaporttiParams, lataaKartta, nimi } from '@penni/engine';
import { muotoilePvm } from '@penni/euro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { type ComponentType, useId, useMemo, useState } from 'react';

/**
 * Osoitteen hakuparametrit: `raportti` valitsee raportin, ja pääkirjan voi rajata yhteen tiliin
 * (`tili`) tai tiliryhmään etuliitteellä (`tiliryhma=11` = tilit 1100–1199), esim. tilikartan
 * riviltä `/raportit?raportti=paakirja&tili=1910`.
 */
interface RaportitHaku {
  raportti?: string | undefined;
  tili?: number | undefined;
  tiliryhma?: number | undefined;
}

export const Route = createFileRoute('/raportit')({
  validateSearch: (haku: Record<string, unknown>): RaportitHaku => {
    const ryhma = lueTiliHaku(haku.tiliryhma);
    return {
      raportti: typeof haku.raportti === 'string' ? haku.raportti : undefined,
      tili: lueTiliHaku(haku.tili),
      tiliryhma: ryhma !== undefined && ryhma < 100 ? ryhma : undefined,
    };
  },
  component: Raportit,
});

interface Raportti {
  avain: string;
  nimi: string;
  /** "Mikä tämä on?" -ohje: mitä raportti näyttää ja mihin sitä käytetään. */
  selite: string;
  /** Tase- tai tuloslaskelmakaavaa käyttävä raportti: 'tase' tai 'tulos'. */
  kaava?: 'tase' | 'tulos';
  /** Tilanne yhtenä päivänä (kauden lopussa): tulosteen otsikossa päivä eikä jakso. */
  tilanneLopussa?: boolean;
  /** Raportin voi rajata tiliin tai tiliryhmään (osoitteen tili/tiliryhma). */
  tilirajaus?: boolean;
  Nakyma: ComponentType<RaporttiProps>;
}

/**
 * Raporttivalikko Kitsaksen järjestyksessä (raporttisivu.cpp:67-112). Kustannuspaikat,
 * projektit, budjettivertailu ja myynti puuttuvat, koska Pennissä ei vielä ole kohdennuksia,
 * budjetteja eikä tuoterekisteriä.
 */
const RAPORTIT: readonly Raportti[] = [
  {
    avain: 'paivakirja',
    nimi: 'Päiväkirja',
    selite:
      'Kaikki kirjaukset aikajärjestyksessä tosite kerrallaan: päivä, tosite, tilit ja summat. Kirjanpitolain vaatima peruskirja, josta näet mitä milloinkin on kirjattu.',
    Nakyma: Paivakirja,
  },
  {
    avain: 'paakirja',
    nimi: 'Pääkirja',
    selite:
      'Kirjaukset tileittäin: jokaisen tilin tapahtumat ja saldo. Tästä näet, mistä tilin saldo koostuu, esim. kun pankkitilin saldo ei täsmää tiliotteeseen. Tilikartan kirja-kuvake avaa pääkirjan yhdelle tilille.',
    tilirajaus: true,
    Nakyma: Paakirja,
  },
  {
    avain: 'tositeluettelo',
    nimi: 'Tositeluettelo',
    selite:
      'Tositteet numerojärjestyksessä: numero, päivä, otsikko ja summa. Osoittaa, ettei numerosarjasta puutu tositteita, ja toimii kirjanpidon sisällysluettelona.',
    Nakyma: Tositeluettelo,
  },
  {
    avain: 'tase',
    nimi: 'Tase',
    selite:
      'Yrityksen taloudellinen tilanne tilikauden lopussa. Vastaavaa = mitä yritys omistaa ja mitä sille ollaan velkaa; vastattavaa = mistä ne on rahoitettu (oma pääoma ja velat). Molempien puolien summa on aina sama.',
    kaava: 'tase',
    tilanneLopussa: true,
    Nakyma: KaavaRaportti,
  },
  {
    avain: 'tulos',
    nimi: 'Tuloslaskelma',
    selite:
      'Tilikauden tulot ja kulut ryhmittäin sekä niiden erotus eli voitto tai tappio. Kertoo, kannattiko toiminta kauden aikana.',
    kaava: 'tulos',
    Nakyma: KaavaRaportti,
  },
  {
    avain: 'tase-kk',
    nimi: 'Tase kuukausittain',
    selite:
      'Tase jokaisen kuukauden lopussa rinnakkain. Näet, miten rahat, saatavat, velat ja oma pääoma kehittyvät kauden mittaan.',
    kaava: 'tase',
    Nakyma: KuukausiRaportti,
  },
  {
    avain: 'tulos-kk',
    nimi: 'Tuloslaskelma kuukausittain',
    selite:
      'Tulot ja kulut kuukausi kerrallaan rinnakkain. Näet kausivaihtelun ja sen, minkä kuukauden luvut poikkeavat muista.',
    kaava: 'tulos',
    Nakyma: KuukausiRaportti,
  },
  {
    avain: 'tase-erittely',
    nimi: 'Tase-erittely',
    selite:
      'Taseen tilien saldot eriteltyinä tilikauden lopussa: mistä kunkin tilin loppusaldo koostuu, esim. avoimet laskut tai käyttöomaisuus. Tilinpäätökseen kuuluva liite, jota ei julkaista.',
    tilanneLopussa: true,
    Nakyma: TaseErittely,
  },
  {
    avain: 'tililuettelo',
    nimi: 'Tililuettelo',
    selite:
      'Luettelo kirjanpidossa käytetyistä tileistä otsikoineen. Kuuluu kirjanpitoaineistoon, joka säilytetään kirjanpidon mukana.',
    Nakyma: Tililuettelo,
  },
  {
    avain: 'laskut',
    nimi: 'Laskut',
    selite:
      'Myynti- ja ostolaskut eräpäivineen ja maksamatta olevine summineen. Oletuksena vain kauden lopussa avoimet laskut: kuka on sinulle velkaa ja mitä sinun pitää vielä maksaa.',
    Nakyma: Laskut,
  },
];

/**
 * Lajin kaava: yleinen, jos kirjassa on sellainen (Kitsaksen oletus, tasetulosraportti.cpp:154),
 * muuten ensimmäinen lajinsa kaava. Pien-, mikro- ja PMA-kaavat ovat yleisen tiivistelmiä, joten
 * niitä ei tarjota erikseen.
 */
function kaavaAvain(asetukset: Record<string, string>, laji: 'tase' | 'tulos'): string | undefined {
  const avaimet = Object.keys(asetukset)
    .filter((a) => a.startsWith(`${laji}/`))
    .sort();
  return avaimet.includes(`${laji}/yleinen`) ? `${laji}/yleinen` : avaimet[0];
}

function Raportit() {
  const { data: init } = useInit();
  const navigate = useNavigate();
  const haku = Route.useSearch();
  const valittu = haku.raportti ?? 'tase';
  // Raportin vaihto pudottaa tilirajauksen.
  function setValittu(raportti: string): void {
    void navigate({ to: '/raportit', search: { raportti }, replace: true });
  }
  // Kausi tulee sivupalkin tilikausivalinnasta (tilikausi/valittuTilikausi.ts).
  const { kausi } = useValittuTilikausi();
  // Tilikohtaiset erittelyt (Kitsas: "Tulosta tilikohtaiset erittelyt").
  const [naytaTilit, setNaytaTilit] = useState(true);

  // Kaavaraportti näkyy valikossa vain, jos kirjassa on sen lajin kaava.
  const lista = useMemo(
    () => RAPORTIT.filter((r) => !r.kaava || (init && kaavaAvain(init.asetukset, r.kaava))),
    [init],
  );
  // Oletuksena tase; jos kirjassa ei ole tasekaavaa, ensimmäinen kaavaraportti.
  const raportti = lista.find((r) => r.avain === valittu) ?? lista.find((r) => r.kaava) ?? lista[0];
  const muoto = raportti?.kaava && init ? kaavaAvain(init.asetukset, raportti.kaava) : undefined;
  const rajattava = raportti?.tilirajaus === true;
  const rajaus = useMemo<Tilirajaus | undefined>(() => {
    if (!rajattava) return undefined;
    if (haku.tili !== undefined) return { tili: haku.tili };
    if (haku.tiliryhma !== undefined) return { tiliryhma: String(haku.tiliryhma) };
    return undefined;
  }, [rajattava, haku.tili, haku.tiliryhma]);
  const rajauksenNimi = useMemo(() => {
    if (!rajaus || !init) return '';
    const kartta = lataaKartta(init.tilit);
    if ('tili' in rajaus) {
      const tili = kartta.find((t) => t.otsikkotaso === 0 && t.numero === rajaus.tili);
      return `Tili ${rajaus.tili}${tili ? ` ${nimi(tili)}` : ''}`;
    }
    const e = rajaus.tiliryhma;
    const otsikko = e.length === 1 ? ryhmanOtsikko(kartta, Number(e)) : alaryhmanOtsikko(kartta, e);
    return `Tilit ${etuliitteenNumero(e)}–${e.padEnd(4, '9')}${otsikko ? ` ${otsikko}` : ''}`;
  }, [rajaus, init]);

  return (
    <>
      <TopBar otsikko="Raportit" />
      <section aria-label="raportti" className="flex-1 overflow-auto px-[22px] py-5">
        <div className="mb-5 flex flex-wrap items-end gap-5 print:hidden">
          <label className={VALITSIN_OTSIKKO}>
            Raportti
            <select
              aria-label="Raportti"
              value={raportti?.avain ?? ''}
              onChange={(e) => setValittu(e.target.value)}
              className={VALITSIN}
            >
              {lista.map((r) => (
                <option key={r.avain} value={r.avain}>
                  {r.nimi}
                </option>
              ))}
            </select>
          </label>
          {raportti && <RaportinOhje teksti={raportti.selite} />}
          {raportti?.kaava && (
            <label className="flex items-center gap-2 pb-2 text-[12.5px] text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={naytaTilit}
                onChange={(e) => setNaytaTilit(e.target.checked)}
              />
              Näytä tilit
            </label>
          )}
          {rajaus && (
            <div className="flex items-center gap-2 pb-[3px] text-[12.5px]">
              <span className="rounded-[6px] bg-[var(--accent-soft)] px-[10px] py-[5px] font-medium text-[var(--accent)]">
                {rajauksenNimi}
              </span>
              <Button variant="sec" size="compact" onClick={() => setValittu(valittu)}>
                Kaikki tilit
              </Button>
            </div>
          )}
        </div>
        {/* Tulosteessa valitsimet piilotetaan (ks. TopBar) — yritys, raportin nimi ja kausi (tase:
            tilanne kauden lopussa) otsikoksi. */}
        {raportti && kausi && (
          <h1 className="mb-4 hidden text-[15px] font-semibold print:block">
            {[
              init?.asetukset.Nimi,
              raportti.tilanneLopussa
                ? `${raportti.nimi} ${muotoilePvm(kausi.loppuu)}`
                : `${raportti.nimi} ${muotoilePvm(kausi.alkaa)} – ${muotoilePvm(kausi.loppuu)}`,
            ]
              .filter(Boolean)
              .join(' – ')}
          </h1>
        )}
        {raportti && kausi ? (
          <raportti.Nakyma
            key={raportti.avain}
            alkupvm={kausi.alkaa}
            loppupvm={kausi.loppuu}
            naytaTilit={naytaTilit}
            {...(muoto ? { muoto } : {})}
            {...(rajaus ? { tilirajaus: rajaus } : {})}
          />
        ) : (
          <p className="text-[13px] text-[var(--text-muted)]">Ladataan…</p>
        )}
      </section>
    </>
  );
}

/**
 * "Mikä tämä on?" valitsimen vieressä: selite aukeaa heti hiiren alla tai näppäimistöllä
 * kohdistettaessa (title-vihje viivästyisi ja jäisi tyylittömäksi).
 */
function RaportinOhje({ teksti }: { teksti: string }) {
  const id = useId();
  return (
    <span className="group relative pb-2">
      <button
        type="button"
        aria-describedby={id}
        className="inline-flex items-center gap-[5px] rounded-[4px] text-[12.5px] text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Info size={14} aria-hidden />
        Mikä tämä on?
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-10 mt-[-2px] w-[340px] rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-[12px] py-[10px] text-[12.5px] leading-[1.5] text-[var(--text)] opacity-0 shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {teksti}
      </span>
    </span>
  );
}

const VALITSIN_OTSIKKO =
  'flex max-w-xs flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const VALITSIN =
  'rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] normal-case tracking-normal font-normal text-[var(--text)]';

/** Tase tai tuloslaskelma kirjan kaavalla; tase kauden lopussa, tuloslaskelma koko kaudelta. */
function KaavaRaportti({ alkupvm, loppupvm, muoto, naytaTilit }: RaporttiProps) {
  const tase = muoto?.startsWith('tase/') ?? false;
  const params: RaporttiParams = muoto
    ? tase
      ? { muoto, pvm: loppupvm, erittelyt: true }
      : { muoto, pvm: loppupvm, alkupvm, erittelyt: true }
    : { muoto: '', pvm: '' };
  // Erittelyt haetaan aina mukaan ja suodatetaan näkymässä, jolloin valinnan vaihto ei käynnistä
  // uutta kyselyä.
  const { data: kaikkiRivit, isError } = useRaportti(params, Boolean(muoto));
  const rivit = useMemo(
    () => (naytaTilit ? kaikkiRivit : kaikkiRivit?.filter((r) => r.tili === undefined)),
    [kaikkiRivit, naytaTilit],
  );
  return rivit ? <RaporttiTaulu rivit={rivit} /> : <Lataustila virhe={isError} />;
}
