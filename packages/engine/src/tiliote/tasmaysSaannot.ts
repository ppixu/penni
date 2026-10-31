import type { Asetukset } from '../resources/storage.js';
import type { MenotiliSaanto } from './kuittiTosite.js';
import { type Aliasryhma, merkitsevatSanat } from './nimi.js';

export interface TasmaysSaannot {
  menotiliSaannot: MenotiliSaanto[];
  vendorAliakset: Aliasryhma[];
  /** Käytössä olevat omistajanimet: kirjaan tallennettu arvo tai kirjan nimestä siemennetty. */
  omistajanNimet: string[];
  /**
   * Tosi vain kun `TasmaysOmistajanNimet` oli oikeasti tallennettuna kirjaan. Siemennettyä
   * oletusta ei kirjoiteta takaisin kirjaan (ks. `tasmaysSaannotAsetuksiksi`), jottei arvaus jää
   * pysyväksi asetukseksi ensimmäisen sääntötallennuksen mukana.
   */
  omistajanNimetTallennettu: boolean;
}

/** Jäsentää JSON-taulukkoasetuksen; puuttuva tai rikkinäinen arvo on `undefined`. */
function jasenna<T>(arvo: string | undefined): T[] | undefined {
  if (arvo === undefined || arvo === '') return undefined;
  try {
    const luettu: unknown = JSON.parse(arvo);
    return Array.isArray(luettu) ? (luettu as T[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Yritysmuodot, jotka eivät yksilöi omistajaa (fi/sv/ee). */
const YRITYSMUODOT: ReadonlySet<string> = new Set([
  'oy',
  'oyj',
  'ab',
  'abp',
  'ky',
  'ry',
  'tmi',
  'ou',
  'as',
]);

/**
 * Ositaa kirjan nimen omistajatunnistuksen siemeneksi. Moottori täsmää nämä kokonaisina
 * sanoina, joten yritysmuodot ja alle nelimerkkiset sanat pudotetaan: 'oy' merkitsisi
 * jokaisen osakeyhtiön omistajan liikkeeksi ja lyhyt sana osuisi liian herkästi.
 *
 * Jäljelle jäävät sanat palautetaan **yhtenä nimenä**, ei sanaa per alkio: moottori vaatii
 * monisanaisesta nimestä kaikki sanat, mutta erillisinä alkioina kukin sana riittäisi yksin
 * ja 'Matti Meikäläinen' tunnistaisi jälleen sivullisen 'MATTI VIRTANEN':n omistajaksi.
 * 'Pilvipalvelu Oy' -> `['pilvipalvelu']`, 'Matti Meikäläinen' -> `['matti meikalainen']`,
 * 'Oy Ab' -> `[]`.
 */
function nimenOsat(nimi: string | undefined): string[] {
  if (nimi === undefined) return [];
  const osat = merkitsevatSanat(nimi).filter((osa) => osa.length >= 4 && !YRITYSMUODOT.has(osa));
  return osat.length > 0 ? [osat.join(' ')] : [];
}

/**
 * `TasmaysOmistajanNimet` siementyy kirjan omasta nimestä (`asetukset.Nimi`), kun avainta ei
 * ole vielä tallennettu — suunnitteludokumentin oletus. Ilman tätä yksikään tapahtuma ei voi
 * koskaan luokittua omaPaaoma:ksi tuoreessa kirjassa, jolloin omistajan omat rahaliikkeet
 * putoavat kuittiPuuttuu-ryhmään ja tulevat esivalituiksi tavallisiksi menoiksi. Siemen on
 * pelkkä arvaus, joten se pysyy laskennallisena eikä koskaan päädy kirjaan tallennettavaksi.
 */
export function lueTasmaysSaannot(asetukset: Asetukset): TasmaysSaannot {
  const tallennetutNimet = jasenna<string>(asetukset.TasmaysOmistajanNimet);
  return {
    menotiliSaannot: jasenna<MenotiliSaanto>(asetukset.TasmaysMenotiliSaannot) ?? [],
    vendorAliakset: jasenna<Aliasryhma>(asetukset.TasmaysVendorAliakset) ?? [],
    omistajanNimet: tallennetutNimet ?? nimenOsat(asetukset.Nimi),
    omistajanNimetTallennettu: tallennetutNimet !== undefined,
  };
}

/** Lisää tai korvaa myyjäkohtaisen menotilisäännön. Hakusana talletetaan pienaakkosin. */
export function lisaaMenotiliSaanto(
  saannot: TasmaysSaannot,
  hae: string,
  tili: number,
): TasmaysSaannot {
  const avain = hae.trim().toLowerCase();
  return {
    ...saannot,
    menotiliSaannot: [
      ...saannot.menotiliSaannot.filter((s) => s.hae !== avain),
      { hae: avain, tili },
    ],
  };
}

export function lisaaVendorAlias(saannot: TasmaysSaannot, ryhma: Aliasryhma): TasmaysSaannot {
  return { ...saannot, vendorAliakset: [...saannot.vendorAliakset, ryhma] };
}

/**
 * Sarjallistaa säännöt kirjaan tallennettaviksi asetuksiksi. `TasmaysOmistajanNimet`
 * kirjoitetaan vain jos arvo on käyttäjän oma (aiemmin tallennettu) — kirjan nimestä
 * siemennetty oletus jää pois, jottei arvaus muutu pysyväksi asetukseksi sivutuotteena
 * siitä että käyttäjä tallensi myyjäkohtaisen menotilisäännön.
 */
export function tasmaysSaannotAsetuksiksi(saannot: TasmaysSaannot): Record<string, string> {
  return {
    TasmaysMenotiliSaannot: JSON.stringify(saannot.menotiliSaannot),
    TasmaysVendorAliakset: JSON.stringify(saannot.vendorAliakset),
    ...(saannot.omistajanNimetTallennettu
      ? { TasmaysOmistajanNimet: JSON.stringify(saannot.omistajanNimet) }
      : {}),
  };
}
