import type { HistoryState } from '@tanstack/react-router';
import type { Naapurit } from './naapurit';
import { BUCKETIT, type ListaBucket } from './suodattimet';

/**
 * Tositelistan viimeksi näytetty järjestys: tositteiden id:t täsmälleen siinä järjestyksessä kuin
 * lista ne näytti (suodattimien, haun ja lajittelun jälkeen) sekä tila-ryhmä, josta ne tulivat.
 * Tositesivun Edellinen/Seuraava kulkee tätä järjestystä, kun avattu tosite on listalla.
 *
 * Arvo on muistissa ja sessionStoragessa, jotta sivun uudelleenlataus samassa ikkunassa säilyttää
 * sen. sessionStorage voi puuttua tai heittää (yksityinen ikkuna, estetty sivustodata), joten
 * jokainen käsittely on try/catchin sisällä; silloin järjestys pätee vain tämän sivun ajan.
 */
export interface ListanJarjestys {
  bucket: ListaBucket;
  idt: readonly number[];
}

export const JARJESTYKSEN_AVAIN = 'penni.tositelistanJarjestys';

/**
 * Historian tila, jolla tositelistan rivi (ja siitä jatkuva Edellinen/Seuraava) avaa tositteen.
 * Listan järjestystä käytetään vain tällä merkinnällä: muualta (kojelauta, raportti, linkki)
 * avattu tosite selataan numerojärjestyksessä, vaikka se olisi viimeksi nähdyllä listalla.
 */
// HistoryState on @tanstack/historyn rajapinta, jota tämä paketti ei voi laajentaa (ei suora
// riippuvuus), eikä se hyväksy tuntematonta kenttää oliokirjaimena; Object.assign liittää sen
// tyhjään (kaikki kentät valinnaisia) HistoryStateen.
export const LISTALTA: HistoryState & { listalta: true } = Object.assign({} as HistoryState, {
  listalta: true as const,
});

export function onListalta(tila: unknown): boolean {
  return (
    typeof tila === 'object' && tila !== null && (tila as { listalta?: unknown }).listalta === true
  );
}

/** undefined = sessionStoragea ei ole vielä luettu tällä sivulla. */
let muisti: ListanJarjestys | null | undefined;

function tulkitse(raaka: unknown): ListanJarjestys | null {
  if (typeof raaka !== 'object' || raaka === null) return null;
  const r = raaka as Record<string, unknown>;
  if (typeof r.bucket !== 'string' || !(BUCKETIT as readonly string[]).includes(r.bucket))
    return null;
  if (!Array.isArray(r.idt) || !r.idt.every((id) => Number.isSafeInteger(id) && id > 0))
    return null;
  return { bucket: r.bucket as ListaBucket, idt: r.idt as number[] };
}

/** Tallenna listan näyttämä järjestys (kaksoiskappaleista jää ensimmäinen). */
export function tallennaListanJarjestys(bucket: ListaBucket, idt: readonly number[]): void {
  muisti = { bucket, idt: [...new Set(idt)] };
  try {
    window.sessionStorage.setItem(JARJESTYKSEN_AVAIN, JSON.stringify(muisti));
  } catch {
    // ei sessionStoragea — järjestys pätee tämän sivun ajan
  }
}

/** Viimeksi tallennettu järjestys tai null. Palauttaa saman olion, kunnes järjestys vaihtuu. */
export function lueListanJarjestys(): ListanJarjestys | null {
  if (muisti === undefined) {
    try {
      const raaka = window.sessionStorage.getItem(JARJESTYKSEN_AVAIN);
      muisti = raaka === null ? null : tulkitse(JSON.parse(raaka));
    } catch {
      muisti = null;
    }
  }
  return muisti;
}

/** Unohda järjestys (esim. kirjanpidon vaihtuessa: id:t kuuluivat toiseen kirjaan). */
export function tyhjennaListanJarjestys(): void {
  muisti = undefined;
  try {
    window.sessionStorage.removeItem(JARJESTYKSEN_AVAIN);
  } catch {
    // ei sessionStoragea
  }
}

/**
 * Tositteen naapurit tallennetussa listajärjestyksessä. Naapuri, jota ei enää ole (`olemassa`
 * palauttaa false — poistettu tai siirtynyt toiseen ryhmään), ohitetaan. Palauttaa null, jos
 * tosite ei ole listalla: silloin käytetään numerojärjestystä.
 */
export function listanNaapurit(
  jarjestys: ListanJarjestys | null,
  id: number,
  olemassa: (id: number) => boolean,
): Naapurit | null {
  const i = jarjestys?.idt.indexOf(id) ?? -1;
  if (!jarjestys || i < 0) return null;
  const { idt } = jarjestys;
  let edellinen: number | null = null;
  for (let j = i - 1; j >= 0 && edellinen === null; j--) {
    if (olemassa(idt[j] as number)) edellinen = idt[j] as number;
  }
  let seuraava: number | null = null;
  for (let j = i + 1; j < idt.length && seuraava === null; j++) {
    if (olemassa(idt[j] as number)) seuraava = idt[j] as number;
  }
  return { edellinen, seuraava };
}
