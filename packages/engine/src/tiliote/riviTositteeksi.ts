import type { Tili } from '../accounts/tili.js';
import type { Kuitti } from '../kuitti/kuitti.js';
import type { TositeSyote } from '../resources/tositeResource.js';
import { type TositeAsetukset, luoTositeMatchista, luoTositeValinnasta } from './kuittiTosite.js';
import type { TyolistaRivi } from './tyolista.js';

/**
 * Kuititon rivi kirjataan synteettisellä kuitilla: tyhjä alv-erittely ohjaa moottorin
 * yhden EIALV-rivin haaraan (kuittiTosite.ts: `erat.length === 0`), jolloin alv:tä ei
 * vähennetä lainkaan. Myyjäksi pankin selite, jotta tositteelle tulee otsikko ja
 * myyjäkohtainen tilisääntö osuu samalla tavalla kuin kuitillisella rivillä.
 */
function synteettinenKuitti(nimi: string): Kuitti {
  return { valuutta: 'EUR', alv: [], myyja: nimi };
}

/**
 * Rakentaa yhden työlistarivin tositteeksi. Käyttäjän valitsema tai historiasta ehdotettu tili
 * ohittaa sääntöpäättelyn asettamalla sen sekä meno- että myyntitiliksi — kumpi niistä
 * käytetään, ratkeaa moottorissa tapahtuman etumerkistä.
 *
 * Kirjaushistorian ehdotus on voimassa vain, kun rivin tili on yhä ehdotuksen tili:
 * - kuititon rivi kirjataan ehdotuksen alv-koodilla (`luoTositeValinnasta`: kotimainen alv
 *   erotetaan bruttosummasta, käänteinen alv lasketaan summan päälle molemmille puolille) —
 *   näin toistuvat laskut kirjautuvat kuten ennenkin, ja luonnoksen voi vielä tarkistaa;
 * - otsikoksi tulee historian otsikko (kuukausi päivitettynä) kuitin myyjän sijaan.
 * Ilman ehdotusta kuititon rivi kirjataan kuten ennenkin ilman alv-vähennystä.
 */
export function riviTositteeksi(
  rivi: TyolistaRivi,
  chart: readonly Tili[],
  asetukset: TositeAsetukset,
): TositeSyote {
  const ehdotus =
    rivi.ehdotus !== undefined && rivi.ehdotus.tili === rivi.tili ? rivi.ehdotus : undefined;
  const tosite =
    rivi.kuitti === undefined && ehdotus !== undefined
      ? luoTositeValinnasta(rivi.tapahtuma, ehdotus, chart, asetukset)
      : luoTositeMatchista(
          rivi.tapahtuma,
          rivi.kuitti?.kuitti ?? synteettinenKuitti(rivi.tapahtuma.nimi),
          chart,
          rivi.tili === undefined
            ? asetukset
            : { ...asetukset, menotili: rivi.tili, myyntitili: rivi.tili, menotiliSaannot: [] },
        );
  if (rivi.kuitti === undefined && tosite.otsikko === undefined)
    tosite.otsikko = rivi.tapahtuma.nimi;
  if (ehdotus?.otsikko) tosite.otsikko = ehdotus.otsikko;
  if (ehdotus?.kumppani !== undefined) tosite.kumppani = ehdotus.kumppani;
  return tosite;
}
