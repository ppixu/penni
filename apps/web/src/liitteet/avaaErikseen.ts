import { esikatselunTyyppi } from './LiiteEsikatselu.js';

/** Object-URL vapautetaan viiveellä, jotta selain ehtii avata tai tallentaa sen. */
const VAPAUTUSVIIVE_MS = 60_000;

/**
 * Avaa liitteen erikseen. PDF ja kuvat avataan uuteen ikkunaan sisällöstä päätellyllä
 * tyypillä; kaikki muu ladataan tiedostona (`application/octet-stream` + `<a download>`).
 * Blob-URL perii sovelluksen originin, joten tallennetulla tyypillä (esim. Kitsas-tuonnin
 * text/html) avattu liite voisi ajaa skriptiä sovelluksen nimissä — työpöydällä myös
 * paikallista, tunnistautumatonta API:a vasten.
 */
export function avaaErikseen(liite: { nimi: string; tyyppi: string; data: Uint8Array }): void {
  const tyyppi = esikatselunTyyppi(liite.tyyppi, liite.data);
  const blob = new Blob([new Uint8Array(liite.data)], {
    type: tyyppi ?? 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  if (tyyppi) {
    window.open(url, '_blank', 'noopener');
  } else {
    const linkki = document.createElement('a');
    linkki.href = url;
    linkki.download = liite.nimi;
    linkki.rel = 'noopener';
    document.body.appendChild(linkki);
    linkki.click();
    linkki.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), VAPAUTUSVIIVE_MS);
}
