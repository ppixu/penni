import { useInit, useTallennaTuote } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { alvValintaNimi, muotoileAlvProsentti } from '@/editori/AlvValitsin';
import {
  type InitBundle,
  type Tuote,
  type UusiTuote,
  VEROTYYPIT,
  alvKannat,
  asetusPaalla,
  lataaKartta,
  nettoEuroBrutosta,
  tiliAsetuksesta,
  nimi as tilinNimi,
  yleinenAlv,
} from '@penni/engine';
import { useMemo, useState } from 'react';
import { MYYNTIKOODIT } from './laskuReducer.js';

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA_LUOKKA =
  'rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] normal-case tracking-normal';

/** Yleisimmät UN/ECE rec 20 -yksikkökoodit laskutukseen; muut annetaan vapaana tekstinä. */
export const YKSIKOT: readonly { koodi: string; nimi: string }[] = [
  { koodi: 'C62', nimi: 'kpl' },
  { koodi: 'HUR', nimi: 'tunti' },
  { koodi: 'DAY', nimi: 'päivä' },
  { koodi: 'WEE', nimi: 'viikko' },
  { koodi: 'MON', nimi: 'kuukausi' },
  { koodi: 'ANN', nimi: 'vuosi' },
  { koodi: 'KGM', nimi: 'kg' },
  { koodi: 'LTR', nimi: 'litra' },
  { koodi: 'MTR', nimi: 'metri' },
  { koodi: 'MTK', nimi: 'm²' },
  { koodi: 'MTQ', nimi: 'm³' },
  { koodi: 'KMT', nimi: 'km' },
  { koodi: 'KWH', nimi: 'kWh' },
];
const MUU_YKSIKKO = 'muu';

interface Vaihtoehto {
  arvo: string;
  teksti: string;
}

/** ALV-valinta koodiksi ja prosentiksi: `koodi:prosentti`. */
function alvArvo(koodi: number, prosentti: number): string {
  return `${koodi}:${prosentti}`;
}

/**
 * Laskurivien ALV-vaihtoehdot (myyntikoodit): verollinen koodi kaikilla päivän kannoilla,
 * nollalajit 0 %:lla. Tuotteen tallennettu kanta säilyy valittavana, vaikka se ei olisi enää
 * voimassa (esim. tuotu 24 %).
 */
function alvVaihtoehdot(pvm: string, nykyinen: { koodi: number; prosentti: number } | undefined) {
  const tulos: Vaihtoehto[] = [];
  for (const t of VEROTYYPIT.filter((v) => MYYNTIKOODIT.includes(v.koodi))) {
    if (t.nollalaji) {
      tulos.push({ arvo: alvArvo(t.koodi, 0), teksti: alvValintaNimi(t) });
    } else {
      for (const kanta of alvKannat(pvm)) {
        tulos.push({
          arvo: alvArvo(t.koodi, kanta),
          teksti: `${alvValintaNimi(t)} ${muotoileAlvProsentti(kanta)}`,
        });
      }
    }
  }
  if (nykyinen && !tulos.some((v) => v.arvo === alvArvo(nykyinen.koodi, nykyinen.prosentti))) {
    const tyyppi = VEROTYYPIT.find((v) => v.koodi === nykyinen.koodi);
    tulos.push({
      arvo: alvArvo(nykyinen.koodi, nykyinen.prosentti),
      teksti: `${tyyppi ? alvValintaNimi(tyyppi) : `Alv-koodi ${nykyinen.koodi}`} ${muotoileAlvProsentti(nykyinen.prosentti)}`,
    });
  }
  return tulos;
}

/** Tulotilit (tyyppi C…) lehtitileinä; tuotteen nykyinen tili säilyy valittavana. */
function tiliVaihtoehdot(init: InitBundle, nykyinen: number | undefined): Vaihtoehto[] {
  const kartta = lataaKartta(init.tilit);
  const vaihtoehdot = kartta
    .filter((t) => t.otsikkotaso === 0 && t.tyyppiKoodi.startsWith('C'))
    .map((t) => ({ arvo: String(t.numero), teksti: `${t.numero} ${tilinNimi(t)}` }));
  if (nykyinen !== undefined && !vaihtoehdot.some((v) => v.arvo === String(nykyinen))) {
    const tili = kartta.find((t) => t.numero === nykyinen && t.otsikkotaso === 0);
    vaihtoehdot.push({
      arvo: String(nykyinen),
      teksti: tili ? `${nykyinen} ${tilinNimi(tili)}` : String(nykyinen),
    });
    vaihtoehdot.sort((a, b) => Number(a.arvo) - Number(b.arvo));
  }
  return vaihtoehdot;
}

/** Kohdennukset ovat toistaiseksi `unknown[]`; poimitaan id ja nimi varovasti. */
function kohdennusVaihtoehdot(init: InitBundle): Vaihtoehto[] {
  const tulos: Vaihtoehto[] = [];
  for (const k of init.kohdennukset) {
    if (typeof k !== 'object' || k === null) continue;
    const { id, nimi } = k as { id?: unknown; nimi?: unknown };
    if (typeof id !== 'number') continue;
    const fi = (nimi as { fi?: unknown } | null)?.fi;
    tulos.push({
      arvo: String(id),
      teksti: typeof nimi === 'string' ? nimi : typeof fi === 'string' ? fi : String(id),
    });
  }
  return tulos;
}

