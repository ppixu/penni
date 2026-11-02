import { Button } from '@/components/ui/button';
import type { Kumppani } from '@penni/engine';
import { useState } from 'react';

/** Lisää `uudet` vastaanottajat `nykyiset`-listan perään; jo listalla oleva ohitetaan. */
export function lisaaVastaanottajat(nykyiset: readonly number[], uudet: readonly number[]) {
  return [...new Set([...nykyiset, ...uudet])];
}

/**
 * Ryhmälaskun vastaanottajalista (spec §6.2): haku, klikkaus lisää, "Lisää kaikki" lisää
 * suodatetun joukon, ja lisätyn voi poistaa. Ei kielisaraketta (laskut ovat vain suomeksi).
 */
export function VastaanottajaLista({
  kumppanit,
  valitut,
  onMuutos,
}: {
  kumppanit: readonly Kumppani[];
  valitut: readonly number[];
  onMuutos: (valitut: number[]) => void;
}) {
  const [haku, setHaku] = useState('');
  const nimet = new Map(kumppanit.map((k) => [k.id, k.nimi]));
  const haettu = haku.trim().toLowerCase();
  const ehdokkaat = kumppanit.filter(
    (k) => !valitut.includes(k.id) && k.nimi.toLowerCase().includes(haettu),
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="search"
          aria-label="Hae asiakasta"
          placeholder="Hae asiakasta"
          value={haku}
          onChange={(e) => setHaku(e.target.value)}
          className="flex-1 rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] font-normal normal-case tracking-normal text-[var(--text)]"
        />
        <Button
          type="button"
          variant="sec"
          size="compact"
          disabled={ehdokkaat.length === 0}
          onClick={() =>
            onMuutos(
              lisaaVastaanottajat(
                valitut,
                ehdokkaat.map((k) => k.id),
              ),
            )
          }
        >
          Lisää kaikki
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 font-normal normal-case tracking-normal">
        <ul
          aria-label="Asiakkaat"
          className="flex max-h-[220px] flex-col overflow-auto rounded-[var(--radius-input)] border border-[var(--border)]"
        >
          {ehdokkaat.length === 0 && (
            <li className="px-2 py-1.5 text-[12px] text-[var(--text-subtle)]">Ei asiakkaita</li>
          )}
          {ehdokkaat.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                aria-label={`Lisää ${k.nimi}`}
                onClick={() => onMuutos(lisaaVastaanottajat(valitut, [k.id]))}
                className="w-full px-2 py-1.5 text-left text-[12.5px] text-[var(--text)] hover:bg-[var(--accent-soft)]"
              >
                {k.nimi}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-1">
          <p className="text-[12px] font-semibold text-[var(--text-muted)]">
            {valitut.length === 1 ? '1 vastaanottaja' : `${valitut.length} vastaanottajaa`}
          </p>
          {valitut.length > 0 && (
            <ul
              aria-label="Vastaanottajat"
              className="flex max-h-[220px] flex-col overflow-auto rounded-[var(--radius-input)] border border-[var(--border)]"
            >
              {valitut.map((id) => (
                <li key={id} className="flex items-center justify-between px-2 py-1 text-[12.5px]">
                  <span>{nimet.get(id) ?? String(id)}</span>
                  <button
                    type="button"
                    aria-label={`Poista ${nimet.get(id) ?? String(id)}`}
                    onClick={() => onMuutos(valitut.filter((v) => v !== id))}
                    className="px-1.5 text-[var(--text-subtle)] hover:text-[var(--danger)]"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
