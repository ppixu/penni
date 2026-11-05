/**
 * Työeläkevakuutusyhtiöt Tulorekisterin koodiston `PensionProvIdCode` mukaan (koodisto 2026,
 * "Pension provider code"). Mukana vain yksityisen alan TyEL-vakuutusyhtiöt; muut koodit
 * (eläkesäätiöt 70xxx, Keva 20/25/29/30 jne.) voi syöttää käsin lomakkeen "Muu koodi" -valinnalla.
 */
export const TYEL_YHTIOT: ReadonlyArray<{ koodi: string; nimi: string }> = [
  { koodi: '46', nimi: 'Ilmarinen' },
  { koodi: '54', nimi: 'Elo' },
  { koodi: '55', nimi: 'Varma' },
  { koodi: '56', nimi: 'Veritas' },
];