/** Euromäärä tekstistä (desimaalipilkku sallittu); null jos ei kelpaa. */
function jasennaEuro(teksti: string): number | null {
  const siisti = teksti.replace(/\s/g, '').replace(',', '.');
  if (siisti === '' || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(siisti)) return null;
  const n = Number(siisti);
  return Number.isFinite(n) ? n : null;
}

function euroTekstina(n: number): string {
  return String(n).replace('.', ',');
}

/**
 * Tuotteen uusi/muokkaus-dialogi (spec §7). Hinta syötetään alvittomana tai verollisena;
 * tallennetaan aina nettona (`nettoEuroBrutosta`, euroina, ei pyöristetä senttiin). Muokkauksessa
 * tuotteen tuntemattomat avaimet (esim. Kitsas-tuonnin `nimi`) kulkevat mukana.
 */
export function TuoteDialog({
  tuote,
  onPeruuta,
  onValmis,
}: {
  /** Muokattava tuote; puuttuessa luodaan uusi. */
  tuote?: Tuote | undefined;
  onPeruuta: () => void;
  onValmis: () => void;
}) {
  const { data: init } = useInit();
  if (!init) return null;
  return <Lomake init={init} tuote={tuote} onPeruuta={onPeruuta} onValmis={onValmis} />;
}

