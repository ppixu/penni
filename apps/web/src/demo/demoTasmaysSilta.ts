import type { TasmaysAineisto, TasmaysSilta } from '@penni/luku';
import type { DemoAineisto } from './demoKirja.js';

const KUITTIKANSIO = 'Kuitit lokakuu 2026';

/**
 * Täsmäytysnäkymän silta demossa: "valitsimet" palauttavat valmiin tapahtumaluettelon ja
 * kuittikansion, ja luku antaa demokirjan rakentamat tiedot muistista. Työpöydällä samat
 * metodit avaavat natiivit valitsimet ja lukevat tiedostot levyltä.
 */
export function luoDemoTasmaysSilta(aineisto: DemoAineisto): TasmaysSilta {
  return {
    valitseTiliote: async () => aineisto.tiliote.tiedosto,
    valitseKuittikansio: async () => KUITTIKANSIO,
    lueAineisto: async (_tiliote, kansio, edistyminen) => {
      const kuitit = kansio === null ? [] : aineisto.kuitit;
      edistyminen({ vaihe: 'tiliote', valmiina: 1, yhteensa: 1 });
      edistyminen({ vaihe: 'kuitit', valmiina: kuitit.length, yhteensa: kuitit.length });
      const tulos: TasmaysAineisto = {
        tiliote: { ...aineisto.tiliote, tapahtumat: [...aineisto.tiliote.tapahtumat] },
        kuitit: [...kuitit],
        lukematta: [],
      };
      return tulos;
    },
    lueTiedosto: async (polku) => {
      const nimi = polku.split('/').pop() ?? polku;
      const data = aineisto.tiedostot.get(nimi);
      if (!data) throw new Error(`Demotiedostoa ${nimi} ei löydy`);
      return data.slice();
    },
  };
}
