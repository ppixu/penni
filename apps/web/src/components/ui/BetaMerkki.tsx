/**
 * Small "beta" pill for features that are usable but not yet trustworthy enough to be read as
 * finished — currently Kysy kirjanpitäjältä, whose answers are model output over the user's own
 * book. Rendered as text (not an image or a pseudo-element) so screen readers announce it too.
 */
export function BetaMerkki({ className }: { className?: string }) {
  return (
    <span
      className={`rounded-full bg-[var(--accent-soft)] px-[6px] py-[1px] text-[9px] font-bold uppercase tracking-[0.5px] text-[var(--accent)] ${className ?? ''}`}
    >
      beta
    </span>
  );
}
