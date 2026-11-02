const MERKIT = '0123456789abcdefghijklmnopqrstuvwxyz';
/** Suurin 36:n monikerta tavun alueella: sitä suuremmat hylätään, jotta jakauma on tasainen. */
const RAJA = 252;

/**
 * Lyhyt satunnainen työntekijätunnus: 8 merkkiä [0-9a-z]. Ei koskaan johdeta henkilötunnuksesta.
 * Tunnusta käytetään Tulorekisterin ReportId:ssä (≤ 40 merkkiä, [0-9A-Za-z_-]).
 * `kaytossa`-joukon tunnuksia ei palauteta.
 */
export function uusiTyontekijaId(kaytossa: ReadonlySet<string> = new Set()): string {
  for (;;) {
    let id = '';
    while (id.length < 8) {
      for (const tavu of globalThis.crypto.getRandomValues(new Uint8Array(16))) {
        if (tavu < RAJA && id.length < 8) id += MERKIT[tavu % 36];
      }
    }
    if (!kaytossa.has(id)) return id;
  }
}
