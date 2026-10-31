import { cn } from '@/lib/utils';
import type { TallennusTila } from './useAutomaattinenTallennus.js';

/** Tilarivin teksti; null = ei mitään kerrottavaa (esim. uusi lomake ennen ensimmäistä tallennusta). */
export function tallennuksenTeksti(
  tila: TallennusTila,
  syy: string | null,
  tallennettuKerran: boolean,
  tallennettuTeksti: string,
): string | null {
  switch (tila) {
    case 'tallennetaan':
      return 'Tallennetaan…';
    case 'virhe':
      return `Tallennus epäonnistui — yritetään uudelleen${syy ? `. ${syy}` : ''}`;
    case 'eiKelpaa':
      return `Ei tallennettu — ${syy ?? 'tosite ei kelpaa'}`;
    case 'tallennettu':
      return tallennettuKerran ? tallennettuTeksti : null;
  }
}

/** Automaattisen tallennuksen tilarivi yläpalkkiin. Alue on aina olemassa (aria-live). */
export function TallennuksenTila({
  tila,
  syy,
  tallennettuKerran,
  tallennettuTeksti,
}: {
  tila: TallennusTila;
  syy: string | null;
  tallennettuKerran: boolean;
  /** "Tallennettu luonnoksena" tai "Tallennettu". */
  tallennettuTeksti: string;
}) {
  const ongelma = tila === 'virhe' || tila === 'eiKelpaa';
  return (
    <span
      aria-live="polite"
      className={cn(
        'self-center text-[12px]',
        ongelma ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]',
      )}
    >
      {tallennuksenTeksti(tila, syy, tallennettuKerran, tallennettuTeksti)}
    </span>
  );
}
