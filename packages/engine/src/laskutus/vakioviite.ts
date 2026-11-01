/** Vakioviite: kiinteä viitenumero, joka ohjaa tilille (ja kohdennukselle) maksun kohdistuksessa. */
export interface Vakioviite {
  viite: string;
  tili: number;
  kohdennus?: number;
  otsikko: string;
  [avain: string]: unknown;
}

/**
 * Vakioviitteiden järjestys kaikissa tallennuksissa: numeerisesti viitteen mukaan, sitten
 * merkkijonona (vastaa myös ei-numeerisia viitteitä, joiden Number() on NaN). Viite on jopa
 * 20 numeroa, joten järjestys tehdään tässä eikä SQL:n CASTilla.
 */
export function vertaaVakioviitteita(a: Vakioviite, b: Vakioviite): number {
  const ero = Number(a.viite) - Number(b.viite);
  if (ero) return ero;
  return a.viite < b.viite ? -1 : a.viite > b.viite ? 1 : 0;
}
