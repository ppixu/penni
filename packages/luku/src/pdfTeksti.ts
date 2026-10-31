export { onkoTekstia } from '@penni/engine';

/**
 * Tunnistaa, onko arvo pdf.js:n TextItem-muotoinen tekstiosa (sisältää merkkijonokentän "str").
 * TextMarkedContent-osilla ei ole str-kenttää, joten ne suodattuvat pois.
 */
function onkoTekstiosa(osa: unknown): osa is { str: string; hasEOL: boolean } {
  return (
    typeof osa === 'object' &&
    osa !== null &&
    'str' in osa &&
    typeof (osa as { str: unknown }).str === 'string'
  );
}

/**
 * pdfjs-dist:n `getDocument`-kutsu vie (irrottaa) annetun `data`-puskurin worker-säikeelle:
 * kutsujan alkuperäinen ArrayBuffer jää tämän jälkeen 0-pituiseksi. Jos näin käy skannatun
 * kuitin tavuille, myöhempi OCR-/vision-varapolku (`ocrTeksti(liite.data)` /
 * `visionKuitti(liite.data)`) saa tyhjän datan. Siksi `getDocument`-kutsulle annetaan aina
 * tuore kopio (`new Uint8Array(tavut)`): vain kopio irrotetaan, kutsujan puskuri säilyy ehjänä.
 * `isEvalSupported` ei enää löydy pdfjs-dist:n julkisesta `DocumentInitParameters`-tyypistä
 * (kenttä poistettiin uudemmista versioista), mutta annetaan se silti eksplisiittisenä
 * tietoturvakovennuksena — pdf.js jättää tuntemattomat asetuskentät huomiotta.
 */
interface PdfLatausasetukset {
  data: Uint8Array;
  useWorkerFetch: boolean;
  isEvalSupported: boolean;
  /** 0 = vain virheet. Tekstipoiminnassa pdf.js:n renderöintivaroitukset (esim. puuttuva
   *  standardFontDataUrl) ovat pelkkää kohinaa, ja CLI:ssä ne sotkisivat konsolitulosteen. */
  verbosity: number;
}

/** Extract the embedded text layer with pdf.js in Node (no worker). Empty string for scanned PDFs. */
export async function pdfTeksti(tavut: Uint8Array): Promise<string> {
  // Legacy build runs without a worker; do not set GlobalWorkerOptions.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const asetukset: PdfLatausasetukset = {
    data: new Uint8Array(tavut),
    useWorkerFetch: false,
    isEvalSupported: false,
    verbosity: 0,
  };
  const lataustehtava = pdfjs.getDocument(asetukset);
  const sivut: string[] = [];
  try {
    const asiakirja = await lataustehtava.promise;
    for (let n = 1; n <= asiakirja.numPages; n++) {
      const sivu = await asiakirja.getPage(n);
      const sisalto = await sivu.getTextContent();
      let rivi = '';
      const rivit: string[] = [];
      for (const osa of (sisalto.items as unknown[]).filter(onkoTekstiosa)) {
        rivi += (rivi ? ' ' : '') + osa.str;
        if (osa.hasEOL) {
          rivit.push(rivi);
          rivi = '';
        }
      }
      if (rivi) rivit.push(rivi);
      sivut.push(rivit.join('\n'));
    }
  } finally {
    await lataustehtava.destroy();
  }
  return sivut.join('\n');
}
