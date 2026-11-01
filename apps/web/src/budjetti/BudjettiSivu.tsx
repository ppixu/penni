import { useBudjetti, useInit, useKohdennukset, useTallennaBudjetti } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { EuroInput } from '@/editori/EuroInput';
import { useMuutosseuranta } from '@/tallentamaton/useMuutosseuranta';
import { useTallentamatonVaroitus } from '@/tallentamaton/useTallentamatonVaroitus';
import { PIILOTETUT_AVAIN, lueTiliLista } from '@/tilikartta/tilisuosio';
import { jarjesta, paikallinenTanaan } from '@/tositteet/pikavalinnat';
import {
  type BudjettiRivi,
  type Kohdennus,
  KohdennusTyyppi,
  ResourceError,
  type Tili,
  type Tilikausi,
  YLEINEN_ID,
  erotteleBudjetoitavat,
  kohdennuksenPolku,
  lataaKartta,
  luonnollinenEtumerkki,
  nimi,
} from '@penni/engine';
import { Euro, EuroParseError, muotoileEuro, muotoilePvm } from '@penni/euro';
import { useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import {
  asetaBudjetti,
  budjetoitavatKohdennukset,
  budjettiVertailuun,
  budjettiYhteenveto,
  edellinenTilikausi,
  kopioiEdellinen,
  naytettavatTilit,
  oletusTilikausi,
  rakennaBudjettiTaulukko,
} from './budjettiTaulukko';

const VALITSIN =
  'rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] text-[var(--text)]';
const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

const VIRHEELLINEN_SOLU = 'Korjaa virheellinen summa ennen tallennusta.';

const KORVAUSVAHVISTUS =
  'Korvataanko syötetty budjetti edellisen tilikauden budjetilla? Kaikkien kohdennusten nykyiset luvut korvataan.';

function kausiTeksti(k: Tilikausi): string {
  return `${muotoilePvm(k.alkaa)} – ${muotoilePvm(k.loppuu)}`;
}

/** Kelpaako solun teksti summaksi (EuroInputin sääntö); virheellisestä solusta ei siirrytä. */
function kelpaaSummaksi(teksti: string): boolean {
  try {
    Euro.fromString(teksti.replace('−', '-'));
    return true;
  } catch (e) {
    if (e instanceof EuroParseError) return false;
    throw e;
  }
}

/** Hylätyn budjettirivin kuvaus ilmoitukseen: tili, kohdennus ja summa luonnollisessa suunnassa. */
function hylatynKuvaus(
  r: BudjettiRivi,
  kartta: readonly Tili[],
  kohdennukset: readonly Kohdennus[],
): string {
  const tili = kartta.find((t) => t.numero === r.tili && t.otsikkotaso === 0);
  const tiliTeksti = tili ? `Tili ${r.tili} ${nimi(tili)}` : `Tili ${r.tili} (ei tilikartassa)`;
  const k = kohdennukset.find((x) => x.id === r.kohdennus);
  const kohdennusTeksti =
    r.kohdennus === YLEINEN_ID
      ? 'Yleinen'
      : k
        ? kohdennuksenPolku(k, kohdennukset)
        : `Tuntematon (${r.kohdennus})`;
  return `${tiliTeksti}, ${kohdennusTeksti}: ${muotoileEuro(luonnollinenEtumerkki(tili, r.sentit))}`;
}

/**
 * Budjetin syöttö: tilikausi (osoitteesta, oletuksena kausi jolla tänään on, muuten viimeisin)
 * ja kohdennus. Editori ladataan, kun kartta, kohdennukset ja molempien kausien budjetit ovat
 * saapuneet, ja se avataan uudelleen jokaiselle kaudelle (key), jolloin paikallinen kopio
 * alkaa tallennetusta.
 */
export function BudjettiSivu({
  tilikausi,
  kohdennus,
}: {
  tilikausi: string | undefined;
  kohdennus: number | undefined;
}) {
  const { data: init } = useInit();
  const { data: kohdennukset } = useKohdennukset();
  const kaudet = useMemo(() => jarjesta(init?.tilikaudet ?? []), [init]);
  const kausi =
    kaudet.find((k) => k.alkaa === tilikausi) ?? oletusTilikausi(kaudet, paikallinenTanaan());
  const edellinenKausi = kausi ? edellinenTilikausi(kaudet, kausi) : undefined;
  const nykyinen = useBudjetti(kausi?.alkaa);
  const edellinen = useBudjetti(edellinenKausi?.alkaa);
  const kartta = useMemo(() => (init ? lataaKartta(init.tilit) : []), [init]);
  const piilotetut = useMemo(() => lueTiliLista(init?.asetukset[PIILOTETUT_AVAIN]), [init]);

  if (init && kaudet.length === 0) {
    return (
      <>
        <TopBar otsikko="Budjetti" />
        <p className="px-[22px] py-5 text-[13.5px] text-[var(--text-muted)]">Ei tilikausia.</p>
      </>
    );
  }
  if (
    !init ||
    !kausi ||
    !kohdennukset ||
    !nykyinen.data ||
    (edellinenKausi !== undefined && !edellinen.data)
  )
    return <TopBar otsikko="Budjetti" />;

  return (
    <BudjettiEditori
      key={kausi.alkaa}
      kausi={kausi}
      kaudet={kaudet}
      kartta={kartta}
      piilotetut={piilotetut}
      tallennetut={nykyinen.data}
      edellinen={edellinenKausi ? edellinen.data : undefined}
      kohdennukset={kohdennukset}
      alkuKohdennus={kohdennus ?? YLEINEN_ID}
    />
  );
}

/**
 * Koko tilikauden budjetti (kaikki kohdennukset) muokataan paikallisena kopiona ja tallennetaan
 * kerralla, koska tallennus korvaa koko vuoden. Kohdennuksen vaihto pysyy samassa kopiossa, joten
 * se ei kysy mitään; tilikauden vaihto ja sivulta poistuminen kysyvät tallentamattomista.
 * Summat näytetään ja syötetään tilin luonnollisessa suunnassa (luonnollinenEtumerkki).
 */
function BudjettiEditori({
  kausi,
  kaudet,
  kartta,
  piilotetut,
  tallennetut,
  edellinen,
  kohdennukset,
  alkuKohdennus,
}: {
  kausi: Tilikausi;
  kaudet: readonly Tilikausi[];
  kartta: readonly Tili[];
  piilotetut: ReadonlySet<number>;
  tallennetut: readonly BudjettiRivi[];
  /** Edellisen kauden budjetti; undefined = ensimmäinen tilikausi. */
  edellinen: readonly BudjettiRivi[] | undefined;
  kohdennukset: readonly Kohdennus[];
  alkuKohdennus: number;
}) {
  const navigate = useNavigate();
  const tallenna = useTallennaBudjetti();
  // Rivit, joita tallennus ei hyväksyisi (poistettu tili, merkkaukseksi muuttunut kohdennus,
  // tuodut rivit), eivät näy taulukossa: ne pudotetaan paikallisesta kopiosta ja luetellaan,
  // jotta vuoden voi taas tallentaa.
  const [alku] = useState(() => erotteleBudjetoitavat(tallennetut, kartta, kohdennukset));
  // Tallennetut hylätyt rivit (poistuvat vasta tallennettaessa) ja kopioinnissa pudotetut.
  const [tallennetutHylatyt, setTallennetutHylatyt] = useState<BudjettiRivi[]>(alku.hylatyt);
  const [kopioinninHylatyt, setKopioinninHylatyt] = useState<BudjettiRivi[]>([]);
  const pudotetut = [...tallennetutHylatyt, ...kopioinninHylatyt];
  const [soluVirhe, setSoluVirhe] = useState(false);
  const [rivit, setRivit] = useState<BudjettiRivi[]>(() => alku.kelpaavat);
  const { onkoLikainen, asetaPohja } = useMuutosseuranta(rivit, budjettiVertailuun);
  const varoitus = useTallentamatonVaroitus(onkoLikainen);

  const naytaKohdennus = kohdennukset.some(
    (k) => k.tyyppi === KohdennusTyyppi.KUSTANNUSPAIKKA || k.tyyppi === KohdennusTyyppi.PROJEKTI,
  );
  const valittavat = useMemo(
    () => budjetoitavatKohdennukset(kohdennukset, kausi, tallennetut),
    [kohdennukset, kausi, tallennetut],
  );
  const [kohdennus, setKohdennus] = useState(() =>
    valittavat.some((k) => k.id === alkuKohdennus) ? alkuKohdennus : YLEINEN_ID,
  );

  // Piilotettu tili näkyy, jos sillä on tallennettua budjettia tällä tai edellisellä kaudella.
  const tilit = useMemo(
    () => naytettavatTilit(kartta, piilotetut, [...tallennetut, ...(edellinen ?? [])]),
    [kartta, piilotetut, tallennetut, edellinen],
  );
  const taulukko = rakennaBudjettiTaulukko(tilit, rivit, edellinen ?? [], kohdennus);
  const yhteenveto = budjettiYhteenveto(
    rivit.filter((r) => r.kohdennus === kohdennus),
    kartta,
  );

  const solut = useRef<(HTMLInputElement | null)[]>([]);
  function siirry(e: KeyboardEvent<HTMLTableCellElement>, i: number) {
    const suunta =
      e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : undefined;
    if (suunta === undefined) return;
    e.preventDefault();
    if (!kelpaaSummaksi(solut.current[i]?.value ?? '')) return;
    solut.current[i + suunta]?.focus();
  }

  function kopioi() {
    if (!edellinen) return;
    if (rivit.length > 0 && !window.confirm(KORVAUSVAHVISTUS)) return;
    const { kelpaavat, hylatyt } = erotteleBudjetoitavat(
      kopioiEdellinen(edellinen, kohdennukset, kausi.alkaa),
      kartta,
      kohdennukset,
    );
    setRivit(kelpaavat);
    setKopioinninHylatyt(hylatyt);
  }

  function tallennaKaikki() {
    // Virheellistä solua ei kirjata (EuroInput pitää sen punaisena): tallennus hylätään, ettei
    // syötetty teksti katoa huomaamatta.
    const virheellinen = solut.current.find((el) => el && !kelpaaSummaksi(el.value));
    if (virheellinen) {
      setSoluVirhe(true);
      virheellinen.focus();
      return;
    }
    setSoluVirhe(false);
    const lahetetyt = rivit;
    tallenna.mutate(
      { tilikausi: kausi.alkaa, rivit: lahetetyt },
      {
        onSuccess: () => {
          asetaPohja(lahetetyt);
          setTallennetutHylatyt([]);
          setKopioinninHylatyt([]);
        },
      },
    );
  }

  const virhe = soluVirhe
    ? VIRHEELLINEN_SOLU
    : tallenna.error
      ? tallenna.error instanceof ResourceError && tallenna.error.message
        ? tallenna.error.message
        : 'Tallennus epäonnistui.'
      : null;

  let soluIndeksi = 0;
  return (
    <>
      <TopBar
        otsikko="Budjetti"
        alaotsikko={kausiTeksti(kausi)}
        toiminnot={
          <>
            <Button
              size="compact"
              variant="sec"
              disabled={!edellinen}
              title={
                edellinen ? undefined : 'Ensimmäisellä tilikaudella ei ole edellistä budjettia'
              }
              onClick={kopioi}
            >
              Kopioi edellinen
            </Button>
            <Button
              size="compact"
              // Ei poisteta käytöstä puhtaana: hiiren painallus käytöstä poistettuun nappiin ei
              // sumentaisi solua, jolloin juuri kirjoitettu summa jäisi kirjaamatta.
              disabled={tallenna.isPending}
              onClick={tallennaKaikki}
            >
              Tallenna
            </Button>
          </>
        }
      />
      <section aria-label="budjetti" className="flex-1 overflow-auto px-[22px] py-5">
        <div className="mb-5 flex flex-wrap gap-4">
          <label className={LABEL_LUOKKA}>
            Tilikausi
            <select
              value={kausi.alkaa}
              onChange={(e) =>
                void navigate({
                  to: '/budjetti',
                  search: {
                    tilikausi: e.target.value,
                    kohdennus: kohdennus === YLEINEN_ID ? undefined : kohdennus,
                  },
                })
              }
              className={VALITSIN}
            >
              {kaudet.map((k) => (
                <option key={k.alkaa} value={k.alkaa}>
                  {kausiTeksti(k)}
                </option>
              ))}
            </select>
          </label>
          {naytaKohdennus && (
            <label className={LABEL_LUOKKA}>
              Kohdennus
              <select
                value={kohdennus}
                onChange={(e) => setKohdennus(Number(e.target.value))}
                className={VALITSIN}
              >
                <option value={YLEINEN_ID}>Yleinen</option>
                {valittavat.map((k) => (
                  <option key={k.id} value={k.id}>
                    {kohdennuksenPolku(k, kohdennukset)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {virhe && (
          <p role="alert" className="mb-3 text-[12.5px] text-[var(--danger)]">
            {virhe}
          </p>
        )}

        {pudotetut.length > 0 && (
          <div
            // biome-ignore lint/a11y/useSemanticElements: ilmoitus sisältää listan, jota <output> (fraasisisältö) ei salli
            role="status"
            className="mb-4 max-w-2xl rounded-[var(--radius-input)] border border-[var(--border)] px-[12px] py-[8px] text-[12.5px]"
          >
            <p>Budjetissa on rivejä, joita ei voi budjetoida. Ne poistetaan, kun tallennat:</p>
            <ul className="mt-1 list-disc pl-[18px] text-[var(--text-muted)]">
              {pudotetut.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: duplikaattirivillä ei ole yksilöivää avainta; lista ei järjesty uudelleen
                <li key={i}>{hylatynKuvaus(r, kartta, kohdennukset)}</li>
              ))}
            </ul>
          </div>
        )}

        <table className="w-full max-w-2xl border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
              <th className="py-[6px] text-left font-semibold">Tili</th>
              <th className="w-[150px] py-[6px] text-right font-semibold">Edellinen budjetti</th>
              <th className="w-[150px] py-[6px] pl-[10px] text-right font-semibold">Budjetti</th>
            </tr>
          </thead>
          <tbody>
            {taulukko.map((r, rivi) => {
              if (r.otsikko) {
                return (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: otsikoilla ei ole yksilöivää avainta; järjestys tulee kartasta
                    key={`o-${rivi}`}
                    className="border-b border-[var(--border-faint)]"
                  >
                    <th
                      colSpan={3}
                      scope="colgroup"
                      className="pt-[10px] pb-[4px] text-left font-semibold"
                      style={{ paddingLeft: `${(r.otsikko.taso - 1) * 16}px` }}
                    >
                      {r.otsikko.teksti}
                    </th>
                  </tr>
                );
              }
              const tili = r.tili as Tili;
              const i = soluIndeksi++;
              const tiliTeksti = `${tili.numero} ${nimi(tili)}`;
              const edellinenNaytto = luonnollinenEtumerkki(tili, r.edellinen);
              return (
                <tr key={tili.numero} className="border-b border-[var(--border-faint)]">
                  <td className="py-[3px] text-[12.5px] text-[var(--text-muted)]">{tiliTeksti}</td>
                  <td className="py-[3px] text-right tabular-nums text-[12.5px] text-[var(--text-subtle)]">
                    {edellinenNaytto === 0 ? '' : muotoileEuro(edellinenNaytto)}
                  </td>
                  <td className="py-[3px] pl-[10px]" onKeyDown={(e) => siirry(e, i)}>
                    <EuroInput
                      etumerkillinen
                      aria-label={`Budjetti ${tiliTeksti}`}
                      arvo={luonnollinenEtumerkki(tili, r.sentit)}
                      onCommit={(snt) =>
                        setRivit((nyt) =>
                          asetaBudjetti(
                            nyt,
                            kohdennus,
                            tili.numero,
                            luonnollinenEtumerkki(tili, snt),
                          ),
                        )
                      }
                      inputRef={(el) => {
                        solut.current[i] = el;
                      }}
                      className="w-full rounded-[var(--radius-input)] px-[6px] py-[3px] text-right tabular-nums outline-none focus:bg-[var(--accent-soft)] aria-[invalid=true]:text-[var(--danger)]"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <dl className="mt-5 grid max-w-2xl grid-cols-[1fr_150px] gap-y-1 text-[13px]">
          <dt>Tulot yhteensä</dt>
          <dd className="text-right tabular-nums">{muotoileEuro(yhteenveto.tulot)}</dd>
          <dt>Menot yhteensä</dt>
          <dd className="text-right tabular-nums">{muotoileEuro(yhteenveto.menot)}</dd>
          <dt className="font-semibold">Budjetoitu tulos</dt>
          <dd className="text-right font-semibold tabular-nums">
            {muotoileEuro(yhteenveto.tulos)}
          </dd>
        </dl>
      </section>
      {varoitus}
    </>
  );
}
