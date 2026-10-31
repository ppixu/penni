import { usePaivitaAsetukset } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { paikallinenTanaan } from '@/tositteet/pikavalinnat';
import type { Asetukset } from '@penni/engine';
import { muotoilePvm } from '@penni/euro';
import { useState } from 'react';
import {
  type KausiKk,
  historiaAsetuksiksi,
  kausiKkPaivalle,
  lisaaVerokausiMuutos,
  muutoksenAlku,
  onKaudenAlku,
  peruTulevatMuutokset,
  verokausiHistoria,
} from './alvKaudet.js';

export const KAUSINIMET: Record<KausiKk, string> = {
  1: 'Kuukausi',
  3: 'Neljännesvuosi',
  12: 'Vuosi',
};

const ALKUPAIVA: Record<KausiKk, string> = {
  1: 'kuukauden',
  3: 'neljännesvuoden',
  12: 'vuoden',
};

const PITUUDET: readonly KausiKk[] = [1, 3, 12];

/**
 * Alv-verokauden pituuden historia ja muutos (vero.fi "Verokauden muutos"). Muutos kirjataan
 * alkupäivällä, joten menneet kaudet säilyttävät pituutensa. Oletusalku seuraa lakia: pidempi
 * kausi seuraavan vuoden alusta, lyhyempi seuraavan lyhyemmän kauden alusta; käyttäjä voi
 * korjata sen Verohallinnon päätöksen mukaiseksi. Tallentuu heti omalla napillaan.
 */
export function VerokausiMuutokset({ asetukset }: { asetukset: Asetukset }) {
  const tanaan = paikallinenTanaan();
  const historia = verokausiHistoria(asetukset);
  const nyt = kausiKkPaivalle(historia, tanaan);
  const { tallenna, virheviesti, tallentaa } = usePaivitaAsetukset();
  const [muokkaa, setMuokkaa] = useState(false);
  const [uusi, setUusi] = useState<KausiKk>(nyt);
  // null = lain mukainen oletusalku; tyhjennetty kenttä pysyy tyhjänä, jotta päivän voi kirjoittaa.
  const [alkaa, setAlkaa] = useState<string | null>(null);

  const oletusAlku = muutoksenAlku(historia, uusi, tanaan);
  const alku = alkaa ?? oletusAlku ?? '';
  const virhe =
    alku !== '' && !onKaudenAlku(alku, uusi)
      ? `${KAUSINIMET[uusi]} voi alkaa vain ${ALKUPAIVA[uusi]} ensimmäisestä päivästä.`
      : null;
  const tulevia = historia.some((r) => r.alkaa > tanaan);

  const valitse = (kk: KausiKk) => {
    setUusi(kk);
    setAlkaa(null);
  };
  const tallennaMuutos = async () => {
    if (alku === '' || virhe) return;
    const ok = await tallenna(
      historiaAsetuksiksi(lisaaVerokausiMuutos(historia, alku, uusi), tanaan),
    );
    if (ok) setMuokkaa(false);
  };
  const peruTulevat = () =>
    void tallenna(historiaAsetuksiksi(peruTulevatMuutokset(historia, tanaan), tanaan));

  return (
    <div className="flex flex-col gap-2 text-[12.5px]">
      <ul aria-label="verokausihistoria" className="flex flex-col gap-[2px]">
        {historia.map((r) => {
          const tuleva = r.alkaa > tanaan;
          return (
            <li key={r.alkaa} className="flex items-center gap-2">
              <span className="font-semibold">{KAUSINIMET[r.kk]}</span>
              <span className="text-[var(--text-muted)]">
                {r.alkaa === '' ? 'kirjanpidon alusta' : `${muotoilePvm(r.alkaa)} alkaen`}
              </span>
              {tuleva && (
                <span className="rounded-full bg-[var(--accent-soft)] px-2 py-[1px] text-[11px] font-semibold text-[var(--accent)]">
                  Tulossa
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {virheviesti && <p className="text-[var(--danger)]">{virheviesti}</p>}

      {!muokkaa ? (
        <div className="flex gap-2">
          <Button type="button" variant="sec" size="compact" onClick={() => setMuokkaa(true)}>
            Muuta verokautta
          </Button>
          {tulevia && (
            <Button
              type="button"
              variant="ghost"
              size="compact"
              disabled={tallentaa}
              onClick={peruTulevat}
            >
              Peru tuleva muutos
            </Button>
          )}
        </div>
      ) : (
        <div className="flex max-w-md flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
          <fieldset className="inline-flex w-fit gap-[2px] rounded-[9px] bg-[var(--track)] p-[3px]">
            <legend className="sr-only">Uusi verokausi</legend>
            {PITUUDET.map((kk) => (
              <button
                key={kk}
                type="button"
                aria-pressed={uusi === kk}
                onClick={() => valitse(kk)}
                className={`whitespace-nowrap rounded-[6px] px-[13px] py-1.5 text-[12.5px] ${
                  uusi === kk
                    ? 'bg-[var(--surface)] font-semibold text-[var(--accent)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                    : 'font-medium text-[var(--text-muted)]'
                }`}
              >
                {KAUSINIMET[kk]}
              </button>
            ))}
          </fieldset>
          {uusi === nyt && alkaa === null ? (
            <p className="text-[var(--text-muted)]">
              Verokausi on nyt {KAUSINIMET[nyt].toLowerCase()}.
            </p>
          ) : (
            <label className="flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
              Alkaen
              <input
                type="date"
                aria-label="Uusi verokausi alkaen"
                value={alku}
                onChange={(e) => setAlkaa(e.target.value)}
                className="w-fit rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] font-normal normal-case tracking-normal text-[var(--text)]"
              />
            </label>
          )}
          {virhe && <p className="text-[var(--danger)]">{virhe}</p>}
          <p className="text-[12px] leading-snug text-[var(--text-muted)]">
            Kuukausi on oletus. Neljännesvuosi on mahdollinen, kun liikevaihto on alle 100 000 €,
            vuosi alle 30 000 €. Pidempi kausi alkaa hakemusta seuraavan vuoden alusta, lyhyempi
            seuraavan kauden alusta, ja valittua kautta noudatetaan vähintään vuosi. Hae muutos
            OmaVerossa (Asiakastiedot → Yritystoiminta → Muuta verokausi) ja merkitse tähän
            Verohallinnon päätöksen alkupäivä.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="compact"
              disabled={
                tallentaa || alku === '' || virhe !== null || (uusi === nyt && alkaa === null)
              }
              onClick={() => void tallennaMuutos()}
            >
              Tallenna muutos
            </Button>
            <Button type="button" variant="ghost" size="compact" onClick={() => setMuokkaa(false)}>
              Peruuta
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
