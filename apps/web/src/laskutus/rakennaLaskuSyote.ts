import { type MyyntilaskuSyote, type TositeRivi, normalisoiMerkkaukset } from '@penni/engine';
import type { LaskuTila, LomakeRivi } from './laskuReducer.js';

/**
 * Lomakerivi → moottorin TositeRivi. TÄMÄ on ainoa sentit→eurot-muunnos koko
 * laskutus-UI:ssa: TositeRivi.aNetto on euroja (moottorin oma sopimus, peritty
 * legacystä; ainoa pyöristys tapahtuu rivi.ts:n senttirajalla). Selite liitetään
 * vain ei-tyhjänä (exactOptionalPropertyTypes). Kohdennus 0 (Yleinen) ja tyhjä merkkauslista
 * jätetään pois; merkkaukset normalisoidaan (järjestys, uniikit) kuten moottorissa.
 */
export function riviTositeRiviksi(rivi: LomakeRivi): TositeRivi {
  const merkkaukset = normalisoiMerkkaukset(rivi.merkkaukset);
  return {
    myyntiKpl: rivi.myyntiKpl,
    aNetto: rivi.aNettoSnt / 100,
    alvKoodi: rivi.alvKoodi,
    alvProsentti: rivi.alvProsentti,
    ...(rivi.selite.trim() !== '' ? { selite: rivi.selite.trim() } : {}),
    ...(rivi.kohdennus ? { kohdennus: rivi.kohdennus } : {}),
    ...(merkkaukset ? { merkkaukset } : {}),
  };
}

/** Lomaketila → MyyntilaskuSyote. Nollahintaiset rivit (tyhjät häntärivit) pudotetaan;
 *  kumppani ja otsikko liitetään vain kun ne on annettu. Tyhjäksi tyhjennetty eräpäivä
 *  (tila.erapvm === '') EI päädy syötteeseen — tallennettu tosite ei saa koskaan saada
 *  erapvm: ''-arvoa, koska se näyttäytyy myöhemmin erääntyneenä eräpäivänä (ks. laskuTila.ts). */
export function rakennaLaskuSyote(tila: LaskuTila): MyyntilaskuSyote {
  const rivit = tila.rivit.filter((r) => r.aNettoSnt !== 0).map(riviTositeRiviksi);
  return {
    pvm: tila.laskupvm,
    laskupvm: tila.laskupvm,
    maksutapa: tila.maksutapa,
    rivit,
    ...(tila.erapvm !== '' ? { erapvm: tila.erapvm } : {}),
    ...(tila.kumppani !== undefined ? { kumppani: tila.kumppani } : {}),
    ...(tila.otsikko.trim() !== '' ? { otsikko: tila.otsikko.trim() } : {}),
  };
}
