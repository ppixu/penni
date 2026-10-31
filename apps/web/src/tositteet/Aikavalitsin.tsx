import { viimeisinIlmoitettu } from '@/alv/alvKaudet';
import { useInit, useTositteet } from '@/app/kysely';
import { useValittuTilikausi } from '@/tilikausi/valittuTilikausi';
import { TositeTyyppi } from '@penni/engine';
import {
  KUUKAUSIVALINNAT,
  PIKAVALINNAT,
  type Paivavali,
  type PikavalinnanTunnus,
  kuukausittainenAlv,
  laskePikavalinnanVali,
  leikkaa,
  paikallinenTanaan,
  tyonAlainenKuukausi,
  tyonAlainenNeljannes,
} from './pikavalinnat';

export { paikallinenTanaan };

export const EI_RAJAUSTA: Paivavali = { alkupvm: '', loppupvm: '' };

/**
 * Väli valitun tilikauden sisällä: käsin syötetty (`valinta === null`, leikattuna kauteen) tai
 * pikavalinnan laskema. Kun valinta ei osu kaudelle (esim. Q3 lyhyellä kaudella tai toisen
 * kauden käsin syötetty väli), käytetään koko kautta. `vali` näytetään kentissä — tyhjennetty
 * kenttä pysyy tyhjänä, jotta päivän voi kirjoittaa — ja `haku` rajaa listan aina kauteen.
 * Väliä ei voi laskea ennen kuin tilikaudet on haettu — `valmis` kertoo sen, jottei lista
 * välähdä rajaamattomana. Kirjassa ilman tilikausia ei rajata.
 */
export function useAikavali(valinta: PikavalinnanTunnus | null, oma: Paivavali) {
  const { data: init } = useInit();
  const { kausi } = useValittuTilikausi();
  const tanaan = paikallinenTanaan();
  const koko = laskePikavalinnanVali('tilikausi', kausi, tanaan);
  const rajattu =
    kausi === undefined
      ? null
      : valinta === null
        ? leikkaa(oma, kausi)
        : laskePikavalinnanVali(valinta, kausi, tanaan);
  if (rajattu === null || rajattu.alkupvm > rajattu.loppupvm) {
    const vali = koko ?? EI_RAJAUSTA;
    return { vali, haku: vali, valmis: init !== undefined };
  }
  const vali =
    valinta === null
      ? {
          alkupvm: oma.alkupvm === '' ? '' : rajattu.alkupvm,
          loppupvm: oma.loppupvm === '' ? '' : rajattu.loppupvm,
        }
      : rajattu;
  return { vali, haku: rajattu, valmis: init !== undefined };
}

const NAPPIPOHJA =
  'whitespace-nowrap rounded-[6px] py-1.5 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-40';
const NAPPI = `${NAPPIPOHJA} px-[13px]`;
/** Kuukausirivin napit tiiviimmin, jotta 12 kuukautta ja päiväkentät mahtuvat samalle riville. */
const KUUKAUSINAPPI = `${NAPPIPOHJA} px-[9px]`;
const RIVI = 'inline-flex max-w-full flex-wrap gap-[2px] rounded-[9px] bg-[var(--track)] p-[3px]';
const VALITTU =
  'bg-[var(--surface)] font-semibold text-[var(--accent)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]';
const VALITSEMATON = 'font-medium text-[var(--text-muted)]';
const KENTTA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

/**
 * Aikavälin valinta valitun tilikauden sisällä: pikavalintanapit (Q-napeista merkitään työn
 * alla oleva, alv:ltaan ilmoittamaton neljännes; "Tämä vuosi" = koko kausi, joka on myös
 * oletus) sekä Alkaen/Asti-kentät, jotka eivät päästä kauden ulkopuolelle. Kuukausittain alv:n
 * ilmoittavalle näytetään lisäksi kuukausirivi, josta merkitään samoin työn alla oleva kuukausi.
 * Päivän muokkaus irrottaa pikavalinnasta (kutsuja asettaa valinnaksi null), jottei aktiivinen
 * nappi valehtele näytetystä välistä. Palauttaa fragmentin — kutsujan flex-rivi asettelee osat.
 */
