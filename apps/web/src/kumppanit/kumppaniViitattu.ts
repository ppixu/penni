/**
 * Onko kumppania (id) viitattu millään myynti- tai ostolaskulla?
 * Poiston suojaus: poistaKumppani on suojaamaton storage-poisto, joten viittaus
 * tarkistetaan client-puolella ennen poistoa, ettei laskuille jää orpoja id-viitteitä.
 */
export function onkoKumppaniViitattu(
  id: number,
  myyntilaskut: readonly { asiakasId?: number }[],
  ostolaskut: readonly { kumppani?: number }[],
): boolean {
  return myyntilaskut.some((r) => r.asiakasId === id) || ostolaskut.some((r) => r.kumppani === id);
}
