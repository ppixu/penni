/**
 * Liitevarasto: valinnainen paikka, jonne liitteen tavut tallennetaan SQLite-rivin sijaan.
 * Ydin antaa varastolle sisällön SHA-256:n (heksa, ydin laskee itse eikä luota asiakkaan
 * ilmoittamaan) ja tavut; varasto päättää avaimen ja palauttaa sen. Riville jää vain metatieto,
 * koko ja varaston avain (`varasto_avain`), ja `data` on tyhjä. Ilman varastoa (kaikki paikalliset
 * adapterit) tavut tallennetaan riville kuten ennen.
 *
 * Tavut ovat sisältöosoitteisia (avain johdetaan SHA-256:sta), joten saman sisällön uudelleen
 * tallennus on idempotentti, mutta samaa avainta voi käyttää useampi liite — varastosta ei siksi
 * poisteta mitään liitteen poistossa (ks. spiken tulokset).
 */
export interface Liitevarasto {
  /** Tallenna tavut; palauta varaston avain, jolla ne haetaan. */
  tallenna(sha256: string, data: Uint8Array): Promise<string>;
  /** Hae tavut avaimella; null jos objektia ei ole. */
  hae(avain: string): Promise<Uint8Array | null>;
}

// Web Crypto on kaikissa ajoympäristöissä, mutta paketti ei tuo DOM/node-tyyppejä; kuvataan vain
// tarvittava pinta (moduulikohtainen, ei tuotettua koodia).
declare const crypto: {
  subtle: { digest(algoritmi: string, data: Uint8Array): Promise<ArrayBuffer> };
};

/** Hex-SHA-256 (Web Crypto: Node 22, workerd ja selain). */
export async function sha256Heksa(data: Uint8Array): Promise<string> {
  const tiiviste = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let s = '';
  for (const b of tiiviste) s += b.toString(16).padStart(2, '0');
  return s;
}
