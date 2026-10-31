import { annaKirjatSilta, onkoKirjatSilta, tiedostonimi } from '@/kirjat/silta';
import { cn } from '@/lib/utils';
import type { KirjaTiedot } from '@penni/tuonti';
import { Check, ChevronsUpDown, FolderOpen, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Sivupalkin alaosa: yrityksen nimi (tilikausi valitaan sivupalkin yläosasta). Työpöytäsovelluksessa se on myös kirjanvaihtaja,
 * joka näyttää avoimen `.penni`-tiedoston nimen — testikopio ja oikea kirja eivät sekoitu — ja
 * avaa listan viimeksi avatuista kirjoista. Muokkaa-tilassa listalta voi poistaa kirjoja (ei tiedostoja).
 */
export function KirjanVaihto({ kirjanpito }: { kirjanpito: string }) {
  const [tiedot, setTiedot] = useState<KirjaTiedot | null>(null);
  const [auki, setAuki] = useState(false);
  const [muokkaus, setMuokkaus] = useState(false);
  const juuri = useRef<HTMLDivElement>(null);
  const tyopoyta = onkoKirjatSilta();

  useEffect(() => {
    if (!tyopoyta) return;
    let voimassa = true;
    annaKirjatSilta()
      .kirjat()
      .then((t) => {
        if (voimassa) setTiedot(t);
      })
      .catch(() => {
        // Ilman tietoja näytetään pelkkä yrityksen nimi; vaihtaja toimii silti valikosta.
      });
    return () => {
      voimassa = false;
    };
  }, [tyopoyta]);

  useEffect(() => {
    if (!auki) {
      setMuokkaus(false);
      return;
    }
    const ulkopuolinen = (e: MouseEvent) => {
      if (juuri.current && !juuri.current.contains(e.target as Node)) setAuki(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAuki(false);
    };
    document.addEventListener('mousedown', ulkopuolinen);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', ulkopuolinen);
      document.removeEventListener('keydown', esc);
    };
  }, [auki]);

  const tiedosto = tiedot?.nykyinen ? tiedostonimi(tiedot.nykyinen) : null;

  const teksti = (
    <>
      <div className="truncate font-medium text-[var(--text-muted)]">{kirjanpito}</div>
      {tiedosto && (
        <div className="truncate" title={tiedot?.nykyinen ?? undefined}>
          {tiedosto}
        </div>
      )}
    </>
  );

  if (!tyopoyta) {
    return (
      <div className="mt-auto px-[5px] text-[10.5px] leading-tight text-[var(--text-subtle)]">
        {teksti}
      </div>
    );
  }

  const vaihda = (polku: string) => {
    setAuki(false);
    // Vaihto lataa ikkunan uudelleen toisen kirjan palvelimelle, joten lupausta ei odoteta.
    void annaKirjatSilta().vaihdaKirja(polku);
  };
  const avaaMuu = () => {
    setAuki(false);
    void annaKirjatSilta().valitseKirja();
  };
  const silta = annaKirjatSilta();
  // Vanha työpöytäversio voi tarjota kirjanvaihdon ilman poistoa; silloin Muokkaa ei näy.
  const voiPoistaa =
    typeof (silta as Partial<typeof silta>).poistaViimeisin === 'function' &&
    (tiedot?.viimeisimmat ?? []).some((p) => p !== tiedot?.nykyinen);
  const poista = (polku: string) => {
    setTiedot((t) => t && { ...t, viimeisimmat: t.viimeisimmat.filter((p) => p !== polku) });
    silta.poistaViimeisin(polku).catch(() => {
      // Pääprosessi hylkäsi poiston: palautetaan lista sen mukaiseksi.
      void silta.kirjat().then(setTiedot);
    });
  };

  return (
    <div ref={juuri} className="relative mt-auto">
      {auki && (
        <div
          role="menu"
          aria-label="Vaihda kirjanpitoa"
          className="absolute bottom-full left-0 z-20 mb-1 w-[260px] rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-1 text-[12px] shadow-lg"
        >
          <div className="flex items-baseline justify-between px-2 pb-1 pt-[3px] text-[10.5px] font-medium text-[var(--text-subtle)]">
            Viimeksi avatut
            {(voiPoistaa || muokkaus) && (
              <button
                type="button"
                aria-pressed={muokkaus}
                onClick={() => setMuokkaus((m) => !m)}
                className="rounded-[4px] px-1 text-[var(--accent)] hover:underline"
              >
                {muokkaus ? 'Valmis' : 'Muokkaa'}
              </button>
            )}
          </div>
          {(tiedot?.viimeisimmat ?? []).map((polku) => {
            const nykyinen = polku === tiedot?.nykyinen;
            if (muokkaus && !nykyinen) {
              return (
                <div
                  key={polku}
                  title={polku}
                  className="flex w-full items-center gap-2 rounded-[6px] px-2 py-[6px]"
                >
                  <span className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{tiedostonimi(polku)}</span>
                  <button
                    type="button"
                    aria-label={`Poista listalta: ${tiedostonimi(polku)}`}
                    title="Poista listalta (tiedosto säilyy)"
                    onClick={() => poista(polku)}
                    className="-my-1 -mr-1 rounded-[4px] p-1 text-[var(--text-muted)] hover:bg-[var(--track)] hover:text-[var(--text)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            }
            return (
              <button
                key={polku}
                type="button"
                role="menuitem"
                title={polku}
                disabled={nykyinen}
                onClick={() => vaihda(polku)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[6px] px-2 py-[6px] text-left',
                  nykyinen ? 'font-semibold text-[var(--text)]' : 'hover:bg-[var(--track)]',
                )}
              >
                <Check
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    nykyinen ? 'text-[var(--accent)]' : 'invisible',
                  )}
                />
                <span className="truncate">{tiedostonimi(polku)}</span>
              </button>
            );
          })}
          <div className="my-1 border-t border-[var(--border)]" />
          <button
            type="button"
            role="menuitem"
            onClick={avaaMuu}
            className="flex w-full items-center gap-2 rounded-[6px] px-2 py-[6px] text-left hover:bg-[var(--track)]"
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
            Avaa muu kirjanpito…
          </button>
        </div>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={auki}
        onClick={() => setAuki((a) => !a)}
        className="flex w-full items-center gap-1 rounded-[8px] px-[5px] py-[5px] text-left text-[10.5px] leading-tight text-[var(--text-subtle)] hover:bg-[var(--track)]"
      >
        <div className="min-w-0 flex-1">{teksti}</div>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0" />
      </button>
    </div>
  );
}
