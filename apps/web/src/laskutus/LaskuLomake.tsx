import {
  useAvoimetEnnakot,
  useInit,
  useKirjaaLaskuluonnos,
  useKohdennukset,
  useKumppanit,
  usePoistaLaskuluonnos,
  useTallennaMyyntilasku,
  useTallennaRyhmalasku,
  useTuotteet,
} from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/editori/SegmentedControl';
import { useMuutosseuranta } from '@/tallentamaton/useMuutosseuranta';
import { useTallentamatonVaroitus } from '@/tallentamaton/useTallentamatonVaroitus';
import { laskuVertailuun } from '@/tallentamaton/vertailu';
import { Maksutapa, type StoredTosite, laskuSummat, tiliAsetuksesta } from '@penni/engine';
import { muotoileEuro } from '@penni/euro';
import { useMemo, useReducer, useState } from 'react';
import { KumppaniDialog } from './KumppaniDialog.js';
import { KumppaniValitsin } from './KumppaniValitsin.js';
import { LaskuriviTaulukko } from './LaskuriviTaulukko.js';
import { VastaanottajaLista } from './VastaanottajaLista.js';
import {
  type LaskuTila,
  alustaLaskuTila,
  alustaLaskuTilaLuonnoksesta,
  laskuReducer,
} from './laskuReducer.js';
import {
  laskuLomakeVirhe,
  luonnoksenSailytettavat,
  rakennaLaskuSyote,
  riviHinnaton,
  riviTositeRiviksi,
} from './rakennaLaskuSyote.js';

/** Muutosseurannan vertailuprojektio: laskulomake + ryhmälaskun vastaanottajat. */
function lomakeVertailuun(x: { tila: LaskuTila; vastaanottajat: number[] }) {
  return { tila: laskuVertailuun(x.tila), vastaanottajat: x.vastaanottajat };
}

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA_LUOKKA =
  'rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]';

const MAKSUTAVAT = [
  { arvo: Maksutapa.LASKU, label: 'Lasku' },
  { arvo: Maksutapa.KATEINEN, label: 'Käteinen' },
  { arvo: Maksutapa.KORTTIMAKSU, label: 'Korttimaksu' },
  { arvo: Maksutapa.ENNAKKOLASKU, label: 'Ennakkolasku' },
];

/** Prosentti suomalaisella desimaalipilkulla (25.5 → '25,5'). */
function prosenttiTeksti(prosentti: number): string {
  return String(prosentti).replace('.', ',');
}

/** Olemassa olevan luonnoksen muokkaustila: lomake latautuu luonnoksesta, ja toiminnot ovat
 *  Tallenna, Kirjaa ja lataa PDF sekä Poista. */
export interface LuonnosToiminnot {
  tosite: StoredTosite;
  /** Luonnos on kirjattu; kutsuja lataa PDF:n ja siirtää näkymän kirjattuun laskuun. */
  onKirjattu: (kirjattu: StoredTosite) => Promise<void>;
  /** Luonnos on poistettu. */
  onPoistettu: () => void;
}

/**
 * Koko laskulomake. Live-summat lasketaan samoilla engine-funktioilla kuin syötteen
 * saama TositeRivi (laskuSummat ~ generoiLaskunViennit) — ei omaa rinnakkaista
 * rahalaskentaa. Moottori numeroi (numero, viite) ja generoi viennit vasta kirjauksessa.
 *
 * Uusi lasku: "Tallenna luonnokseksi" (ei numeroa, ei vientejä) tai "Tallenna ja kirjaa".
 * Ryhmälasku (`ryhmalasku`, spec §6.2): asiakasvalitsimen tilalla on vastaanottajalista ja lomake
 * tallennetaan yhtenä luonnoksena per vastaanottaja (`tallennaRyhmalasku`); kirjaus tehdään
 * Lähtevät-välilehdellä. Ennakon hyvitys ei ole tarjolla, koska ennakko on asiakaskohtainen.
 * Muokkaustila (`luonnos`): Tallenna, Kirjaa ja lataa PDF, Poista. Luonnos tallennetaan ja
 * kirjataan aina lomakkeen laskupäivällä (`laskupvm` lähtee eksplisiittisesti), jottei
 * luonnokseen jäänyt vanha päivä päädy kirjattuun laskuun.
 */
