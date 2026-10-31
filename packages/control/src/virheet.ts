export type TunnistusKoodi =
  | 'EMAIL_VARATTU'
  | 'EPAKELPO_EMAIL'
  | 'HEIKKO_SALASANA'
  | 'VAARA_TUNNUS'
  | 'EI_SESSIOTA';

export class TunnistusVirhe extends Error {
  constructor(
    readonly koodi: TunnistusKoodi,
    viesti?: string,
  ) {
    super(viesti ?? koodi);
    this.name = 'TunnistusVirhe';
  }
}
