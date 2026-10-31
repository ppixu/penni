import { usePoistaTili, useTallennaTili, useViennit } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { type Tili, type TiliData, nimi as tiliNimi } from '@penni/engine';
import { useMemo, useState } from 'react';
import {
  onVaroTyyppi,
  tarkistaNumero,
  tarvitseekoVahvistuksen,
  tyyppiSuodatin,
} from './tilikartta.js';

/** Edit (existing leaf) or add (no `tili`). On success the parent closes the dialog. */
export function TiliEditori({
  tili,
  kartta,
  onSuljeJaPaivita,
  onPeruuta,
}: {
  tili?: Tili | undefined;
  kartta: readonly Tili[];
  onSuljeJaPaivita: () => void;
  onPeruuta: () => void;
}) {
  const muokkaa = tili !== undefined;
  const { tallenna, virheviesti, tallentaa } = useTallennaTili();
  const { poista, virheviesti: poistoVirhe, poistaa } = usePoistaTili();
  // Only fetch postings in edit mode; in add mode the account has no number yet.
  const { data: viennit } = useViennit(muokkaa ? tili.numero : 0, muokkaa);
  const onVientejä = (viennit?.length ?? 0) > 0;
  const varo = muokkaa && onVaroTyyppi(tili.tyyppiKoodi);
  const poistoEstetty = onVientejä || varo;
  const poistoSyy = varo
    ? 'Erityistiliä ei voi poistaa.'
    : onVientejä
      ? 'Tilillä on vientejä, joten sitä ei voi poistaa.'
      : null;

  async function lahetaPoisto() {
    if (!muokkaa || poistoEstetty) return;
    const ok = await poista(tili.numero);
    if (ok) onSuljeJaPaivita();
  }

  const [numero, setNumero] = useState(muokkaa ? String(tili.numero) : '');
  const [nimi, setNimi] = useState(muokkaa ? tiliNimi(tili) : '');
  const [tyyppi, setTyyppi] = useState(muokkaa ? tili.tyyppiKoodi : '');
  const [ohje, setOhje] = useState(
    muokkaa && typeof tili.data.ohje === 'string' ? tili.data.ohje : '',
  );
  const [paikallinenVirhe, setPaikallinenVirhe] = useState<string | null>(null);

  const tyypit = useMemo(() => tyyppiSuodatin(numero), [numero]);

  async function lahetaTallennus() {
    setPaikallinenVirhe(null);
    const n = Number(numero);

    if (!muokkaa) {
      const virhe = tarkistaNumero(n, kartta);
      if (virhe) {
        setPaikallinenVirhe(virhe);
        return;
      }
    }
    if (nimi.trim() === '') {
      setPaikallinenVirhe('Anna tilin nimi.');
      return;
    }
    if (tyyppi === '') {
      setPaikallinenVirhe('Valitse tilin tyyppi.');
      return;
    }
    const vanhaKoodi = muokkaa ? tili.tyyppiKoodi : '';
    if (tarvitseekoVahvistuksen(vanhaKoodi, tyyppi)) {
      const ok = window.confirm(
        'Valittu tilityyppi vaikuttaa erityisellä tavalla kirjanpidon toimintaan. Jatketaanko?',
      );
      if (!ok) return;
    }

    // Preserve existing chart keys when editing; set ohje conditionally (exactOptionalPropertyTypes).
    const data: TiliData = {
      ...(muokkaa ? tili.data : {}),
      numero: n,
      tyyppi,
      nimi: { fi: nimi.trim() },
      ...(ohje.trim() !== '' ? { ohje: ohje.trim() } : {}),
    };
    const ok = await tallenna(n, data);
    if (ok) onSuljeJaPaivita();
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
      role="dialog"
      aria-modal="true"
      aria-label={muokkaa ? 'Muokkaa tiliä' : 'Uusi tili'}
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-[420px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
        <h2 className="mb-4 text-[15px] font-[650]">{muokkaa ? 'Muokkaa tiliä' : 'Uusi tili'}</h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
            Tilinumero
            <input
              aria-label="Tilinumero"
              value={numero}
              disabled={muokkaa}
              inputMode="numeric"
              onChange={(e) => setNumero(e.target.value)}
              className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] tabular-nums disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
            Nimi
            <input
              aria-label="Nimi"
              value={nimi}
              onChange={(e) => setNimi(e.target.value)}
              className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
            Tyyppi
            <select
              aria-label="Tyyppi"
              value={tyyppi}
              onChange={(e) => setTyyppi(e.target.value)}
              className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]"
            >
              <option value="">Valitse…</option>
              {tyypit.map((t) => (
                <option key={t.koodi} value={t.koodi}>
                  {t.kuvaus}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
            Ohje
            <textarea
              aria-label="Ohje"
              value={ohje}
              onChange={(e) => setOhje(e.target.value)}
              rows={2}
              className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]"
            />
          </label>
          {(paikallinenVirhe ?? virheviesti ?? poistoVirhe ?? poistoSyy) && (
            <p className="text-[12.5px] text-[var(--danger)]">
              {paikallinenVirhe ?? virheviesti ?? poistoVirhe ?? poistoSyy}
            </p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          {muokkaa && (
            <Button
              variant="sec"
              type="button"
              disabled={poistoEstetty || poistaa}
              onClick={lahetaPoisto}
              className="mr-auto text-[var(--danger)]"
            >
              Poista
            </Button>
          )}
          <Button variant="sec" type="button" onClick={onPeruuta}>
            Peruuta
          </Button>
          <Button type="button" disabled={tallentaa} onClick={lahetaTallennus}>
            Tallenna
          </Button>
        </div>
      </div>
    </div>
  );
}
