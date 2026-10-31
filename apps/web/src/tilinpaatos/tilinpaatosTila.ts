export type TpTila = 'avoin' | 'lukittu' | 'vahvistettu';

/**
 * Tilikauden päättämisen tila: vahvistettu voittaa; muuten lukittu jos globaali
 * lukitusraja (TilitPaatetty) yltää vähintään kauden loppuun; muuten avoin.
 */
export function tilinpaatosTila(
  doc: { tilikausi: { loppuu: string }; vahvistettu: string | null },
  tilitPaatetty: string | null,
): TpTila {
  if (doc.vahvistettu !== null) return 'vahvistettu';
  if (tilitPaatetty !== null && tilitPaatetty >= doc.tilikausi.loppuu) return 'lukittu';
  return 'avoin';
}