export function LaskuLomake({
  alkupaiva,
  alvVelvollinen,
  onTallennettu,
  onLuonnosTallennettu,
  ryhmalasku = false,
  onRyhmaTallennettu,
  luonnos,
}: {
  alkupaiva: string;
  alvVelvollinen: boolean;
  /** Uusi lasku kirjattu. */
  onTallennettu?: (id: number) => void;
  /** Uusi lasku tallennettu luonnokseksi. */
  onLuonnosTallennettu?: (id: number) => void;
  /** Uusi ryhmälasku: vastaanottajalista asiakasvalitsimen tilalla, vain luonnoksina. */
  ryhmalasku?: boolean;
  /** Ryhmälaskun luonnokset tallennettu. */
  onRyhmaTallennettu?: (luonnokset: StoredTosite[]) => void;
  luonnos?: LuonnosToiminnot;
}) {
  const [tila, dispatch] = useReducer(
    laskuReducer,
    { laskupvm: alkupaiva, alvVelvollinen, luonnos: luonnos?.tosite },
    ({ luonnos: l, ...alustus }) =>
      l ? alustaLaskuTilaLuonnoksesta(l, alustus.alvVelvollinen) : alustaLaskuTila(alustus),
  );
  const { data: kumppanit } = useKumppanit();
  const { data: kohdennukset } = useKohdennukset();
  const { data: tuotteet } = useTuotteet();
  const { data: init } = useInit();
  const ennakkoTili = init ? tiliAsetuksesta(init.asetukset, 'LaskuEnnakkotili') : undefined;
  const { data: avoimetEnnakot } = useAvoimetEnnakot(ryhmalasku ? undefined : tila.kumppani);
  const [vastaanottajat, setVastaanottajat] = useState<number[]>([]);
  const { tallenna, virheviesti, tallentaa } = useTallennaMyyntilasku();
  const {
    tallenna: tallennaRyhma,
    virheviesti: ryhmaVirhe,
    tallentaa: tallentaaRyhmaa,
  } = useTallennaRyhmalasku();
  const { kirjaa, virheviesti: kirjausVirhe, kirjaamassa } = useKirjaaLaskuluonnos();
  const { poista, virheviesti: poistoVirhe, poistaa } = usePoistaLaskuluonnos();
  const [huomio, setHuomio] = useState<string | null>(null);
  const [dialogiAuki, setDialogiAuki] = useState(false);
  const [ennakkoValintaAuki, setEnnakkoValintaAuki] = useState(false);
  const seurattava = useMemo(() => ({ tila, vastaanottajat }), [tila, vastaanottajat]);
  const { onkoLikainen, asetaPohja } = useMuutosseuranta(seurattava, lomakeVertailuun);
  const varoitus = useTallentamatonVaroitus(onkoLikainen);

  const summat = useMemo(() => laskuSummat(tila.rivit.map(riviTositeRiviksi)), [tila.rivit]);

  // Estosäännöt (spec §3.3): ei summallista riviä TAI LASKU ilman asiakasta TAI kesken.
  // Kumppania ei vaadita käteis-/korttimyynnille (kuitti, ei saatavaa) — UI-tason sääntö.
  // Sama koskee eräpäivää: tyhjäksi tyhjennetty <input type="date"> (tila.erapvm === '')
  // estää tallennuksen LASKU-maksutavalla — muuten rakennaLaskuSyote jättäisi eräpäivän
  // pois tallennettavasta laskusta huomaamatta (ks. rakennaLaskuSyote.ts). Käteis-/
  // korttikuitilla eräpäivää ei tarvita, joten se saa jäädä tyhjäksi.
  const eiSummaa = tila.rivit.every(riviHinnaton);
  // Ennakkolasku on saatava kuten lasku: se tarvitsee asiakkaan (moottorin EIKUMPPANIA) ja eräpäivän.
  const saatava = tila.maksutapa === Maksutapa.LASKU || tila.maksutapa === Maksutapa.ENNAKKOLASKU;
  const asiakasPuuttuu = saatava && tila.kumppani === undefined;
  const erapvmPuuttuu = saatava && tila.erapvm === '';
  const onEnnakkolasku = tila.maksutapa === Maksutapa.ENNAKKOLASKU;
  // "Hyvitä ennakko": vain muulla kuin ennakkolaskulla; asiakkaan avoimista ennakoista ne, joita
  // ei vielä ole vähennetty tällä laskulla (yksi vähennysrivi per ennakko ja verokanta).
  const valittavatEnnakot = onEnnakkolasku
    ? []
    : (avoimetEnnakot ?? []).filter(
        (e) =>
          !tila.rivit.some(
            (r) => r.lisat?.ennakkoTosite === e.tosite && r.alvProsentti === e.alvProsentti,
          ),
      );
  const lomakeVirhe = laskuLomakeVirhe(tila);
  const tyossa = tallentaa || tallentaaRyhmaa || kirjaamassa || poistaa;
  // Luonnos on keskeneräinen työ: se tarvitsee vain summallisen rivin ja kelvollisen jakson.
  // Kirjaus vaatii lisäksi asiakkaan ja eräpäivän.
  const luonnosEstetty = eiSummaa || lomakeVirhe !== null || tyossa;
  const ryhmaEstetty = luonnosEstetty || vastaanottajat.length === 0;
  const estetty = luonnosEstetty || asiakasPuuttuu || erapvmPuuttuu;

  const sailytettavat = useMemo(
    () => (luonnos ? luonnoksenSailytettavat(luonnos.tosite) : {}),
    [luonnos],
  );

  /** Tallenna luonnoksena: uusi luonnos tai olemassa olevan päivitys (sama id, joten erä- ja
   *  tunnisteavain säilyy). Palauttaa tallennetun tositteen tai undefined virheessä. */
  async function tallennaLuonnoksena() {
    setHuomio(null);
    const stored = await tallenna({
      ...rakennaLaskuSyote(tila, sailytettavat),
      luonnos: true,
      ...(luonnos ? { id: luonnos.tosite.id } : {}),
    });
    if (stored) asetaPohja({ tila, vastaanottajat }); // puhdas ennen navigointia, ettei tallennus laukaise varoitusta
    return stored;
  }

  async function lahetaLuonnokseksi() {
    const stored = await tallennaLuonnoksena();
    if (!stored) return;
    if (luonnos) setHuomio('Luonnos tallennettu');
    else onLuonnosTallennettu?.(stored.id);
  }

  /** Ryhmälasku: yksi luonnos per vastaanottaja; `ryhma` tulee selaimelta, jotta moottori on deterministinen. */
  async function lahetaRyhmalasku() {
    setHuomio(null);
    const { kumppani: _kumppani, luonnos: _luonnos, id: _id, ...pohja } = rakennaLaskuSyote(tila);
    const luodut = await tallennaRyhma({
      ...pohja,
      kumppanit: vastaanottajat,
      ryhma: crypto.randomUUID(),
    });
    if (!luodut) return;
    asetaPohja({ tila, vastaanottajat });
    onRyhmaTallennettu?.(luodut);
  }

  async function lahetaKirjaus() {
    const stored = await tallenna(rakennaLaskuSyote(tila));
    if (!stored) return;
    asetaPohja({ tila, vastaanottajat });
    onTallennettu?.(stored.id);
  }

  /** Muokkaustilan "Kirjaa ja lataa PDF": tallenna lomake luonnokseen, kirjaa se lomakkeen
   *  laskupäivällä ja anna kirjattu lasku kutsujalle PDF:n latausta varten. */
  async function kirjaaLuonnos() {
    if (!luonnos) return;
    const tallennettu = await tallennaLuonnoksena();
    if (!tallennettu) return;
    const kirjattu = await kirjaa(luonnos.tosite.id, { laskupvm: tila.laskupvm });
    if (!kirjattu) return;
    await luonnos.onKirjattu(kirjattu);
  }

  async function poistaLuonnos() {
    if (!luonnos) return;
    if (!window.confirm('Poistetaanko laskuluonnos? Poisto kirjataan tositelokiin.')) return;
    if (!(await poista(luonnos.tosite.id))) return;
    asetaPohja({ tila, vastaanottajat });
    luonnos.onPoistettu();
  }

  const virhe = lomakeVirhe ?? virheviesti ?? ryhmaVirhe ?? kirjausVirhe ?? poistoVirhe;

  return (
    <>
      <TopBar
        otsikko={luonnos ? 'Lasku (luonnos)' : ryhmalasku ? 'Uusi ryhmälasku' : 'Uusi lasku'}
      />
      <section
        aria-label="laskulomake"
        className="flex flex-1 flex-col gap-4 overflow-auto px-[22px] py-5"
      >
        <div className="grid max-w-3xl grid-cols-[160px_160px_auto] items-end gap-3">
          <label className={LABEL_LUOKKA}>
            Laskun päivämäärä
            <input
              type="date"
              aria-label="Laskun päivämäärä"
              value={tila.laskupvm}
              onChange={(e) => dispatch({ type: 'setLaskupvm', pvm: e.target.value })}
              className={`${KENTTA_LUOKKA} tabular-nums`}
            />
          </label>
          <label className={LABEL_LUOKKA}>
            Eräpäivä
            <input
              type="date"
              aria-label="Eräpäivä"
              value={tila.erapvm}
              onChange={(e) => dispatch({ type: 'setErapvm', pvm: e.target.value })}
              className={`${KENTTA_LUOKKA} tabular-nums`}
            />
          </label>
          <SegmentedControl
            nimi="Maksutapa"
            vaihtoehdot={MAKSUTAVAT}
            arvo={tila.maksutapa}
            onMuutos={(m) => dispatch({ type: 'setMaksutapa', maksutapa: m })}
          />
        </div>
        <div className="grid max-w-3xl grid-cols-[160px_160px_auto] items-end gap-3">
          <label className={LABEL_LUOKKA}>
            Laskutusjakso alkaa
            <input
              type="date"
              aria-label="Laskutusjakso alkaa"
              value={tila.jaksoAlkaa}
              onChange={(e) => dispatch({ type: 'setJaksoAlkaa', pvm: e.target.value })}
              className={`${KENTTA_LUOKKA} tabular-nums`}
            />
          </label>
          <label className={LABEL_LUOKKA}>
            Laskutusjakso loppuu
            <input
              type="date"
              aria-label="Laskutusjakso loppuu"
              value={tila.jaksoLoppuu}
              onChange={(e) => dispatch({ type: 'setJaksoLoppuu', pvm: e.target.value })}
              className={`${KENTTA_LUOKKA} tabular-nums`}
            />
          </label>
          <p className="pb-2 text-[11.5px] text-[var(--text-subtle)]">
            Valinnainen: ajanjakso, jolta lasku on (esim. kuukausi).
          </p>
        </div>
        <div className="grid max-w-3xl grid-cols-2 gap-3">
          {ryhmalasku ? null : (
            <div className={LABEL_LUOKKA}>
              Asiakas
              <KumppaniValitsin
                kumppanit={kumppanit ?? []}
                arvo={tila.kumppani}
                ariaLabel="Asiakas"
                onValitse={(id) => dispatch({ type: 'setKumppani', kumppani: id })}
                onUusiAsiakas={() => setDialogiAuki(true)}
              />
            </div>
          )}
          <label className={LABEL_LUOKKA}>
            Otsikko
            <input
              type="text"
              aria-label="Otsikko"
              value={tila.otsikko}
              onChange={(e) => dispatch({ type: 'setOtsikko', otsikko: e.target.value })}
              className={KENTTA_LUOKKA}
            />
          </label>
        </div>

        {ryhmalasku && (
          <div className="flex max-w-3xl flex-col gap-1">
            <div className={LABEL_LUOKKA}>Vastaanottajat</div>
            <VastaanottajaLista
              kumppanit={kumppanit ?? []}
              valitut={vastaanottajat}
              onMuutos={setVastaanottajat}
            />
          </div>
        )}

        <LaskuriviTaulukko
          rivit={tila.rivit}
          pvm={tila.laskupvm}
          dispatch={dispatch}
          kohdennukset={kohdennukset}
          ennakkolasku={onEnnakkolasku}
          tuotteet={tuotteet}
          alvVelvollinen={tila.alvVelvollinen}
          ennakot={avoimetEnnakot ?? []}
          lisatoiminnot={
            !ryhmalasku && valittavatEnnakot.length > 0 ? (
              <div className="relative">
                <Button
                  variant="sec"
                  size="compact"
                  type="button"
                  disabled={ennakkoTili === undefined}
                  title={ennakkoTili === undefined ? 'Ennakkotili puuttuu asetuksista' : undefined}
                  aria-expanded={ennakkoValintaAuki}
                  onClick={() => setEnnakkoValintaAuki((auki) => !auki)}
                >
                  Hyvitä ennakko
                </Button>
                {ennakkoValintaAuki && (
                  <ul
                    aria-label="Avoimet ennakot"
                    className="absolute left-0 top-full z-10 mt-1 flex min-w-[320px] flex-col gap-1 rounded-[var(--radius-input)] border border-[var(--border-strong)] bg-[var(--surface)] p-2 shadow-md"
                  >
                    {valittavatEnnakot.map((e) => (
                      <li key={`${e.tosite}/${e.alvProsentti}`}>
                        <Button
                          variant="ghost"
                          size="compact"
                          type="button"
                          className="w-full justify-between"
                          onClick={() => {
                            dispatch({
                              type: 'lisaaEnnakonHyvitys',
                              ennakko: e,
                              tili: ennakkoTili,
                            });
                            setEnnakkoValintaAuki(false);
                          }}
                        >
                          {`Ennakkolasku ${e.numero ?? e.tosite} · alv ${prosenttiTeksti(e.alvProsentti)} % · avoin ${muotoileEuro(e.avoin)}`}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : undefined
          }
        />

        {virhe ? (
          <p role="alert" className="text-[12.5px] text-[var(--danger)]">
            {virhe}
          </p>
        ) : null}
        {huomio ? (
          <output className="text-[12.5px] text-[var(--text-muted)]">{huomio}</output>
        ) : null}

        <div
          aria-label="summat"
          className="mt-auto flex items-end justify-between border-t border-[var(--border)] pt-4"
        >
          <div className="flex w-[280px] flex-col gap-1 text-[13px] tabular-nums">
            <div className="flex justify-between gap-8">
              <span>Yhteensä veroton</span>
              <span>{muotoileEuro(summat.netto)}</span>
            </div>
            {summat.erittely.map((e) => (
              <div
                key={e.prosentti}
                className="flex justify-between gap-8 text-[var(--text-muted)]"
              >
                <span>Alv {prosenttiTeksti(e.prosentti)} %</span>
                <span>{muotoileEuro(e.vero)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-8 font-[650]">
              <span>Verollinen yhteensä</span>
              <span>{muotoileEuro(summat.brutto)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {luonnos ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={tyossa}
                  onClick={() => void poistaLuonnos()}
                >
                  Poista
                </Button>
                <Button
                  type="button"
                  variant="sec"
                  disabled={luonnosEstetty}
                  onClick={() => void lahetaLuonnokseksi()}
                >
                  Tallenna
                </Button>
                <Button type="button" disabled={estetty} onClick={() => void kirjaaLuonnos()}>
                  Kirjaa ja lataa PDF
                </Button>
              </>
            ) : ryhmalasku ? (
              <Button type="button" disabled={ryhmaEstetty} onClick={() => void lahetaRyhmalasku()}>
                Tallenna luonnoksiksi
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="sec"
                  disabled={luonnosEstetty}
                  onClick={() => void lahetaLuonnokseksi()}
                >
                  Tallenna luonnokseksi
                </Button>
                <Button type="button" disabled={estetty} onClick={() => void lahetaKirjaus()}>
                  Tallenna ja kirjaa
                </Button>
              </>
            )}
          </div>
        </div>

        {dialogiAuki && (
          <KumppaniDialog
            onValittu={(id) => {
              dispatch({ type: 'setKumppani', kumppani: id });
              setDialogiAuki(false);
            }}
            onPeruuta={() => setDialogiAuki(false)}
          />
        )}
        {varoitus}
      </section>
    </>
  );
}
