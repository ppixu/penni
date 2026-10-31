export interface Alue {
  alku: string;
  loppu: string;
}

export interface KaavaTiedot {
  otsikko: boolean; // 'h'/'H' — header row (no value, not accumulated)
  naytaTyhja: boolean; // 'S' or 'H' — render even when empty
  laskeSummaan: boolean; // NOT '==' — add this row's sum to the running total
  lisaaValisumma: boolean; // '=' (and not '==') — emit the running subtotal
  naytaErittelyt: boolean; // '*' — per-account detail (deferred; parsed for completeness)
  vainTulot: boolean; // '+' — income accounts only
  vainMenot: boolean; // '-' — expense accounts only
  alueet: Alue[];
}

const ALUE_RE = /(\d{1,8})(\.\.)?(\d{0,8})/g;

/** Parse a report-row L formula into flags + account ranges (mirrors laatijantasetulos.cpp:243-277). */
export function jasennaKaava(kaava: string): KaavaTiedot {
  const laskeSummaan = !kaava.includes('==');
  const alueet: Alue[] = [];
  for (const m of kaava.matchAll(ALUE_RE)) {
    const alku = m[1] ?? '';
    const loppu = m[3] ? m[3] : alku;
    alueet.push({ alku, loppu });
  }
  return {
    otsikko: kaava.includes('h') || kaava.includes('H'),
    naytaTyhja: kaava.includes('S') || kaava.includes('H'),
    laskeSummaan,
    lisaaValisumma: kaava.includes('=') && laskeSummaan,
    naytaErittelyt: kaava.includes('*'),
    vainTulot: kaava.includes('+'),
    vainMenot: kaava.includes('-'),
    alueet,
  };
}

/**
 * Account numbers (from `tilit`, account-number strings) matching any range, by lexicographic
 * prefix (account.slice(0, len(bound)) compared to the bound). Mirrors laatijantasetulos.cpp:273.
 * Returns numbers, de-duplicated, in the input order of `tilit` (which the caller sorts as strings).
 */
export function tilitAlueille(alueet: readonly Alue[], tilit: readonly string[]): number[] {
  const out: number[] = [];
  const seen = new Set<string>();
  for (const t of tilit) {
    for (const a of alueet) {
      if (t.slice(0, a.alku.length) >= a.alku && t.slice(0, a.loppu.length) <= a.loppu) {
        if (!seen.has(t)) {
          seen.add(t);
          out.push(Number(t));
        }
        break;
      }
    }
  }
  return out;
}
