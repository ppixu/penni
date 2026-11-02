import { useInit, usePaivitaAsetukset, useTallennaVakioviite } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import {
  type InitBundle,
  type Vakioviite,
  type VakioviiteSyote,
  lataaKartta,
  nimi as tilinNimi,
} from '@penni/engine';
import { tarkistaViite } from '@penni/validator';
import { useMemo, useState } from 'react';

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA_LUOKKA =
  'rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] normal-case tracking-normal';

/** Käsin annettava viite (spec §8.2): 4-7 numeroa, ei alkunollaa. */
const KASIN_VIITE = /^[1-9]\d{3,6}$/;

interface Vaihtoehto {
  arvo: string;
  teksti: string;
}

/** Tulotilit (tyyppi C…) lehtitileinä; muokattavan viitteen nykyinen tili säilyy valittavana. */
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
    const teksti =
      typeof nimi === 'string'
        ? nimi
        : typeof nimi === 'object' &&
            nimi !== null &&
            typeof (nimi as { fi?: unknown }).fi === 'string'
          ? (nimi as { fi: string }).fi
          : String(id);
    tulos.push({ arvo: String(id), teksti });
  }
  return tulos;
}

/** Käsin annetun viitteen tarkistus ennen lähetystä; null = kunnossa. */
function viiteVirhe(viite: string): string | null {
  if (!KASIN_VIITE.test(viite))
    return 'Viitteessä on oltava 4-7 numeroa eikä se saa alkaa nollalla.';
  if (!tarkistaViite(viite)) return 'Viitteen tarkistenumero on virheellinen.';
  return null;
}

/**
 * Vakioviitteen uusi/muokkaus-dialogi (spec §8.4). Uusi viite numeroidaan joko automaattisesti
 * (ei `viite`-kenttää) tai käsin; valinta muistetaan asetuksessa `NumeroiVakioviiteItse`.
 * Muokkaus lähettää aina nykyisen viitteen ja `vanhaViite`n: puuttuva `viite` tarkoittaisi
 * moottorille automaattista uudelleennumerointia.
 */
export function VakioviiteDialog({
  vakioviite,
  onPeruuta,
  onValmis,
}: {
  /** Muokattava vakioviite; puuttuessa luodaan uusi. */
  vakioviite?: Vakioviite | undefined;
  onPeruuta: () => void;
  onValmis: () => void;
}) {
  const { data: init } = useInit();
  if (!init) return null;
  return <Lomake init={init} vakioviite={vakioviite} onPeruuta={onPeruuta} onValmis={onValmis} />;
}

function Lomake({
  init,
  vakioviite,
  onPeruuta,
  onValmis,
}: {
  init: InitBundle;
  vakioviite: Vakioviite | undefined;
  onPeruuta: () => void;
  onValmis: () => void;
}) {
  const muokkaus = vakioviite !== undefined;
  const { tallenna, virheviesti, tallentaa } = useTallennaVakioviite();
  const { tallenna: tallennaAsetus, virheviesti: asetusVirhe } = usePaivitaAsetukset();

  const tilit = useMemo(() => tiliVaihtoehdot(init, vakioviite?.tili), [init, vakioviite]);
  const kohdennukset = useMemo(() => kohdennusVaihtoehdot(init), [init]);

  const [itse, setItse] = useState(init.asetukset.NumeroiVakioviiteItse === 'true');
  const [viite, setViite] = useState(vakioviite?.viite ?? '');
  const [otsikko, setOtsikko] = useState(vakioviite?.otsikko ?? '');
  const [tili, setTili] = useState(() => {
    if (vakioviite) return String(vakioviite.tili);
    const oletus = init.asetukset.OletusMyyntitili ?? '';
    return tilit.some((t) => t.arvo === oletus) ? oletus : '';
  });
  const [kohdennus, setKohdennus] = useState(
    vakioviite?.kohdennus !== undefined ? String(vakioviite.kohdennus) : '',
  );
  const [lomakevirhe, setLomakevirhe] = useState<string | null>(null);

  async function vaihdaTila(uusiItse: boolean) {
    setItse(uusiItse);
    setLomakevirhe(null);
    await tallennaAsetus({ NumeroiVakioviiteItse: uusiItse ? 'true' : 'false' });
  }

  async function laheta() {
    setLomakevirhe(null);
    const viiteTeksti = viite.replace(/\s/g, '');
    const kasin = muokkaus || itse;
    if (kasin) {
      const virhe = viiteVirhe(viiteTeksti);
      if (virhe) {
        setLomakevirhe(virhe);
        return;
      }
    }
    if (tili === '') {
      setLomakevirhe('Valitse tili.');
      return;
    }
    if (otsikko.trim() === '') {
      setLomakevirhe('Anna otsikko.');
      return;
    }
    // Muokkauksessa mukaan jäävät tuntemattomat avaimet (esim. Kitsas-tuonnin lisätiedot).
    const { viite: _v, tili: _t, kohdennus: _k, otsikko: _o, ...muut } = vakioviite ?? {};
    const syote: VakioviiteSyote = {
      ...muut,
      ...(kasin ? { viite: viiteTeksti } : {}),
      ...(muokkaus ? { vanhaViite: vakioviite.viite } : {}),
      tili: Number(tili),
      ...(kohdennus !== '' ? { kohdennus: Number(kohdennus) } : {}),
      otsikko: otsikko.trim(),
    };
    const talletettu = await tallenna(syote);
    if (talletettu) onValmis();
  }

  const otsikkoTeksti = muokkaus ? 'Muokkaa vakioviitettä' : 'Uusi vakioviite';
  const virhe = lomakevirhe ?? virheviesti ?? asetusVirhe;

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
      role="dialog"
      aria-modal="true"
      aria-label={otsikkoTeksti}
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-[420px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
        <h2 className="mb-4 text-[15px] font-[650]">{otsikkoTeksti}</h2>
        <div className="flex flex-col gap-3">
          {!muokkaus && (
            <fieldset className="flex gap-4 text-[13px]">
              <legend className="sr-only">Numerointi</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="vakioviite-numerointi"
                  checked={!itse}
                  onChange={() => void vaihdaTila(false)}
                />
                Automaattinen numero
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="vakioviite-numerointi"
                  checked={itse}
                  onChange={() => void vaihdaTila(true)}
                />
                Numeroin itse
              </label>
            </fieldset>
          )}
          {(muokkaus || itse) && (
            <label className={LABEL_LUOKKA}>
              Viite
              <input
                type="text"
                inputMode="numeric"
                aria-label="Viite"
                value={viite}
                onChange={(e) => setViite(e.target.value)}
                className={`${KENTTA_LUOKKA} tabular-nums`}
              />
            </label>
          )}
          <label className={LABEL_LUOKKA}>
            Otsikko
            <input
              type="text"
              aria-label="Otsikko"
              value={otsikko}
              onChange={(e) => setOtsikko(e.target.value)}
              className={KENTTA_LUOKKA}
            />
          </label>
          <label className={LABEL_LUOKKA}>
            Tili
            <select
              aria-label="Tili"
              value={tili}
              onChange={(e) => setTili(e.target.value)}
              className={KENTTA_LUOKKA}
            >
              <option value="">Valitse tili</option>
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
