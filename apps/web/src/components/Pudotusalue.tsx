import { cn } from '@/lib/utils';
import { type DragEvent, useState } from 'react';

/**
 * Tiedostovalinta pudotusalueena: klikkaus avaa tiedostodialogin, tiedostot voi myös vetää
 * ja pudottaa. Varsinainen <input type=file> on piilotettu (sr-only), mutta saavutettava
 * `otsikko`-nimellä.
 */
export function Pudotusalue({
  otsikko,
  ohje,
  accept,
  monta = true,
  onValitse,
  className,
}: {
  otsikko: string;
  ohje: string;
  accept?: string | undefined;
  /** Salli usean tiedoston valinta kerralla (oletus). */
  monta?: boolean;
  onValitse: (tiedostot: File[]) => void;
  className?: string | undefined;
}) {
  const [paalla, setPaalla] = useState(false);
  const pudota = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setPaalla(false);
    const tiedostot = [...e.dataTransfer.files];
    onValitse(monta ? tiedostot : tiedostot.slice(0, 1));
  };
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setPaalla(true);
      }}
      onDragLeave={() => setPaalla(false)}
      onDrop={pudota}
      className={cn(
        'flex flex-1 cursor-pointer flex-col gap-1 rounded-[10px] border border-dashed border-[var(--border-strong)] px-4 py-3 text-[12.5px]',
        'focus-within:border-[var(--accent)] focus-within:ring-[3px] focus-within:ring-[var(--focus-ring)]',
        paalla && 'border-[var(--accent)] bg-[var(--accent-soft)]',
        className,
      )}
    >
      <span className="font-semibold">{otsikko}</span>
      <span className="text-[var(--text-muted)]">{ohje}</span>
      <input
        type="file"
        multiple={monta}
        {...(accept !== undefined ? { accept } : {})}
        aria-label={otsikko}
        className="sr-only"
        onChange={(e) => {
          const tiedostot = [...(e.target.files ?? [])];
          e.target.value = ''; // salli saman tiedoston valinta uudelleen
          onValitse(tiedostot);
        }}
      />
    </label>
  );
}
