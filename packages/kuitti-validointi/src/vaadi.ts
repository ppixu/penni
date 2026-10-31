/** Palauttaa arvon tai heittää, jos se puuttuu (korvaa `!`-ei-null-väitteen skripteissä). */
export function vaadi<T>(arvo: T | null | undefined): T {
  if (arvo === null || arvo === undefined) throw new Error('Puuttuva arvo');
  return arvo;
}