export function Aikavalitsin({
  valinta,
  vali,
  onValinta,
  onPaiva,
}: {
  valinta: PikavalinnanTunnus | null;
  vali: Paivavali;
  onValinta: (tunnus: PikavalinnanTunnus) => void;
  onPaiva: (kentta: keyof Paivavali, arvo: string) => void;
}) {
  const { data: init } = useInit();
  const { kausi } = useValittuTilikausi();
  const tanaan = paikallinenTanaan();
  // Työn alla oleva neljännes/kuukausi: ensimmäinen, jonka alv:ta ei ole vielä ilmoitettu (sama
  // raja kuin alv-sivulla). Merkitään nappiin "(tämä neljännes)" / "(tämä kuukausi)".
  const { data: alvIlmoitukset } = useTositteet({ tyyppi: TositeTyyppi.ALVLASKELMA });
  const ilmoitettuAsti = viimeisinIlmoitettu(init?.asetukset.AlvIlmoitettu, alvIlmoitukset ?? []);
  const tamaNeljannes = tyonAlainenNeljannes(kausi, tanaan, ilmoitettuAsti);
  const kuukausittain = init !== undefined && kuukausittainenAlv(init.asetukset, kausi);
  const tamaKuukausi = kuukausittain ? tyonAlainenKuukausi(kausi, tanaan, ilmoitettuAsti) : null;

  /** Pikavalinta on käytettävissä vain jos sille saadaan väli valitulla kaudella. */
  const kaytettavissa = (tunnus: PikavalinnanTunnus): boolean =>
    kausi === undefined || laskePikavalinnanVali(tunnus, kausi, tanaan) !== null;
  const kaudella = kaytettavissa('kuukausi');
  // "Tämä kuukausi" vain kun tänään on valitulla kaudella; aiemmalla kaudella se ei tarkoita
  // mitään. Kuukausirivin kanssa se jää pois: rivi merkitsee jo työn alla olevan kuukauden.
  const napit = PIKAVALINNAT.filter((v) => v.tunnus !== 'kuukausi' || (kaudella && !kuukausittain));

  const nappi = (
    v: { tunnus: PikavalinnanTunnus; label: string },
    label: string,
    tyyli = NAPPI,
  ) => (
    <button
      key={v.tunnus}
      type="button"
      aria-pressed={valinta === v.tunnus}
      disabled={!kaytettavissa(v.tunnus)}
      // Aktiivisen napin uusi painallus palaa koko tilikauteen.
      onClick={() => onValinta(valinta === v.tunnus ? 'tilikausi' : v.tunnus)}
      className={`${tyyli} ${valinta === v.tunnus ? VALITTU : VALITSEMATON}`}
    >
      {label}
    </button>
  );

  return (
    <>
      <fieldset className="flex min-w-0 max-w-full flex-col items-start gap-1">
        <legend className="sr-only">Aikaväli</legend>
        <div className={RIVI}>
          {napit.map((v) =>
            nappi(
              v,
              v.tunnus === tamaNeljannes
                ? `${v.label} (tämä neljännes)`
                : // Aiemmalla kaudella "Tämä vuosi" on sen kauden koko vuosi.
                  v.tunnus === 'tilikausi' && !kaudella
                  ? 'Koko vuosi'
                  : v.label,
            ),
          )}
        </div>
        {kuukausittain && (
          <fieldset className={RIVI}>
            <legend className="sr-only">Kuukaudet</legend>
            {KUUKAUSIVALINNAT.map((v) =>
              nappi(
                v,
                v.tunnus === tamaKuukausi ? `${v.label} (tämä kuukausi)` : v.label,
                KUUKAUSINAPPI,
              ),
            )}
          </fieldset>
        )}
      </fieldset>
      <label className={KENTTA}>
        Alkaen
        <input
          type="date"
          value={vali.alkupvm}
          min={kausi?.alkaa}
          max={kausi?.loppuu}
          onChange={(e) => onPaiva('alkupvm', e.target.value)}
          className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] tabular-nums"
        />
      </label>
      <label className={KENTTA}>
        Asti
        <input
          type="date"
          value={vali.loppupvm}
          min={kausi?.alkaa}
          max={kausi?.loppuu}
          onChange={(e) => onPaiva('loppupvm', e.target.value)}
          className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] tabular-nums"
        />
      </label>
    </>
  );
}

/** Segmenttivalitsin (tilaryhmä, laji, maksutila) — sama ulkoasu kuin pikavalinnoissa. */
export function Segmentit<T extends string>({
  otsikko,
  vaihtoehdot,
  valittu,
  onValitse,
}: {
  otsikko: string;
  vaihtoehdot: readonly { arvo: T; label: string }[];
  valittu: T;
  onValitse: (arvo: T) => void;
}) {
  return (
    <fieldset className="inline-flex w-fit gap-[2px] rounded-[9px] bg-[var(--track)] p-[3px]">
      <legend className="sr-only">{otsikko}</legend>
      {vaihtoehdot.map((v) => (
        <button
          key={v.arvo}
          type="button"
          aria-pressed={valittu === v.arvo}
          onClick={() => onValitse(v.arvo)}
          className={`${NAPPI} ${valittu === v.arvo ? VALITTU : VALITSEMATON}`}
        >
          {v.label}
        </button>
      ))}
    </fieldset>
  );
}
