import { Button } from '@/components/ui/button';
import { Luonne, type Tili, type TilioteTiedot, nimi, onko } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { useState } from 'react';
import { EuroInput } from './EuroInput.js';

const OTSIKKO =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA =
  'rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] font-normal normal-case tracking-normal text-[var(--text)]';

/**
 * Tiliote-tyypin tositteen tiedot (Kitsas Tosite::TILIOTE): pankkitili, kausi sekä pankin
 * ilmoittamat alku- ja loppusaldo. "Lue liitteestä" poimii ne liitteenä olevasta tiliote-PDF:stä.
 * Tositelista vertaa loppusaldoa kirjanpidon pankkitilin saldoon kauden viimeisenä päivänä.
 */
export function TiliotePaneeli({
  tiliote,
  chart,
  pankkitili,
  onMuutos,
  onLue,
}: {
  tiliote: TilioteTiedot | undefined;
  chart: readonly Tili[];
  pankkitili: number | undefined;
  onMuutos: (tiliote: TilioteTiedot) => void;
  /** Lue tiedot tositteen liitteestä: tiedot tai virheteksti. Puuttuu = ei liitettä luettavaksi. */
  onLue?: (() => Promise<TilioteTiedot | string>) | undefined;
}) {
  const [luetaan, setLuetaan] = useState(false);
  const [viesti, setViesti] = useState<string | null>(null);
  const pankkitilit = chart.filter((t) => t.otsikkotaso === 0 && onko(t.luonne, Luonne.RAHAVARAT));
  const nyt: TilioteTiedot = tiliote ?? {
    tili: pankkitili ?? pankkitilit[0]?.numero ?? 0,
    alkupvm: '',
    loppupvm: '',
  };
  const muuta = (muutos: Partial<TilioteTiedot>) => onMuutos({ ...nyt, ...muutos });
  const saldo = (kentta: 'alkusaldo' | 'loppusaldo') => (snt: Cents) => muuta({ [kentta]: snt });

  async function lue() {
    if (!onLue) return;
    setLuetaan(true);
    setViesti(null);
    try {
      const tulos = await onLue();
      if (typeof tulos === 'string') setViesti(tulos);
      else onMuutos(tulos);
    } finally {
      setLuetaan(false);
    }
  }

  return (
    <section
      aria-label="tiliote"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Tiliote</h2>
        {onLue && (
          <Button
            type="button"
            variant="sec"
            size="compact"
            disabled={luetaan}
            onClick={() => void lue()}
          >
            {luetaan ? 'Luetaan…' : 'Lue liitteestä'}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className={OTSIKKO}>
          Pankkitili
          <select
            aria-label="Tiliotteen pankkitili"
            value={nyt.tili}
            onChange={(e) => muuta({ tili: Number(e.target.value) })}
            className={KENTTA}
          >
            {pankkitilit.map((t) => (
              <option key={t.numero} value={t.numero}>
                {t.numero} {nimi(t)}
              </option>
            ))}
          </select>
        </label>
        <label className={OTSIKKO}>
          Alkaen
          <input
            type="date"
            aria-label="Tiliotteen kausi alkaen"
            value={nyt.alkupvm}
            onChange={(e) => muuta({ alkupvm: e.target.value })}
            className={KENTTA}
          />
        </label>
        <label className={OTSIKKO}>
          Päättyen
          <input
            type="date"
            aria-label="Tiliotteen kausi päättyen"
            value={nyt.loppupvm}
            onChange={(e) => muuta({ loppupvm: e.target.value })}
            className={KENTTA}
          />
        </label>
        <div className={OTSIKKO}>
          Alkusaldo
          <EuroInput
            aria-label="Tiliotteen alkusaldo"
            arvo={(nyt.alkusaldo ?? 0) as Cents}
            onCommit={saldo('alkusaldo')}
            className={`${KENTTA} w-[130px] text-right tabular-nums`}
          />
        </div>
        <div className={OTSIKKO}>
          Loppusaldo
          <EuroInput
            aria-label="Tiliotteen loppusaldo"
            arvo={(nyt.loppusaldo ?? 0) as Cents}
            onCommit={saldo('loppusaldo')}
            className={`${KENTTA} w-[130px] text-right tabular-nums`}
          />
        </div>
      </div>
      {viesti && <p className="text-[12.5px] text-[var(--danger)]">{viesti}</p>}
    </section>
  );
}