function Lomake({
  init,
  tuote,
  onPeruuta,
  onValmis,
}: {
  init: InitBundle;
  tuote: Tuote | undefined;
  onPeruuta: () => void;
  onValmis: () => void;
}) {
  const muokkaus = tuote !== undefined;
  const { tallenna, virheviesti, tallentaa } = useTallennaTuote();

  const tanaan = new Date().toISOString().slice(0, 10);
  const alvVelvollinen = asetusPaalla(init.asetukset.AlvVelvollinen);
  const alvit = useMemo(
    () =>
      alvVaihtoehdot(
        tanaan,
        tuote ? { koodi: tuote.alvKoodi, prosentti: tuote.alvProsentti } : undefined,
      ),
    [tanaan, tuote],
  );
  const tilit = useMemo(() => tiliVaihtoehdot(init, tuote?.tili), [init, tuote]);
  const kohdennukset = useMemo(() => kohdennusVaihtoehdot(init), [init]);

  const [nimike, setNimike] = useState(tuote?.nimike ?? '');
  const [koodi, setKoodi] = useState(tuote?.koodi ?? '');
  const [hinta, setHinta] = useState(tuote ? euroTekstina(tuote.aNetto) : '');
  const [verollinen, setVerollinen] = useState(false);
  const [alv, setAlv] = useState(() =>
    tuote
      ? alvArvo(tuote.alvKoodi, tuote.alvProsentti)
      : alvVelvollinen
        ? alvArvo(11, yleinenAlv(tanaan))
        : alvArvo(0, 0),
  );
  const [tili, setTili] = useState(() => {
    if (tuote) return tuote.tili !== undefined ? String(tuote.tili) : '';
    const oletus = tiliAsetuksesta(init.asetukset, 'OletusMyyntitili');
    return oletus !== undefined && tilit.some((t) => t.arvo === String(oletus))
      ? String(oletus)
      : '';
  });
  const [kohdennus, setKohdennus] = useState(
    tuote?.kohdennus !== undefined ? String(tuote.kohdennus) : '',
  );
  const [yksikko, setYksikko] = useState(() =>
    tuote?.unKoodi ? tuote.unKoodi : tuote?.yksikko ? MUU_YKSIKKO : '',
  );
  const [omaYksikko, setOmaYksikko] = useState(tuote?.yksikko ?? '');
  const [lomakevirhe, setLomakevirhe] = useState<string | null>(null);

  async function laheta() {
    setLomakevirhe(null);
    if (nimike.trim() === '') {
      setLomakevirhe('Anna nimike.');
      return;
    }
    const syotetty = hinta.trim() === '' ? 0 : jasennaEuro(hinta);
    if (syotetty === null) {
      setLomakevirhe('Hinta ei ole kelvollinen luku.');
      return;
    }
    if (yksikko === MUU_YKSIKKO && omaYksikko.trim() === '') {
      setLomakevirhe('Anna yksikkö tai valitse luettelosta.');
      return;
    }
    const [alvKoodi = 0, alvProsentti = 0] = alv.split(':').map(Number);
    const aNetto = verollinen ? nettoEuroBrutosta(syotetty, alvProsentti) : syotetty;
    // Muokkauksessa mukaan jäävät tuntemattomat avaimet; lomakkeen omat kentät kirjoitetaan
    // uudelleen (tyhjennetty valinta poistaa kentän).
    const {
      nimike: _n,
      koodi: _k,
      aNetto: _h,
      alvKoodi: _ak,
      alvProsentti: _ap,
      tili: _t,
      kohdennus: _ko,
      unKoodi: _u,
      yksikko: _y,
      ...muut
    } = tuote ?? ({} as Partial<Tuote>);
    const syote: UusiTuote = {
      ...muut,
      ...(tuote ? { id: tuote.id } : {}),
      nimike: nimike.trim(),
      ...(koodi.trim() !== '' ? { koodi: koodi.trim() } : {}),
      aNetto,
      alvKoodi,
      alvProsentti,
      ...(tili !== '' ? { tili: Number(tili) } : {}),
      ...(kohdennus !== '' ? { kohdennus: Number(kohdennus) } : {}),
      ...(yksikko === MUU_YKSIKKO
        ? { yksikko: omaYksikko.trim() }
        : yksikko !== ''
          ? { unKoodi: yksikko }
          : {}),
    };
    const talletettu = await tallenna(syote);
    if (talletettu) onValmis();
  }

  const otsikkoTeksti = muokkaus ? 'Muokkaa tuotetta' : 'Uusi tuote';
  const virhe = lomakevirhe ?? virheviesti;

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
      role="dialog"
      aria-modal="true"
      aria-label={otsikkoTeksti}
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="max-h-full w-[460px] overflow-auto rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
        <h2 className="mb-4 text-[15px] font-[650]">{otsikkoTeksti}</h2>
        <div className="flex flex-col gap-3">
          <label className={LABEL_LUOKKA}>
            Nimike
            <input
              type="text"
              aria-label="Nimike"
              value={nimike}
              onChange={(e) => setNimike(e.target.value)}
              className={KENTTA_LUOKKA}
            />
          </label>
          <label className={LABEL_LUOKKA}>
            Tuotekoodi
            <input
              type="text"
              aria-label="Tuotekoodi"
              value={koodi}
              onChange={(e) => setKoodi(e.target.value)}
              className={KENTTA_LUOKKA}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL_LUOKKA}>
              Hinta
              <input
                type="text"
                inputMode="decimal"
                aria-label="Hinta"
                value={hinta}
                onChange={(e) => setHinta(e.target.value)}
                className={`${KENTTA_LUOKKA} text-right tabular-nums`}
              />
            </label>
            <label className={LABEL_LUOKKA}>
              Alv
              <select
                aria-label="Alv"
                value={alv}
                onChange={(e) => setAlv(e.target.value)}
                className={KENTTA_LUOKKA}
              >
                {alvit.map((a) => (
                  <option key={a.arvo} value={a.arvo}>
                    {a.teksti}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="flex gap-4 text-[13px]">
            <legend className="sr-only">Hinnan laji</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="tuote-hinnan-laji"
                checked={!verollinen}
                onChange={() => setVerollinen(false)}
              />
              Hinta alvittomana
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="tuote-hinnan-laji"
                checked={verollinen}
                onChange={() => setVerollinen(true)}
              />
              Hinta sisältää alv:n
            </label>
          </fieldset>
          <label className={LABEL_LUOKKA}>
            Tili
            <select
              aria-label="Tili"
              value={tili}
              onChange={(e) => setTili(e.target.value)}
              className={KENTTA_LUOKKA}
            >
              <option value="">Ei tiliä (laskun oletus)</option>
              {tilit.map((t) => (
                <option key={t.arvo} value={t.arvo}>
                  {t.teksti}
                </option>
              ))}
            </select>
          </label>
          {kohdennukset.length > 0 && (
            <label className={LABEL_LUOKKA}>
              Kohdennus
              <select
                aria-label="Kohdennus"
                value={kohdennus}
                onChange={(e) => setKohdennus(e.target.value)}
                className={KENTTA_LUOKKA}
              >
                <option value="">Ei kohdennusta</option>
                {kohdennukset.map((k) => (
                  <option key={k.arvo} value={k.arvo}>
                    {k.teksti}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL_LUOKKA}>
              Yksikkö
              <select
                aria-label="Yksikkö"
                value={yksikko}
                onChange={(e) => setYksikko(e.target.value)}
                className={KENTTA_LUOKKA}
              >
                <option value="">Ei yksikköä</option>
                {YKSIKOT.map((y) => (
                  <option key={y.koodi} value={y.koodi}>
                    {y.nimi} ({y.koodi})
                  </option>
                ))}
                <option value={MUU_YKSIKKO}>Muu…</option>
              </select>
            </label>
            {yksikko === MUU_YKSIKKO && (
              <label className={LABEL_LUOKKA}>
                Oma yksikkö
                <input
                  type="text"
                  aria-label="Oma yksikkö"
                  value={omaYksikko}
                  onChange={(e) => setOmaYksikko(e.target.value)}
                  className={KENTTA_LUOKKA}
                />
              </label>
            )}
          </div>
          {virhe && (
            <p role="alert" className="text-[12.5px] text-[var(--danger)]">
              {virhe}
            </p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="sec" type="button" onClick={onPeruuta}>
            Peruuta
          </Button>
          <Button type="button" disabled={tallentaa} onClick={() => void laheta()}>
            Tallenna
          </Button>
        </div>
      </div>
    </div>
  );
}
