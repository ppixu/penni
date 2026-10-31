import type { Tyokalu } from './tyokalu.js';
import { alvTilanne } from './tyokalut/alvTilanne.js';
import { liiteLisays } from './tyokalut/liiteLisays.js';
import { liitteet } from './tyokalut/liitteet.js';
import { perustiedot } from './tyokalut/perustiedot.js';
import { raportti } from './tyokalut/raportti.js';
import { saldot } from './tyokalut/saldot.js';
import { tilikaudet } from './tyokalut/tilikaudet.js';
import { tiliote } from './tyokalut/tiliote.js';
import { tilitHaku } from './tyokalut/tilitHaku.js';
import { tosite } from './tyokalut/tosite.js';
import { tositeLuonnos } from './tyokalut/tositeLuonnos.js';
import { tositteetHaku } from './tyokalut/tositteetHaku.js';
import { viennitHaku } from './tyokalut/viennitHaku.js';

export const lueTyokalut: Tyokalu[] = [
  perustiedot,
  tilitHaku,
  saldot,
  raportti,
  tositteetHaku,
  tosite,
  viennitHaku,
  alvTilanne,
  tilikaudet,
];
/**
 * Lukutyökalut, joita EI anneta Kysy-avustajalle (`lueTyokalut` on sen koko työkalulista):
 * niiden tieto on jo muiden työkalujen tuloksissa (liitteet: tosite-työkalussa), ja pienen
 * mallin työkalulista pidetään lyhyenä. Agenttirajapinta (CLI) tarjoaa ne.
 */
export const muutLueTyokalut: Tyokalu[] = [liitteet];
/** Kirjoittavat työkalut: vain agenttirajapinnalle, Kysy hylkää ne (kirjoittava = true). */
export const kirjoitusTyokalut: Tyokalu[] = [tositeLuonnos, liiteLisays, tiliote];
export const kaikkiTyokalut: Tyokalu[] = [...lueTyokalut, ...muutLueTyokalut, ...kirjoitusTyokalut];

export function haeTyokalu(nimi: string): Tyokalu | undefined {
  return kaikkiTyokalut.find((t) => t.nimi === nimi);
}
