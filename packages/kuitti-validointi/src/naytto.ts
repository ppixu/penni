import {
  type Kuitti,
  type Tili,
  type Tilitapahtuma,
  type Tosite,
  type TositeAsetukset,
  luoTositeMatchista,
} from '@penni/engine';
import { type Cents, Euro } from '@penni/euro';

/** Path A: derive a one-line synthetic bank event from the receipt itself (negative = meno). */
export function kuittiTilitapahtumaksi(kuitti: Kuitti): Tilitapahtuma {
  const brutto = kuitti.bruttoSumma ?? (Euro.fromCents(0) as Cents);
  return {
    pvm: kuitti.pvm ?? ('' as Tilitapahtuma['pvm']),
    nimi: kuitti.myyja ?? '',
    maara: Euro.fromCents(-brutto) as Cents,
  };
}

/** Run the receipt through the real engine voucher-builder (path A). */
export function generoiTosite(
  kuitti: Kuitti,
  chart: readonly Tili[],
  asetukset: TositeAsetukset,
): Tosite {
  return luoTositeMatchista(kuittiTilitapahtumaksi(kuitti), kuitti, chart, asetukset);
}
