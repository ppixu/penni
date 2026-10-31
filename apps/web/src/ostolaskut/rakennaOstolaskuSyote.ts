import { riviTositeRiviksi } from '@/laskutus/rakennaLaskuSyote';
import type { OstolaskuSyote } from '@penni/engine';
import type { OstolaskuTila } from './ostolaskuReducer.js';

/**
 * Lomaketila → OstolaskuSyote. Uudelleenkäyttää myyntipuolen riviTositeRiviksi-muunnoksen
 * (AINOA sentit→eurot-raja: TositeRivi.aNetto euroina). Nollahintaiset rivit pudotetaan;
 * viite, kumppani ja erapvm liitetään vain kun ne on annettu (exactOptionalPropertyTypes).
 * pvm = laskupvm (kirjauspäivä = laskun päivä); OstolaskuSyote.pvm on pakollinen.
 */
export function rakennaOstolaskuSyote(tila: OstolaskuTila): OstolaskuSyote {
  const rivit = tila.rivit.filter((r) => r.aNettoSnt !== 0).map(riviTositeRiviksi);
  return {
    pvm: tila.laskupvm,
    laskupvm: tila.laskupvm,
    rivit,
    ...(tila.erapvm !== '' ? { erapvm: tila.erapvm } : {}),
    ...(tila.viite.trim() !== '' ? { viite: tila.viite.trim() } : {}),
    ...(tila.kumppani !== undefined ? { kumppani: tila.kumppani } : {}),
  };
}
