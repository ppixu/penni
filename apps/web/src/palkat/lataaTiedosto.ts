/**
 * Käynnistää selaimen latauksen (Blob + <a download>), kuten laskun PDF:n `lataaSelaimeen`,
 * mutta tiedostotyyppi annetaan (palkkatietoilmoituksen XML, palkkalaskelman PDF).
 */
export function lataaTiedosto(sisalto: Uint8Array | string, nimi: string, tyyppi: string): void {
  const osa = typeof sisalto === 'string' ? sisalto : new Uint8Array(sisalto);
  const url = URL.createObjectURL(new Blob([osa], { type: tyyppi }));
  const linkki = document.createElement('a');
  linkki.href = url;
  linkki.download = nimi;
  linkki.rel = 'noopener';
  document.body.appendChild(linkki);
  linkki.click();
  linkki.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
