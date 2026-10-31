import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { type ReactNode, useState } from 'react';
import { LiiteEsikatselu, type NaytettavaLiite } from './LiiteEsikatselu.js';
import { Liitelista } from './Liitelista.js';

/**
 * Jaettu näkymä: pääsisältö vasemmalla, liitepaneeli oikealla; kapealla näytöllä paneeli
 * pinoutuu sisällön alle ja koko näkymä vierii yhtenä. `JAETTU_PAA` on pääsisällön luokat.
 */
export const JAETTU_ASETTELU =
  'flex min-h-0 flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden';
export const JAETTU_PAA = 'lg:min-w-0 lg:flex-1 lg:overflow-auto';

const PIILOTUS_AVAIN = 'penni.liiteEsikatselu.piilotettu';

/** Katsojakohtainen muisti: localStorage voi puuttua tai heittää (yksityinen ikkuna ym.). */
function luePiilotus(): boolean {
  try {
    return window.localStorage.getItem(PIILOTUS_AVAIN) === '1';
  } catch {
    return false;
  }
}

function tallennaPiilotus(piilotettu: boolean): void {
  try {
    if (piilotettu) window.localStorage.setItem(PIILOTUS_AVAIN, '1');
    else window.localStorage.removeItem(PIILOTUS_AVAIN);
  } catch {
    // ei muistia — valinta pätee tämän sivun ajan
  }
}

/**
 * Tositteen liitepaneeli: ensimmäisen (tai valitun) liitteen esikatselu, välilehdet usean
 * liitteen välillä, esikatselun piilotus/näyttö (muistetaan katsojakohtaisesti), liitelista
 * avaus- ja poistotoimintoineen sekä `children` (esim. liitteiden lataus ja virheviesti).
 */
export function LiitePaneeli({
  liitteet,
  onAvaaErikseen,
  onPoista,
  children,
}: {
  liitteet: NaytettavaLiite[];
  onAvaaErikseen: (id: number) => void;
  onPoista?: ((id: number) => void) | undefined;
  children?: ReactNode;
}) {
  const [piilotettu, setPiilotettu] = useState(luePiilotus);
  const [valittuId, setValittuId] = useState<number | null>(null);
  // Poistettu tai vielä valitsematon liite → ensimmäinen.
  const valittu = liitteet.find((l) => l.id === valittuId) ?? liitteet[0];
  const naytetaan = !piilotettu && valittu !== undefined;

  function vaihdaPiilotus() {
    setPiilotettu((p) => {
      tallennaPiilotus(!p);
      return !p;
    });
  }

  return (
    <aside
      aria-label="liitepaneeli"
      className={cn(
        'flex shrink-0 flex-col gap-3 border-t border-[var(--border)] px-[22px] py-5',
        'lg:overflow-auto lg:border-l lg:border-t-0',
        naytetaan ? 'lg:w-[42%]' : 'lg:w-[300px]',
      )}
    >
      {valittu ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
            Esikatselu
          </h2>
          <Button
            variant="ghost"
            size="compact"
            type="button"
            aria-expanded={naytetaan}
            onClick={vaihdaPiilotus}
          >
            {piilotettu ? 'Näytä esikatselu' : 'Piilota esikatselu'}
          </Button>
        </div>
      ) : null}
      {naytetaan && liitteet.length > 1 ? (
        <div
          role="tablist"
          aria-label="Esikatseltava liite"
          className="flex flex-wrap gap-[2px] self-start rounded-[9px] bg-[var(--track)] p-[3px]"
        >
          {liitteet.map((l) => {
            const valittuna = l.id === valittu.id;
            return (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={valittuna}
                title={l.nimi}
                onClick={() => setValittuId(l.id)}
                className={cn(
                  'max-w-[180px] truncate rounded-[6px] px-[10px] py-1 text-[12px] transition-colors',
                  valittuna
                    ? 'bg-[var(--surface)] font-semibold text-[var(--accent)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                    : 'font-medium text-[var(--text-muted)]',
                )}
              >
                {l.nimi}
              </button>
            );
          })}
        </div>
      ) : null}
      {naytetaan ? (
        <div
          {...(liitteet.length > 1 ? { role: 'tabpanel' } : {})}
          aria-label={`Esikatselu: ${valittu.nimi}`}
          className="flex h-[70vh] min-h-[360px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-subtle)] lg:h-auto lg:flex-1"
        >
          <LiiteEsikatselu key={valittu.id} liite={valittu} onAvaaErikseen={onAvaaErikseen} />
        </div>
      ) : null}
      <Liitelista liitteet={liitteet} onAvaa={onAvaaErikseen} onPoista={onPoista} />
      {children}
    </aside>
  );
}
