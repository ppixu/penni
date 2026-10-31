import {
  type Tili,
  type Tosite,
  TositeTila,
  type ValidationContext,
  type VirheKoodi,
  tarkasta,
} from '@penni/engine';
import { laskeSummat } from './summat.js';
import { rakennaSyote } from './syote.js';
import type { TositeEditoriTila } from './types.js';

export type TallennusArvio = { voi: true } | { voi: false; syy: string };

/** Syyt tilariville ("Ei tallennettu — <syy>"). */
const SYYT: Record<VirheKoodi, string> = {
  PVMPUUTTUU: 'päivä puuttuu',
  EIAVOINTAKUTTA: 'päivälle ei ole avointa tilikautta',
  PVMLUKITTU: 'päivä osuu lukittuun kauteen',
  TILIPUUTTUU: 'tiliä ei ole tilikartassa',
  PVMALV: 'alv-kausi on jo ilmoitettu',
  EITASMAA: 'ei täsmää',
  EITASMAAPVM: 'päiväkohtainen saldo ei täsmää',
  ALVITON_ALVKIRJAUS: 'alv-kirjaus alv-vapaalle kaudelle',
  ERA_ILMAN_ERITTELYA: 'erä tilille, jota ei eritellä',
};
const MUODOSTUS_EI_ONNISTU = 'alv-vientejä ei voi muodostaa';

/** Sama TositeSyote kuin tallennuspolulla, tarkastettavaksi annetulla tilalla. */
function tarkastettava(
  tila: TositeEditoriTila,
  kohde: 'luonnos' | 'kirjattu',
  chart: readonly Tili[],
): Tosite | null {
  try {
    const {
      id: _id,
      tila: _tila,
      tunniste: _tunniste,
      ...syote
    } = rakennaSyote(tila, kohde, chart);
    return {
      ...syote,
      tila: kohde === 'kirjattu' ? TositeTila.KIRJANPIDOSSA : TositeTila.LUONNOS,
      tunniste: 0,
    };
  } catch {
    return null;
  }
}

/**
 * Kelpaako editorin tila kirjattuna (moottorin estävät tarkastukset, kuten tallennettaessa).
 * Järjestys: päivä, täsmäys (sama kuin täsmäyspalkissa, myös tilittömät summat), summa ilman
 * tiliä, muut estävät.
 */
export function voiTallentaaKirjattuna(
  tila: TositeEditoriTila,
  chart: readonly Tili[],
  ctx: ValidationContext,
): TallennusArvio {
  const tosite = tarkastettava(tila, 'kirjattu', chart);
  if (!tosite) return { voi: false, syy: MUODOSTUS_EI_ONNISTU };
  const estavat = new Set(
    tarkasta(tosite, ctx)
      .filter((r) => r.severity === 'block')
      .map((r) => r.code),
  );
  for (const koodi of ['PVMPUUTTUU', 'EIAVOINTAKUTTA', 'PVMLUKITTU'] as const) {
    if (estavat.has(koodi)) return { voi: false, syy: SYYT[koodi] };
  }
  // Tiliton summa puuttuu moottorin tosite-syötteestä, joten moottorin EITASMAA ei saa ohittaa
  // tilittömän summan syytä: täsmäyspalkin summa ensin, moottorin muut estot vasta sen jälkeen.
  if (!laskeSummat(tila.rows, chart, tila.paiva).tasmaa) return { voi: false, syy: SYYT.EITASMAA };
  if (tila.rows.some((r) => r.tili === undefined && (r.debetSnt !== 0 || r.kreditSnt !== 0)))
    return { voi: false, syy: 'rivillä on summa ilman tiliä' };
  const muu = [...estavat][0];
  return muu === undefined ? { voi: true } : { voi: false, syy: SYYT[muu] };
}

/** Luonnos saa olla keskeneräinen; vain lukitun kauden päivä estää (kuten moottorissa). */
export function voiTallentaaLuonnoksena(
  tila: TositeEditoriTila,
  chart: readonly Tili[],
  ctx: ValidationContext,
): TallennusArvio {
  const tosite = tarkastettava(tila, 'luonnos', chart);
  if (!tosite) return { voi: false, syy: MUODOSTUS_EI_ONNISTU };
  return tarkasta(tosite, ctx).some((r) => r.code === 'PVMLUKITTU')
    ? { voi: false, syy: SYYT.PVMLUKITTU }
    : { voi: true };
}
