// Legacy-build: työpöytäsovelluksen Electron 33 (Chrome 130) ei tue rajapintoja, joita pdf.js 6:n
// moderni build kutsuu ilman polyfillejä (esim. Map.prototype.getOrInsertComputed).
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
// Vite paketoi pdf.js:n työntekijän moduulityöntekijäksi (?worker) ja annamme sen workerPortina.
// Luotettavampi Vitessä kuin workerSrc-merkkijono, joka kaatui "readableStream"-virheeseen
// (Safarin JS-moottorin tapa ilmoittaa työntekijän latausvirheestä).
import PdfTyontekija from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker';

GlobalWorkerOptions.workerPort = new PdfTyontekija();

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
 * Lukee PDF-tiedoston upotetun tekstikerroksen pdf.js:llä — ei mallia, vaan tarkka teksti
 * suoraan PDF:n rakenteesta. Toimii digitaalisesti tuotetuille PDF:ille (esim. verkkolaskuille);
 * skannatuille kuville tekstikerrosta ei ole, jolloin tulos on tyhjä eikä tätä polkua kannata käyttää.
 * Sivujen tekstit erotellaan rivinvaihdolla.
 */
export async function luePdfTeksti(tiedosto: Blob): Promise<string> {
  const data = new Uint8Array(await tiedosto.arrayBuffer());
  const lataustehtava = getDocument({ data });
  const sivut: string[] = [];
  try {
    const asiakirja = await lataustehtava.promise;
    for (let sivunro = 1; sivunro <= asiakirja.numPages; sivunro++) {
      const sivu = await asiakirja.getPage(sivunro);
      const sisalto = await sivu.getTextContent();
      // Erotellaan osat välilyönnillä ja rivi hasEOL-lipun mukaan rivinvaihdolla, jotta
      // sanat/kentät eivät liimaudu yhteen (esim. "Brutto25,5") — malli lukee rakenteen paremmin.
      let rivi = '';
      for (const osa of (sisalto.items as unknown[]).filter(onkoTekstiosa)) {
        rivi += osa.str;
        rivi += osa.hasEOL ? '\n' : ' ';
      }
      sivut.push(rivi.trim());
    }
  } finally {
    await lataustehtava.destroy();
  }
  return sivut.join('\n');
}

/**
 * Rasteroi PDF:n ensimmäisen sivun PNG-kuvaksi (skannattu kuitti ilman tekstikerrosta).
 * Pisin sivu enintään `maksSivu` px; näkömallin työntekijä pienentää edelleen omaan rajaansa.
 */
export async function rasteroiPdf(tiedosto: Blob, maksSivu = 1536): Promise<Blob> {
  const data = new Uint8Array(await tiedosto.arrayBuffer());
  const lataustehtava = getDocument({ data });
  try {
    const asiakirja = await lataustehtava.promise;
    const sivu = await asiakirja.getPage(1);
    const perus = sivu.getViewport({ scale: 1 });
    const mittakaava = Math.min(maksSivu / perus.width, maksSivu / perus.height, 3);
    const viewport = sivu.getViewport({ scale: mittakaava });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await sivu.render({ canvas, viewport }).promise;
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Rasterointi epäonnistui.'))),
        'image/png',
      ),
    );
  } finally {
    await lataustehtava.destroy();
  }
}
