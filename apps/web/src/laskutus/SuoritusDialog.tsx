import { useTallennaSuoritus } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { EuroInput } from '@/editori/EuroInput';
import { TiliValitsin } from '@/editori/TiliValitsin';
import type { Tili } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { useState } from 'react';

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA_LUOKKA =
  'rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]';

/** Suoritettavan laskun vähimmäistiedot — sekä MyyntilaskuRivi että OstolaskuRivi täyttää tämän. */
export interface SuoritettavaLasku {
  tosite: number;
  avoin: Cents;
  numero?: string;
  viite?: string;
}

/**
 * Maksun kirjaus laskun erälle (TiliEditori-dialogimalli). Summa esitäytetään avoimella;
 * osittainen ja ylisuoritus ovat sallittuja (moottorisemantiikka). Rahatili esivalitaan
 * LaskuMaksutili-asetuksesta (parent lukee sen tiliAsetuksesta-helperillä); jos käyttäjä
 * ei valitse tiliä, syötteestä jätetään rahatili pois ja moottori lukee saman asetuksen.
 */
export function SuoritusDialog({
  lasku,
  tilit,
  oletusRahatili,
  onSuljeJaPaivita,
  onPeruuta,
}: {
  lasku: SuoritettavaLasku;
  tilit: readonly Tili[];
  oletusRahatili?: number | undefined;
  onSuljeJaPaivita: () => void;
  onPeruuta: () => void;
}) {
  const { tallenna, virheviesti, tallentaa } = useTallennaSuoritus();
  const [pvm, setPvm] = useState(() => new Date().toISOString().slice(0, 10));
  const [summa, setSumma] = useState<Cents>(lasku.avoin);
  const [rahatili, setRahatili] = useState<number | undefined>(oletusRahatili);
  const [otsikko, setOtsikko] = useState(
    `Suoritus: lasku ${lasku.numero ?? lasku.viite ?? ''}`.trim(),
  );

  async function lahetaTallennus() {
    const stored = await tallenna({
      tosite: lasku.tosite,
      pvm,
      summa,
      ...(rahatili !== undefined ? { rahatili } : {}),
      ...(otsikko.trim() !== '' ? { otsikko: otsikko.trim() } : {}),
    });
    if (stored) onSuljeJaPaivita();
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
      role="dialog"
      aria-modal="true"
      aria-label="Kirjaa maksu"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-[420px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
        <h2 className="mb-4 text-[15px] font-[650]">Kirjaa maksu</h2>
        <div className="flex flex-col gap-3">
          <label className={LABEL_LUOKKA}>
            Maksupäivä
            <input
              type="date"
              aria-label="Maksupäivä"
              value={pvm}
              onChange={(e) => setPvm(e.target.value)}
              className={`${KENTTA_LUOKKA} tabular-nums`}
            />
          </label>
          <div className={LABEL_LUOKKA}>
            Summa
            <div className={KENTTA_LUOKKA}>
              <EuroInput arvo={summa} aria-label="Summa" onCommit={(snt) => setSumma(snt)} />
            </div>
          </div>
          <div className={LABEL_LUOKKA}>
            Rahatili
            <TiliValitsin
              tilit={tilit}
              arvo={rahatili}
              ariaLabel="Rahatili"
              onValitse={(numero) => setRahatili(numero)}
            />
          </div>
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
          {virheviesti && <p className="text-[12.5px] text-[var(--danger)]">{virheviesti}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="sec" type="button" onClick={onPeruuta}>
            Peruuta
          </Button>
          <Button type="button" disabled={tallentaa} onClick={() => void lahetaTallennus()}>
            Tallenna
          </Button>
        </div>
      </div>
    </div>
  );
}
