import { useTallennaToisto } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import type { Toisto } from '@penni/engine';
import { useState } from 'react';
import { lueVali } from './ToistoDialog';

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA_LUOKKA =
  'rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] normal-case tracking-normal';

/** Toisto on päättynyt: aktiivisuus pois ja seuraava päivä päättymispäivän jälkeen. */
function onPaattynyt(t: Toisto): boolean {
  return !t.aktiivinen && t.loppuu !== undefined && t.seuraava > t.loppuu;
}

/**
 * Toiston aikataulun muokkaus (spec §5.2): nimi, väli, seuraava päivä ja päättymispäivä.
 * Tallentaa `tallennaToisto({ ...toisto, ...muutokset })`; pohjaa ja lähdelaskua ei kosketa.
 * Tyhjä päättymispäivä poistaa `loppuu`-avaimen. Päättynyt toisto aktivoituu uudelleen, kun
 * muutos tuo seuraavan päivän takaisin rajojen sisään; käsin keskeytetty toisto pysyy
 * keskeytettynä.
 */
export function ToistoMuokkausDialog({
  toisto,
  onPeruuta,
  onValmis,
}: {
  toisto: Toisto;
  onPeruuta: () => void;
  onValmis: () => void;
}) {
  const { tallenna, virheviesti, tallentaa } = useTallennaToisto();
  const [nimi, setNimi] = useState(toisto.nimi ?? '');
  const [valiTeksti, setValiTeksti] = useState(String(toisto.kuukausia));
  const [seuraava, setSeuraava] = useState<string>(toisto.seuraava);
  const [loppuu, setLoppuu] = useState<string>(toisto.loppuu ?? '');
  const [lomakevirhe, setLomakevirhe] = useState<string | null>(null);

  async function laheta() {
    setLomakevirhe(null);
    const kuukausia = lueVali(valiTeksti);
    if (kuukausia === null) {
      setLomakevirhe('Toistovälin on oltava vähintään yksi kuukausi');
      return;
    }
    if (seuraava === '') {
      setLomakevirhe('Anna seuraava laskupäivä');
      return;
    }
    if (loppuu !== '' && loppuu < seuraava) {
      setLomakevirhe('Päättymispäivä ei voi olla ennen seuraavaa laskupäivää');
      return;
    }
    const { nimi: _nimi, loppuu: _loppuu, ...muut } = toisto;
    const nimiSiistitty = nimi.trim();
    const aktivoidaan = onPaattynyt(toisto);
    const talletettu = await tallenna({
      ...muut,
      ...(nimiSiistitty !== '' ? { nimi: nimiSiistitty } : {}),
      kuukausia,
      seuraava,
      ...(loppuu !== '' ? { loppuu } : {}),
      aktiivinen: aktivoidaan ? true : toisto.aktiivinen,
    });
    if (talletettu) onValmis();
  }

  const virhe = lomakevirhe ?? virheviesti;

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
      role="dialog"
      aria-modal="true"
      aria-label="Muokkaa toistoa"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-[400px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
        <h2 className="mb-4 text-[15px] font-[650]">Muokkaa toistoa</h2>
        <div className="flex flex-col gap-3">
          <label className={LABEL_LUOKKA}>
            Nimi (valinnainen)
            <input
              type="text"
              aria-label="Nimi (valinnainen)"
              value={nimi}
              onChange={(e) => setNimi(e.target.value)}
              className={KENTTA_LUOKKA}
            />
          </label>
          <label className={LABEL_LUOKKA}>
            Toistoväli kuukausina
            <input
              type="number"
              min={1}
              step={1}
              aria-label="Toistoväli kuukausina"
              value={valiTeksti}
              onChange={(e) => setValiTeksti(e.target.value)}
              className={`${KENTTA_LUOKKA} w-[110px] tabular-nums`}
            />
          </label>
          <label className={LABEL_LUOKKA}>
            Seuraava laskupäivä
            <input
              type="date"
              aria-label="Seuraava laskupäivä"
              value={seuraava}
              onChange={(e) => setSeuraava(e.target.value)}
              className={`${KENTTA_LUOKKA} tabular-nums`}
            />
          </label>
          <label className={LABEL_LUOKKA}>
            Päättyy (valinnainen)
            <input
              type="date"
              aria-label="Päättyy (valinnainen)"
              value={loppuu}
              onChange={(e) => setLoppuu(e.target.value)}
              className={`${KENTTA_LUOKKA} tabular-nums`}
            />
          </label>
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
