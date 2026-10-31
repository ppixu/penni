import { Button } from '@/components/ui/button';
import { TiliValitsin } from '@/editori/TiliValitsin';
import { type LadattavaLiite, LiitteidenLataus } from '@/liitteet/LiitteidenLataus';
import { type Kuittilahde, type Tili, type TyolistaRivi, veroTyyppi } from '@penni/engine';
import { muotoileEuro, muotoilePvm } from '@penni/euro';
import { useState } from 'react';

/** Käyttäjän riville lisäämä tiedosto (tavut muistissa kirjaukseen asti). */
export type OmaLiite = LadattavaLiite & { id: number };

/** Montako liitettävää kuittia näytetään ennen "Näytä kaikki" -valintaa. */
const EHDOKKAITA_ALUKSI = 5;

const OTSIKKO_LUOKKA =
  'text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const ARVO_LUOKKA = 'text-[13px] text-[var(--text)]';

/** Muotoilee alv-prosentin desimaalipilkulla (25.5 → '25,5 %'). */
function prosentti(arvo: number): string {
  return `${String(arvo).replace('.', ',')} %`;
}

/**
 * Rivin alv-käsittely: kuitilta käännetty verovelvollisuus tai ensimmäisen erän kanta;
 * kuittittomalla rivillä historian ehdotuksen alv, kun rivin tili on yhä ehdotuksen tili.
 */
function alvTeksti(rivi: TyolistaRivi): string {
  const kuitti = rivi.kuitti?.kuitti;
  if (!kuitti) {
    const ehdotus = rivi.ehdotus?.tili === rivi.tili ? rivi.ehdotus : undefined;
    if (!ehdotus || ehdotus.alvKoodi === 0) return '—';
    const kaanteinen = veroTyyppi(ehdotus.alvKoodi)?.kaanteinen ?? false;
    return `${prosentti(ehdotus.alvProsentti)}${kaanteinen ? ' käännetty' : ''} (historiasta)`;
  }
  if (kuitti.kaanteinenAlv) return 'käännetty';
  const kanta = kuitti.alv[0]?.kanta;
  return kanta !== undefined ? prosentti(kanta) : '—';
}

function tiedostonNimi(polku: string): string {
  return polku.split('/').pop() || polku;
}

/**
 * Työlistarivin tarkennepaneeli (oikea sivupalkki): kuitin ja pankkitapahtuman tiedot rinnan,
 * kuitin liittäminen (tapahtumaan liittämättömistä kuiteista tai koneelta), tilin valinta,
 * käsikirjaus editorissa ja "muista tämä myyjä" -sääntö. Sääntö tallennetaan asetuksiin parentin
 * kautta (usePaivitaAsetukset + saannotAsetuksiksi); `onSaanto` kertoo onnistuiko tallennus,
 * ja epäonnistuessa valintaruutu palautuu tyhjäksi — muuten käyttäjä jäisi luulemaan sääntöä
 * tallennetuksi. Varsinainen virheviesti näytetään näkymän yläreunassa.
 */
