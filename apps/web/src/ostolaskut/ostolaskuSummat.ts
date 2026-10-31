import {
  AlvKoodi,
  type TositeRivi,
  bruttoNetosta,
  nettoYhteensaCents,
  veroTyyppi,
} from '@penni/engine';
import type { Cents } from '@penni/euro';

export interface OstoAlvErittelyRivi {
  prosentti: number;
  vero: Cents;
  kaanteinen: boolean;
}

export interface OstolaskuSummat {
  veroton: Cents;
  /** Kotimaan vähennettävä alv (koodi 21) — nostaa maksettavaa. */
  vahennettavaAlv: Cents;
  /** Käännetyn verovelvollisuuden alv (24/25/26) — informatiivinen, nettoutuu (ei maksettavaan). */
  kaannettyAlv: Cents;
  /** Toimittajalle maksettava = veroton + vähennettävä alv. */
  maksettava: Cents;
  erittely: OstoAlvErittelyRivi[];
}

/**
 * Live-summat TÄSMÄLLEEN moottorin generoiVeroviennit-ostovelkarivilaskennan mukaan: vero
 * pyöristetään RIVEITTÄIN (bruttoNetosta(netto, p) − netto), ei kannoittain — koska
 * generoiVeroviennit kirjaa jokaisen rivin veron erikseen (ApuriRivi::viennit-portti).
 * Tämä poikkeaa tarkoituksella myynnin laskuSummat-funktiosta, joka pyöristää kannoittain,
 * koska generoiLaskunViennit puolestaan kokoaa myyntirivit verokantakoreihin ennen kirjausta.
 * Kotimaan vähennettävä osto (OSTOT_NETTO 21) kirjaa vähennettävän alv:n, joka nostaa
 * maksettavaa (maksat brutton). Käännetyn verovelvollisuuden koodit (24/25/26, kaanteinen)
 * itseverotetaan → ostovelka = netto, joten alv EI nosta maksettavaa. Erittely summaa
 * riviveron kannoittain (informatiivinen näyttö); nollasummaiset rivit ohitetaan.
 */
export function ostolaskuSummat(rivit: readonly TositeRivi[]): OstolaskuSummat {
  let veroton = 0;
  let vahennettavaAlv = 0;
  let kaannettyAlv = 0;
  const vahennettavatKorit = new Map<number, number>(); // prosentti -> Σvero (snt)
  const kaannetytKorit = new Map<number, number>();
  for (const r of rivit) {
    const netto = nettoYhteensaCents(r);
    if (netto === 0) continue;
    veroton += netto;
    const vero = (bruttoNetosta(netto, r.alvProsentti) - netto) as Cents;
    if (r.alvKoodi === AlvKoodi.OSTOT_NETTO) {
      vahennettavaAlv += vero;
      vahennettavatKorit.set(r.alvProsentti, (vahennettavatKorit.get(r.alvProsentti) ?? 0) + vero);
    } else if (veroTyyppi(r.alvKoodi)?.kaanteinen) {
      kaannettyAlv += vero;
      kaannetytKorit.set(r.alvProsentti, (kaannetytKorit.get(r.alvProsentti) ?? 0) + vero);
    }
  }
  const erittely: OstoAlvErittelyRivi[] = [];
  for (const [prosentti, koriVero] of vahennettavatKorit) {
    if (koriVero === 0) continue;
    erittely.push({ prosentti, vero: koriVero as Cents, kaanteinen: false });
  }
  for (const [prosentti, koriVero] of kaannetytKorit) {
    if (koriVero === 0) continue;
    erittely.push({ prosentti, vero: koriVero as Cents, kaanteinen: true });
  }
  erittely.sort((a, b) => b.prosentti - a.prosentti);
  return {
    veroton: veroton as Cents,
    vahennettavaAlv: vahennettavaAlv as Cents,
    kaannettyAlv: kaannettyAlv as Cents,
    maksettava: (veroton + vahennettavaAlv) as Cents,
    erittely,
  };
}
