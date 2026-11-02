import { Button } from '@/components/ui/button';
import { AlvValitsin } from '@/editori/AlvValitsin';
import { EuroInput } from '@/editori/EuroInput';
import { KohdennusValitsin } from '@/kohdennukset/KohdennusValitsin';
import {
  type AvoinEnnakko,
  type IsoDate,
  type Kohdennus,
  type Tuote,
  bruttoYhteensa,
  normalisoiMerkkaukset,
  riviTuotteesta,
} from '@penni/engine';
import { type Cents, Euro, muotoileEuro } from '@penni/euro';
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';
import {
  type LomakeRivi,
  MYYNTIKOODIT,
  type RiviAction,
  onEnnakonVahennys,
} from './laskuReducer.js';
import { riviTositeRiviksi } from './rakennaLaskuSyote.js';

/** Enintään näin monta tuoteehdotusta kerrallaan. */
const EHDOTUKSIA = 8;

const OTSIKKO_LUOKKA =
  'px-[10px] pb-[7px] text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

/** Kpl-tekstin normalisointi: suomalainen desimaalipilkku pisteeksi ennen Number()-jäsennystä. */
function jasennaKpl(teksti: string): number {
  return Number(teksti.trim().replace(',', '.'));
}

function kelpaaKpl(kpl: number): boolean {
  return Number.isFinite(kpl) && kpl > 0;
}

/** Rivin kentät tuotteen poiminnan jälkeen. `aNetto` on euroina (voi olla alle sentin tarkka):
 *  senttikenttä pyöristetään, mutta `alkuperainenANetto` kantaa tarkan hinnan tallennukseen.
 *  Kpl säilyy; tuotteen kohdennus menee lomakkeen kohdennuskenttään (ilman sitä rivin valinta säilyy),
 *  muut kuin lomakkeen omat kentät (yksikkö, tili, tuote) menevät `lisat`-kenttään. */
function tuotteenMuutos(
  tuote: Tuote,
  pvm: IsoDate,
  alvVelvollinen: boolean,
): Partial<Omit<LomakeRivi, 'avain'>> {
  const { selite, aNetto, alvKoodi, alvProsentti, kohdennus, ...lisat } = riviTuotteesta(
    tuote,
    pvm,
    alvVelvollinen,
  );
  return {
    selite: selite ?? tuote.nimike,
    aNettoSnt: Euro.fromCents(Math.round((aNetto ?? 0) * 100)),
    alkuperainenANetto: aNetto ?? 0,
    alvKoodi: alvKoodi ?? 0,
    alvProsentti: alvProsentti ?? 0,
    ...(kohdennus ? { kohdennus } : {}),
    lisat,
  };
}

/** Tuotteet, joiden nimike tai koodi sisältää hakutekstin (kirjainkoosta riippumatta). */
function ehdotukset(tuotteet: readonly Tuote[], haku: string): Tuote[] {
  const hakusana = haku.trim().toLocaleLowerCase('fi');
  if (hakusana === '') return [];
  return tuotteet
    .filter(
      (t) =>
        t.nimike.toLocaleLowerCase('fi').includes(hakusana) ||
        (t.koodi ?? '').toLocaleLowerCase('fi').includes(hakusana),
    )
    .sort((a, b) => a.nimike.localeCompare(b.nimike, 'fi'))
    .slice(0, EHDOTUKSIA);
}

/**
 * Selite-solu tuoteehdotuksilla (spec §7). Ehdotukset aukeavat kirjoitettaessa; ArrowDown/ArrowUp
 * liikuttavat korostusta, Enter valitsee korostetun (ilman korostusta Enter ei tee mitään, joten
 * vapaa teksti pysyy vapaana), Escape sulkee ja jättää kirjoitetun tekstin. Fokus pysyy kentässä
 * valinnan jälkeen. Ehdotuslista on `position: absolute` solun alla.
 */
