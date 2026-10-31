/**
 * Raportin lataus- tai virhetila: kyselyn epäonnistuessa näytetään virhe eikä "Ladataan…" ikuisesti
 * (muiden näkymien tapaan role="alert").
 */
export function Lataustila({ virhe }: { virhe: boolean }) {
  return virhe ? (
    <p role="alert" className="text-[13px] text-[var(--danger)]">
      Raportin laadinta epäonnistui.
    </p>
  ) : (
    <p className="text-[13px] text-[var(--text-muted)]">Ladataan…</p>
  );
}
