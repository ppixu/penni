import { useLuoToistoLaskusta } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { type IsoDate, type StoredTosite, type Toisto, siirraKuukausia } from '@penni/engine';
import { useState } from 'react';

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA_LUOKKA =
  'rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] normal-case tracking-normal';

/** Väli kentästä: kokonaisluku ≥ 1, muuten null. */
function lueVali(teksti: string): number | null {
  const n = Number(teksti);
  return /^\d+$/.test(teksti.trim()) && n >= 1 ? n : null;
}

/**
 * "Toista"-dialogi kirjatun myyntilaskun sivulla (spec §5.2): toistoväli kuukausina (oletus 1),
 * ensimmäinen seuraava laskupäivä (oletus laskupvm + väli, kuun loppu säilyy kuun loppuna) ja
 * valinnainen päättymispäivä. Luo Toiston laskusta (`luoToistoLaskusta`); luonnokset syntyvät
 * erääntyessään (kirjan avauksessa tai Toistuvat laskut -listan napista).
 */
export function ToistoDialog({
  tosite,
  onPeruuta,
  onValmis,
}: {
  tosite: StoredTosite;
  onPeruuta: () => void;
  onValmis: (toisto: Toisto) => void;
}) {
  const { luo, virheviesti, luomassa } = useLuoToistoLaskusta();
  const laskupvm = tosite.laskupvm ?? tosite.pvm;
  const [valiTeksti, setValiTeksti] = useState('1');
  // Seuraava päivä johdetaan välistä, kunnes käyttäjä kirjoittaa sen itse.
  const [seuraavaOma, setSeuraavaOma] = useState<string | null>(null);
  const [loppuu, setLoppuu] = useState('');
  const [lomakevirhe, setLomakevirhe] = useState<string | null>(null);

  const kuukausia = lueVali(valiTeksti);
  const seuraava = seuraavaOma ?? siirraKuukausia(laskupvm, kuukausia ?? 1);

  async function laheta() {
    setLomakevirhe(null);
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
    const toisto = await luo({
      tosite: tosite.id,
      kuukausia,
      seuraava: seuraava as IsoDate,
      ...(loppuu !== '' ? { loppuu: loppuu as IsoDate } : {}),
    });
    if (toisto) onValmis(toisto);
  }

  const virhe = lomakevirhe ?? virheviesti;

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
      role="dialog"
      aria-modal="true"
      aria-label="Toista lasku"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-[400px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
        <h2 className="mb-1 text-[15px] font-[650]">Toista lasku</h2>
        <p className="mb-4 text-[12.5px] text-[var(--text-muted)]">
          Uusi laskuluonnos syntyy Lähtevät-listaan aina seuraavana laskupäivänä.
        </p>
        <div className="flex flex-col gap-3">
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
              onChange={(e) => setSeuraavaOma(e.target.value)}
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
          <Button type="button" disabled={luomassa} onClick={() => void laheta()}>
            Luo toisto
          </Button>
        </div>
      </div>
    </div>
  );
}
