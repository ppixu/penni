import { cn } from '@/lib/utils';
import { type Cents, Euro, EuroParseError } from '@penni/euro';
import { type Ref, useEffect, useState } from 'react';

/** Committed Cents -> the editable string ('' for 0, else bare comma figure, no €). */
function naytaArvo(c: Cents): string {
  if (c === 0) return '';
  const sign = c < 0 ? '−' : '';
  const a = Math.abs(c);
  return `${sign}${Math.trunc(a / 100)},${String(a % 100).padStart(2, '0')}`;
}

/**
 * Money cell input. Local string while editing; commits to absolute-value Cents on
 * blur/Enter via Euro.fromString. Invalid input keeps focus + aria-invalid; never commits.
 */
export function EuroInput({
  arvo,
  onCommit,
  inputRef,
  ...rest
}: {
  arvo: Cents;
  onCommit: (snt: Cents) => void;
  inputRef?: Ref<HTMLInputElement>;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [teksti, setTeksti] = useState(() => naytaArvo(arvo));
  const [virhe, setVirhe] = useState(false);

  // Reflect external value changes (e.g. addBalancingRow pre-fill) while not editing.
  useEffect(() => {
    setTeksti(naytaArvo(arvo));
    setVirhe(false);
  }, [arvo]);

  function commit() {
    try {
      const snt = Euro.abs(Euro.fromString(teksti)); // unsigned: direction = column
      setVirhe(false);
      if (snt !== arvo) onCommit(snt);
    } catch (e) {
      if (e instanceof EuroParseError) {
        setVirhe(true);
        return; // keep focus, do not commit
      }
      throw e;
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={teksti}
      aria-invalid={virhe || undefined}
      onChange={(e) => {
        setTeksti(e.target.value);
        if (virhe) setVirhe(false);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(); // do not preventDefault — Enter also adds the balancing row
      }}
      className={cn(
        'w-full bg-transparent text-right tabular-nums outline-none',
        virhe && 'text-[var(--danger)]',
      )}
      {...rest}
    />
  );
}
