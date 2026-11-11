/**
 * Toistosilmukan tunnistin striimautuvalle ajattelulle. Pienet mallit jäävät ahneella
 * dekoodauksella kertaamaan samoja lauseita, kunnes tokenraja (3000) tulee vastaan — ~60–90 s
 * paneelissa näkyvää kehää. Vahti katkaisee sen heti, kun sama lause tulee neljännen kerran.
 *
 * Mitattu 2026-11-06 kaikilla talletetuilla qwen3.5:2b-ajatuksilla (Q8 ja MTP, kysy-validointi
 * ja kuitit, 254 erillistä): 21/23 tokenrajaan katkennutta tunnistettiin, mediaanina 32 %:n
 * kohdalla jäljestä; 0/231 normaalisti päättynyttä laukaisi sen. Kolmas kerta riittäisi 22/23:een,
 * mutta antoi yhden väärän hälytyksen.
 */

/** Lauseen vähimmäispituus: lyhyet toistuvat palat ("Odota.", "Ok.") ovat normaalia ajattelua. */
const MIN_PITUUS = 25;
const KERRAT = 4;

/** Lause tai rivi päättyy näihin; desimaalipisteetkin pilkkovat, mikä on vain harmitonta. */
const LOPPU = /[\n.!?]/;

export class Kehavahti {
  private kesken = '';
  private readonly laskut = new Map<string, number>();

  /** Lisää striimatun palan; true, kun jokin lause on nähty KERRAT kertaa. */
  lisaa(osa: string): boolean {
    let loytyi = false;
    for (const merkki of osa) {
      this.kesken += merkki;
      if (!LOPPU.test(merkki)) continue;
      const lause = this.kesken.trim().toLowerCase().replace(/\s+/g, ' ');
      this.kesken = '';
      if (lause.length < MIN_PITUUS) continue;
      const n = (this.laskut.get(lause) ?? 0) + 1;
      this.laskut.set(lause, n);
      if (n >= KERRAT) loytyi = true;
    }
    return loytyi;
  }
}
