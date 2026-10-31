/** Käyttökelpoinen tekstikerros tuottaa runsaasti merkkejä; skannattu sivu ~ei yhtään. */
export function onkoTekstia(teksti: string): boolean {
  return teksti.trim().length >= 20;
}