export function RiviPaneeli({
  rivi,
  chart,
  onTili,
  onSaanto,
  samannimisia = 0,
  onSamaTiliKaikille,
  ehdokkaat = [],
  onLiitaKuitti,
  onIrrotaKuitti,
  omatLiitteet = [],
  onLisaaLiite,
  onPoistaLiite,
  onKirjaaKasin,
}: {
  rivi: TyolistaRivi;
  chart: readonly Tili[];
  onTili: (tili: number) => void;
  onSaanto: (hae: string, tili: number) => Promise<boolean>;
  /** Montako muuta kirjaamatonta samannimistä riviä on eri tilillä (0 = ei tarjousta). */
  samannimisia?: number;
  onSamaTiliKaikille?: () => void;
  /** Tapahtumaan liittämättömät kuitit läheisyysjärjestyksessä (kuittiEhdokkaat). */
  ehdokkaat?: readonly Kuittilahde[];
  onLiitaKuitti?: (tiedosto: string) => void;
  onIrrotaKuitti?: () => void;
  omatLiitteet?: readonly OmaLiite[];
  onLisaaLiite?: (l: LadattavaLiite) => Promise<void>;
  onPoistaLiite?: (id: number) => void;
  onKirjaaKasin?: () => void;
}): React.ReactElement {
  const [saantoValittu, setSaantoValittu] = useState(false);
  const [kaikkiEhdokkaat, setKaikkiEhdokkaat] = useState(false);
  const kuitti = rivi.kuitti?.kuitti;
  const saantoNimi = kuitti?.myyja ?? rivi.tapahtuma.nimi;
  const kirjattu = rivi.tila === 'joKirjattu';
  const naytettavat = kaikkiEhdokkaat ? ehdokkaat : ehdokkaat.slice(0, EHDOKKAITA_ALUKSI);
  const lahdetiedosto = rivi.kuitti
    ? tiedostonNimi(rivi.kuitti.tiedosto)
    : omatLiitteet.length > 0
      ? omatLiitteet.map((l) => l.nimi).join(', ')
      : 'Ei kuittia';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[14px] font-[650] text-[var(--text)]">{rivi.tapahtuma.nimi}</h2>
        <p className="mt-[2px] text-[12px] text-[var(--text-subtle)]">
          {muotoilePvm(rivi.tapahtuma.pvm)}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <dt className={OTSIKKO_LUOKKA}>Pankin määrä</dt>
        <dd className={`${ARVO_LUOKKA} tabular-nums`}>{muotoileEuro(rivi.tapahtuma.maara)}</dd>

        <dt className={OTSIKKO_LUOKKA}>Lähdetiedosto</dt>
        <dd className={`${ARVO_LUOKKA} [overflow-wrap:anywhere]`}>{lahdetiedosto}</dd>

        <dt className={OTSIKKO_LUOKKA}>Myyjä</dt>
        <dd className={ARVO_LUOKKA}>{kuitti?.myyja ?? '—'}</dd>

        <dt className={OTSIKKO_LUOKKA}>Kuitin summa</dt>
        <dd className={`${ARVO_LUOKKA} tabular-nums`}>
          {kuitti?.bruttoSumma !== undefined ? muotoileEuro(kuitti.bruttoSumma) : '—'}
        </dd>

        <dt className={OTSIKKO_LUOKKA}>Alv-käsittely</dt>
        <dd className={ARVO_LUOKKA}>{alvTeksti(rivi)}</dd>
      </dl>

      {!kirjattu && rivi.kuitti && onIrrotaKuitti && (
        <button
          type="button"
          onClick={onIrrotaKuitti}
          className="self-start text-[11.5px] text-[var(--accent)] underline"
        >
          Irrota kuitti
        </button>
      )}

      {!kirjattu && !rivi.kuitti && onLiitaKuitti && naytettavat.length > 0 && (
        <section aria-label="liitettävät kuitit" className="flex flex-col gap-1">
          <span className={OTSIKKO_LUOKKA}>Liitä kuitti</span>
          <ul className="flex flex-col">
            {naytettavat.map((k) => (
              <li key={k.tiedosto}>
                <button
                  type="button"
                  aria-label={`Liitä ${tiedostonNimi(k.tiedosto)}`}
                  onClick={() => onLiitaKuitti(k.tiedosto)}
                  className="flex w-full flex-col rounded-[6px] px-2 py-[5px] text-left hover:bg-[var(--bg-subtle)]"
                >
                  <span className="text-[12.5px] text-[var(--text)] [overflow-wrap:anywhere]">
                    {tiedostonNimi(k.tiedosto)}
                  </span>
                  <span className="text-[11.5px] tabular-nums text-[var(--text-subtle)]">
                    {[
                      k.kuitti.myyja,
                      k.kuitti.bruttoSumma !== undefined
                        ? muotoileEuro(k.kuitti.bruttoSumma)
                        : undefined,
                      k.kuitti.pvm ? muotoilePvm(k.kuitti.pvm) : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {ehdokkaat.length > EHDOKKAITA_ALUKSI && (
            <button
              type="button"
              onClick={() => setKaikkiEhdokkaat((k) => !k)}
              className="self-start text-[11.5px] text-[var(--accent)] underline"
            >
              {kaikkiEhdokkaat ? 'Näytä vähemmän' : `Näytä kaikki (${ehdokkaat.length})`}
            </button>
          )}
        </section>
      )}

      {!kirjattu && onLisaaLiite && (
        <div className="flex flex-col gap-1">
          {omatLiitteet.length > 0 && (
            <ul aria-label="omat liitteet" className="flex flex-col gap-1">
              {omatLiitteet.map((l) => (
                <li key={l.id} className="flex items-center gap-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{l.nimi}</span>
                  {onPoistaLiite && (
                    <button
                      type="button"
                      aria-label={`Poista ${l.nimi}`}
                      onClick={() => onPoistaLiite(l.id)}
                      className="text-[11.5px] text-[var(--danger)] underline"
                    >
                      Poista
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <LiitteidenLataus onLataa={onLisaaLiite} />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className={OTSIKKO_LUOKKA}>Tili</span>
        <TiliValitsin tilit={chart} arvo={rivi.tili} ariaLabel="Tili" onValitse={onTili} />
        {rivi.ehdotus !== undefined && rivi.ehdotus.tili === rivi.tili && (
          <span className="text-[11.5px] text-[var(--text-subtle)]">
            {rivi.ehdotus.peruste === 'omistaja'
              ? 'Ehdotus: omistajan yksityistili'
              : 'Ehdotus kirjaushistoriasta'}
            {rivi.ehdotus.otsikko ? ` · otsikko "${rivi.ehdotus.otsikko}"` : ''}
          </span>
        )}
        {rivi.tili !== undefined && samannimisia > 0 && onSamaTiliKaikille && (
          <button
            type="button"
            onClick={onSamaTiliKaikille}
            className="self-start text-[11.5px] text-[var(--accent)] underline"
          >
            Sama tili kaikille samannimisille ({samannimisia})
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={saantoValittu}
          disabled={rivi.tili === undefined}
          onChange={(e) => {
            const valittu = e.target.checked;
            setSaantoValittu(valittu);
            if (!valittu || rivi.tili === undefined) return;
            void onSaanto(saantoNimi, rivi.tili).then((ok) => {
              if (!ok) setSaantoValittu(false);
            });
          }}
        />
        Kirjaa {saantoNimi} aina tilille {rivi.tili ?? '—'}
      </label>

      {!kirjattu && onKirjaaKasin && (
        <Button variant="sec" size="compact" type="button" onClick={onKirjaaKasin}>
          Kirjaa käsin
        </Button>
      )}
    </div>
  );
}