function SeliteSolu({
  rivi,
  indeksi,
  pvm,
  alvVelvollinen,
  tuotteet,
  lukittu,
  dispatch,
}: {
  rivi: LomakeRivi;
  indeksi: number;
  pvm: IsoDate;
  alvVelvollinen: boolean;
  tuotteet: readonly Tuote[] | undefined;
  lukittu: boolean;
  dispatch: (action: RiviAction) => void;
}) {
  const [auki, setAuki] = useState(false);
  const [aktiivinen, setAktiivinen] = useState(-1);
  const listaId = useId();
  const osumat = auki && tuotteet ? ehdotukset(tuotteet, rivi.selite) : [];
  const nayta = osumat.length > 0;

  function sulje() {
    setAuki(false);
    setAktiivinen(-1);
  }

  function valitse(tuote: Tuote) {
    dispatch({
      type: 'setRivi',
      avain: rivi.avain,
      muutos: tuotteenMuutos(tuote, pvm, alvVelvollinen),
    });
    sulje();
  }

  function nappain(e: KeyboardEvent<HTMLInputElement>) {
    if (!nayta) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAktiivinen((i) => Math.min(i + 1, osumat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAktiivinen((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const valittu = osumat[aktiivinen];
      if (valittu) {
        e.preventDefault();
        valitse(valittu);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      sulje();
    }
  }

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-label={`Selite, rivi ${indeksi + 1}`}
        aria-autocomplete="list"
        aria-expanded={nayta}
        aria-controls={nayta ? listaId : undefined}
        aria-activedescendant={nayta && aktiivinen >= 0 ? `${listaId}-${aktiivinen}` : undefined}
        autoComplete="off"
        value={rivi.selite}
        readOnly={lukittu}
        onChange={(e) => {
          setAuki(true);
          setAktiivinen(-1);
          dispatch({
            type: 'setRivi',
            avain: rivi.avain,
            muutos: { selite: e.target.value },
          });
        }}
        onKeyDown={nappain}
        onBlur={sulje}
        className="w-full bg-transparent outline-none"
      />
      {nayta && (
        // biome-ignore lint/a11y/useFocusableInteractive: fokus pysyy tekstikentässä; korostus kulkee aria-activedescendantilla
        <div
          id={listaId}
          // biome-ignore lint/a11y/useSemanticElements: tyylitelty ehdotuslista vaatii <div>:n listbox-roolilla; <select> ei salli vapaata tekstiä
          role="listbox"
          aria-label={`Tuoteehdotukset, rivi ${indeksi + 1}`}
          className="absolute left-0 top-full z-10 mt-1 w-max min-w-full max-w-[420px] rounded border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-pop)]"
        >
          {osumat.map((t, i) => (
            <button
              type="button"
              key={t.id}
              id={`${listaId}-${i}`}
              // biome-ignore lint/a11y/useSemanticElements: tyylitelty valintalista vaatii <button>:n option-roolilla (kuten AlvValitsin)
              role="option"
              tabIndex={-1}
              aria-selected={i === aktiivinen}
              // mousedown + preventDefault: kenttä ei menetä fokusta (blur sulkisi listan ennen klikkausta)
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => valitse(t)}
              className={`flex w-full items-baseline justify-between gap-4 whitespace-nowrap rounded px-2 py-1 text-left ${
                i === aktiivinen ? 'bg-[var(--track)]' : 'hover:bg-[var(--track)]'
              }`}
            >
              <span>
                {t.nimike}
                {t.koodi ? <span className="ml-2 text-[var(--text-subtle)]">{t.koodi}</span> : null}
              </span>
              <span className="tabular-nums text-[var(--text-muted)]">
                {muotoileEuro(Euro.fromCents(Math.round(t.aNetto * 100)))}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Kpl-solu: hallittu paikallinen tekstitila (EuroInput-malli, ks. editori/EuroInput.tsx).
 * onChange committoi luvun heti kun teksti jäsentyy kelvolliseksi (äärellinen, > 0) —
 * desimaalipilkku sallitaan ja normalisoidaan pisteeksi ennen jäsennystä (type="number"
 * nielaisisi pilkun, siksi type="text" + inputMode="decimal"). Virheellinen välitila
 * (tyhjä, "0", "abc") ei committoi mitään ja saa aria-invalidin; blur palauttaa näytön
 * viimeksi committoituun määrään, jotta näkyvä arvo ei voi koskaan erota tallennettavasta
 * tilasta — Tallenna-klikkaus blurittaa kentän ensin, joten näytetty ja tallennettava kpl
 * eivät voi hajota (regressio: aiemmin defaultValue+onChange jätti esim. "0":n näkyviin
 * vaikka tila pysyi ennallaan).
 */
function KplSyote({
  rivi,
  indeksi,
  dispatch,
}: {
  rivi: LomakeRivi;
  indeksi: number;
  dispatch: (action: RiviAction) => void;
}) {
  const [teksti, setTeksti] = useState(() => String(rivi.myyntiKpl));
  const [virhe, setVirhe] = useState(false);

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={`Kpl, rivi ${indeksi + 1}`}
      aria-invalid={virhe || undefined}
      value={teksti}
      onChange={(e) => {
        const uusi = e.target.value;
        setTeksti(uusi);
        const kpl = jasennaKpl(uusi);
        if (kelpaaKpl(kpl)) {
          setVirhe(false);
          dispatch({ type: 'setRivi', avain: rivi.avain, muutos: { myyntiKpl: kpl } });
        } else {
          setVirhe(true);
        }
      }}
      onBlur={() => {
        if (!kelpaaKpl(jasennaKpl(teksti))) {
          setTeksti(String(rivi.myyntiKpl));
          setVirhe(false);
        }
      }}
      className="w-full bg-transparent text-right tabular-nums outline-none"
    />
  );
}

/**
 * Ennakon vähennysrivin määrä: positiivinen euromäärä (rivin aNetto on sen vastaluku). Määrän
 * voi laskea nollaan mutta ei nostaa yli ennakon avoimen summan: liian suuri arvo kiinnittyy
 * avoimeen (tai rivin nykyiseen määrään, jos avointa ei tunneta). Kiinnityksessä `versio` pakottaa kentän näyttämään kiinnitetyn arvon, vaikka tila ei muutu.
 */
function VahennysSyote({
  rivi,
  indeksi,
  enintaan,
  dispatch,
}: {
  rivi: LomakeRivi;
  indeksi: number;
  enintaan: Cents;
  dispatch: (action: RiviAction) => void;
}) {
  const [versio, setVersio] = useState(0);
  return (
    <EuroInput
      key={versio}
      arvo={Euro.neg(rivi.aNettoSnt)}
      aria-label={`Ennakon vähennys, rivi ${indeksi + 1}`}
      onCommit={(snt) => {
        const maara = snt > enintaan ? enintaan : snt;
        const aNettoSnt = maara === 0 ? Euro.fromCents(0) : Euro.neg(maara);
        dispatch({
          type: 'setRivi',
          avain: rivi.avain,
          muutos: { aNettoSnt, alkuperainenANetto: aNettoSnt / 100 },
        });
        if (maara !== snt) setVersio((v) => v + 1);
      }}
    />
  );
}

/**
 * Laskurivien muokattava taulukko. Tavallinen tab-järjestys riittää lomakkeelle
 * (kevyempi kuin editorin useGridFocus — laskurivejä on vähän). Yhteensä-solu näyttää
 * rivin brutton samalla engine-funktiolla (bruttoYhteensa) kuin dokumentti.
 * Kohdennus-sarake (valitsin, voimassaolo laskun päivän `pvm` mukaan) näkyy vain, kun
 * `kohdennukset` annetaan ja siinä on ainakin yksi; ostolaskulomake ei anna sitä.
 *
 * `ennakkolasku`: rivien tili on Saadut ennakot (moottori ohittaa rivin oman tilin), joten
 * Tili-sarake näytetään lukulukittuna. `ennakot`: asiakkaan avoimet ennakot, joista
 * vähennysrivin enimmäismäärä johdetaan.
 */
export function LaskuriviTaulukko({
  rivit,
  pvm,
  dispatch,
  koodit = MYYNTIKOODIT,
  kohdennukset = [],
  ennakkolasku = false,
  ennakot = [],
  lisatoiminnot,
  tuotteet,
  alvVelvollinen = true,
}: {
  rivit: readonly LomakeRivi[];
  pvm: IsoDate;
  dispatch: (action: RiviAction) => void;
  koodit?: readonly number[];
  kohdennukset?: readonly Kohdennus[] | undefined;
  ennakkolasku?: boolean;
  ennakot?: readonly AvoinEnnakko[];
  /** Lisää rivi -napin viereen tulevat lomakekohtaiset toiminnot (esim. Hyvitä ennakko). */
  lisatoiminnot?: ReactNode;
  /** Tuoterekisteri: kun annettu, selitekenttä ehdottaa tuotteita kirjoitettaessa (myyntilasku). */
  tuotteet?: readonly Tuote[] | undefined;
  /** Kirja on alv-velvollinen: tuotteen alv kopioituu riville vain silloin. */
  alvVelvollinen?: boolean;
}) {
  const kohdennusSarake = kohdennukset.length > 0;
  return (
    <div>
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            <th className={`${OTSIKKO_LUOKKA} text-left`}>Selite</th>
            {kohdennusSarake ? (
              <th className={`${OTSIKKO_LUOKKA} w-[190px] text-left`}>Kohdennus</th>
            ) : null}
            {ennakkolasku && <th className={`${OTSIKKO_LUOKKA} w-[130px] text-left`}>Tili</th>}
            <th className={`${OTSIKKO_LUOKKA} w-[70px] text-right`}>Kpl</th>
            <th className={`${OTSIKKO_LUOKKA} w-[110px] text-right`}>À-hinta</th>
            <th className={`${OTSIKKO_LUOKKA} w-[160px] text-right`}>ALV</th>
            <th className={`${OTSIKKO_LUOKKA} w-[110px] text-right`}>Yhteensä</th>
            <th className="w-[44px]" />
          </tr>
        </thead>
        <tbody>
          {rivit.map((rivi, indeksi) => {
            const vahennys = onEnnakonVahennys(rivi);
            return (
              <tr key={rivi.avain} className="border-t border-[var(--border)]">
                <td className="px-[10px] py-[6px]">
                  <SeliteSolu
                    rivi={rivi}
                    indeksi={indeksi}
                    pvm={pvm}
                    alvVelvollinen={alvVelvollinen}
                    tuotteet={vahennys ? undefined : tuotteet}
                    lukittu={vahennys}
                    dispatch={dispatch}
                  />
                </td>
                {kohdennusSarake ? (
                  <td className="relative px-[10px] py-[6px]">
                    {vahennys ? null : (
                      <KohdennusValitsin
                        kohdennukset={kohdennukset}
                        pvm={pvm}
                        arvo={{
                          ...(rivi.kohdennus !== undefined ? { kohdennus: rivi.kohdennus } : {}),
                          ...(rivi.merkkaukset !== undefined
                            ? { merkkaukset: rivi.merkkaukset }
                            : {}),
                        }}
                        onMuuta={(arvo) =>
                          dispatch({
                            type: 'setRivi',
                            avain: rivi.avain,
                            muutos: {
                              kohdennus: arvo.kohdennus || undefined,
                              merkkaukset: normalisoiMerkkaukset(arvo.merkkaukset),
                            },
                          })
                        }
                        ariaLabel={`Kohdennus, rivi ${indeksi + 1}`}
                      />
                    )}
                  </td>
                ) : null}
                {ennakkolasku && (
                  <td className="px-[10px] py-[6px] text-[var(--text-muted)]">Saadut ennakot</td>
                )}
                <td className="px-[10px] py-[6px] text-right">
                  {vahennys ? (
                    <span className="tabular-nums">1</span>
                  ) : (
                    <KplSyote rivi={rivi} indeksi={indeksi} dispatch={dispatch} />
                  )}
                </td>
                <td className="px-[10px] py-[6px]">
                  {vahennys ? (
                    <VahennysSyote
                      rivi={rivi}
                      indeksi={indeksi}
                      enintaan={
                        ennakot.find(
                          (e) =>
                            e.tosite === rivi.lisat?.ennakkoTosite &&
                            e.alvProsentti === rivi.alvProsentti,
                        )?.avoin ??
                        // Ennakkoa ei löydy ladatuista (kysely latautuu tai luonnoksen ennakko on
                        // jo kulutettu): määrää saa laskea mutta ei nostaa.
                        Euro.neg(rivi.aNettoSnt)
                      }
                      dispatch={dispatch}
                    />
                  ) : (
                    <EuroInput
                      arvo={rivi.aNettoSnt}
                      aria-label={`À-hinta, rivi ${indeksi + 1}`}
                      onCommit={(snt) =>
                        dispatch({ type: 'setRivi', avain: rivi.avain, muutos: { aNettoSnt: snt } })
                      }
                    />
                  )}
                </td>
                <td className="relative px-[10px] py-[6px] text-right">
                  {vahennys ? (
                    <span className="tabular-nums text-[var(--text-muted)]">
                      Alv {String(rivi.alvProsentti).replace('.', ',')} %
                    </span>
                  ) : (
                    <AlvValitsin
                      rivi={indeksi + 1}
                      alvKoodi={rivi.alvKoodi}
                      alvProsentti={rivi.alvProsentti}
                      pvm={pvm}
                      koodit={koodit}
                      ariaLabel={`ALV, rivi ${indeksi + 1}`}
                      onValitse={(alvKoodi, alvProsentti) =>
                        dispatch({
                          type: 'setRivi',
                          avain: rivi.avain,
                          muutos: { alvKoodi, alvProsentti },
                        })
                      }
                    />
                  )}
                </td>
                <td className="px-[10px] py-[6px] text-right tabular-nums">
                  {muotoileEuro(bruttoYhteensa(riviTositeRiviksi(rivi)))}
                </td>
                <td className="px-[10px] py-[6px] text-right">
                  <Button
                    variant="ghost"
                    size="compact"
                    type="button"
                    aria-label={`Poista rivi ${indeksi + 1}`}
                    onClick={() => dispatch({ type: 'poistaRivi', avain: rivi.avain })}
                  >
                    ✕
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <Button
          variant="sec"
          size="compact"
          type="button"
          onClick={() => dispatch({ type: 'lisaaRivi' })}
        >
          Lisää rivi
        </Button>
        {lisatoiminnot}
      </div>
    </div>
  );
}
