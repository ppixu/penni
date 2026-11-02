import { Button } from '@/components/ui/button';
import { AlvValitsin } from '@/editori/AlvValitsin';
import { EuroInput } from '@/editori/EuroInput';
import { KohdennusValitsin } from '@/kohdennukset/KohdennusValitsin';
import {
  type AvoinEnnakko,
  type IsoDate,
  type Kohdennus,
  bruttoYhteensa,
  normalisoiMerkkaukset,
} from '@penni/engine';
import { type Cents, Euro, muotoileEuro } from '@penni/euro';
import { type ReactNode, useState } from 'react';
import {
  type LomakeRivi,
  MYYNTIKOODIT,
  type RiviAction,
  onEnnakonVahennys,
} from './laskuReducer.js';
import { riviTositeRiviksi } from './rakennaLaskuSyote.js';

const OTSIKKO_LUOKKA =
  'px-[10px] pb-[7px] text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

/** Kpl-tekstin normalisointi: suomalainen desimaalipilkku pisteeksi ennen Number()-jäsennystä. */
function jasennaKpl(teksti: string): number {
  return Number(teksti.trim().replace(',', '.'));
}

function kelpaaKpl(kpl: number): boolean {
  return Number.isFinite(kpl) && kpl > 0;
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
                  <input
                    aria-label={`Selite, rivi ${indeksi + 1}`}
                    value={rivi.selite}
                    readOnly={vahennys}
                    onChange={(e) =>
                      dispatch({
                        type: 'setRivi',
                        avain: rivi.avain,
                        muutos: { selite: e.target.value },
                      })
                    }
                    className="w-full bg-transparent outline-none"
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
