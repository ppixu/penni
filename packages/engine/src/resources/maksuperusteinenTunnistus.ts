import { type Cents, roundHalfAway } from '@penni/euro';
import type { Tili } from '../accounts/tili.js';
import { VientiTyyppi } from '../vouchers/enums.js';
import type { IsoDate, TositeVienti } from '../vouchers/types.js';
import { ResourceError } from './storage.js';

/**
 * Rakenna maksuperusteisen alv:n tunnistuspari yhdelle lykätylle viennille (koodi 418/428):
 * kohdentamattoman tilin purku (säilyttää lykätyn koodin) + vastakirjaus oikealle alv-tilille
 * (118/228). Pyöristys kumulatiivista maksettua osuutta vasten (maksettuEnnen..maksettuJalkeen)
 * -> ei kertymävirhettä. Palauttaa [] jos tunnistettava osuus on 0. linkTo -> maksuperusteinenTosite
 * asetetaan vain oikean alv-tilin riville (vanhennuksen idempotenssiin).
 */
export function tunnistaVeroVienti(
  l: TositeVienti,
  T: number,
  maksettuEnnen: number,
  maksettuJalkeen: number,
  alvVelka: Tili | undefined,
  alvSaatava: Tili | undefined,
  pvm: IsoDate,
  selite?: string,
  linkTo?: number,
): TositeVienti[] {
  const myynti = l.alvKoodi === 418;
  const V = myynti ? l.kredit : l.debet; // lykätyn veron määrä
  const ennen = roundHalfAway((V * maksettuEnnen) / T);
  const jalkeen = roundHalfAway((V * maksettuJalkeen) / T);
  const osuus = (jalkeen - ennen) as Cents;
  if (osuus === 0) return [];
  const oikeaTili = myynti ? alvVelka : alvSaatava;
  if (!oikeaTili) throw new ResourceError('EIALVTILIA', 'ALV-tiliä ei löydy tilikartasta');
  const nollaC = 0 as Cents;
  const kohdennusVienti: TositeVienti = {
    tili: l.tili,
    debet: myynti ? osuus : nollaC,
    kredit: myynti ? nollaC : osuus,
    pvm,
    alvKoodi: l.alvKoodi, // 418 / 428 (jää kausisummauksen ulkopuolelle)
    alvProsentti: l.alvProsentti,
    tyyppi: (myynti ? VientiTyyppi.MYYNTI : VientiTyyppi.OSTO) + VientiTyyppi.ALVKIRJAUS,
  };
  const alvVienti: TositeVienti = {
    tili: oikeaTili.numero,
    debet: myynti ? nollaC : osuus,
    kredit: myynti ? osuus : nollaC,
    pvm,
    alvKoodi: myynti ? 118 : 228, // tunnistettu vero -> kausisummaus laskee tähän
    alvProsentti: l.alvProsentti,
    tyyppi: (myynti ? VientiTyyppi.MYYNTI : VientiTyyppi.OSTO) + VientiTyyppi.ALVKIRJAUS,
  };
  if (selite !== undefined) {
    kohdennusVienti.selite = selite;
    alvVienti.selite = selite;
  }
  if (linkTo !== undefined) alvVienti.maksuperusteinenTosite = linkTo;
  return [kohdennusVienti, alvVienti];
}
