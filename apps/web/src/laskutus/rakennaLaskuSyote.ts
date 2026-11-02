import {
  type MyyntilaskuSyote,
  type StoredTosite,
  type TositeRivi,
  normalisoiMerkkaukset,
} from '@penni/engine';
import type { LaskuTila, LomakeRivi } from './laskuReducer.js';

/** À-hinta euroina: luonnoksen koskematon hinta säilyy alkuperäisenä (ei pyöristystä senttiin),
 *  muokattu hinta muunnetaan senteistä. */
function rivinANetto(rivi: LomakeRivi): number {
  const alku = rivi.alkuperainenANetto;
  return alku !== undefined && rivi.aNettoSnt === Math.round(alku * 100)
    ? alku
    : rivi.aNettoSnt / 100;
}

/** Rivillä ei ole hintaa (tyhjä häntärivi): ei senttejä eikä alle sentin tarkkaa alkuperäishintaa. */
export function riviHinnaton(rivi: LomakeRivi): boolean {
  return rivi.aNettoSnt === 0 && (rivi.alkuperainenANetto ?? 0) === 0;
}

/**
 * Lomakerivi → moottorin TositeRivi. TÄMÄ on ainoa sentit→eurot-muunnos koko
 * laskutus-UI:ssa: TositeRivi.aNetto on euroja (moottorin oma sopimus, peritty
 * legacystä; ainoa pyöristys tapahtuu rivi.ts:n senttirajalla). Selite liitetään
 * vain ei-tyhjänä (exactOptionalPropertyTypes). Kohdennus 0 (Yleinen) ja tyhjä merkkauslista
 * jätetään pois; merkkaukset normalisoidaan (järjestys, uniikit) kuten moottorissa.
 */
export function riviTositeRiviksi(rivi: LomakeRivi): TositeRivi {
  const merkkaukset = normalisoiMerkkaukset(rivi.merkkaukset);
  // Kohdennus ja merkkaukset ovat lomakkeen omia kenttiä: lisat-kentän arvot eivät saa ohittaa
  // lomakkeella tyhjennettyä valintaa.
  const { kohdennus: _kohdennus, merkkaukset: _merkkaukset, ...lisat } = rivi.lisat ?? {};
  return {
    ...lisat,
    myyntiKpl: rivi.myyntiKpl,
    aNetto: rivinANetto(rivi),
    alvKoodi: rivi.alvKoodi,
    alvProsentti: rivi.alvProsentti,
    ...(rivi.selite.trim() !== '' ? { selite: rivi.selite.trim() } : {}),
    ...(rivi.kohdennus ? { kohdennus: rivi.kohdennus } : {}),
    ...(merkkaukset ? { merkkaukset } : {}),
  };
}

/** Luonnoksen kentät, joita lomake ei muokkaa; ne kulkevat mukana, kun luonnos tallennetaan
 *  uudelleen (tallennus korvaa koko tositteen, joten pois jättäminen pudottaisi ne). */
export function luonnoksenSailytettavat(t: StoredTosite): Partial<MyyntilaskuSyote> {
  return {
    ...(t.sarja !== '' ? { sarja: t.sarja } : {}),
    ...(t.info !== undefined ? { info: t.info } : {}),
    ...(t.viivkorko !== undefined ? { viivkorko: t.viivkorko } : {}),
    ...(t.toisto !== undefined ? { toisto: t.toisto } : {}),
    ...(t.toistoPvm !== undefined ? { toistoPvm: t.toistoPvm } : {}),
    ...(t.ryhma !== undefined ? { ryhma: t.ryhma } : {}),
  };
}

/** Lomakkeen tallennuksen estävä virhe laskutusjaksosta (molemmat päivät tai ei kumpaakaan,
 *  loppu ei ennen alkua), tai null. Sama sääntö kuin moottorin validoiJakso. */
export function laskuLomakeVirhe(tila: LaskuTila): string | null {
  if (tila.jaksoAlkaa === '' && tila.jaksoLoppuu === '') return null;
  if (tila.jaksoAlkaa === '' || tila.jaksoLoppuu === '')
    return 'Laskutusjaksolta puuttuu alku- tai loppupäivä';
  if (tila.jaksoLoppuu < tila.jaksoAlkaa) return 'Laskutusjakson loppu on ennen alkua';
  return null;
}

/** Lomaketila → MyyntilaskuSyote. Nollahintaiset rivit (tyhjät häntärivit) pudotetaan;
 *  kumppani ja otsikko liitetään vain kun ne on annettu. Tyhjäksi tyhjennetty eräpäivä
 *  (tila.erapvm === '') EI päädy syötteeseen — tallennettu tosite ei saa koskaan saada
 *  erapvm: ''-arvoa, koska se näyttäytyy myöhemmin erääntyneenä eräpäivänä (ks. laskuTila.ts). */
export function rakennaLaskuSyote(
  tila: LaskuTila,
  sailytettavat: Partial<MyyntilaskuSyote> = {},
): MyyntilaskuSyote {
  const virhe = laskuLomakeVirhe(tila);
  if (virhe !== null) throw new Error(virhe);
  const rivit = tila.rivit.filter((r) => !riviHinnaton(r)).map(riviTositeRiviksi);
  return {
    ...sailytettavat,
    pvm: tila.laskupvm,
    laskupvm: tila.laskupvm,
    maksutapa: tila.maksutapa,
    rivit,
    ...(tila.erapvm !== '' ? { erapvm: tila.erapvm } : {}),
    ...(tila.kumppani !== undefined ? { kumppani: tila.kumppani } : {}),
    ...(tila.otsikko.trim() !== '' ? { otsikko: tila.otsikko.trim() } : {}),
    ...(tila.jaksoAlkaa !== '' && tila.jaksoLoppuu !== ''
      ? { jakso: { alkaa: tila.jaksoAlkaa, loppuu: tila.jaksoLoppuu } }
      : {}),
  };
}
