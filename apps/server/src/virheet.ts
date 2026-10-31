/** Map a ResourceError.code to an HTTP status. Unknown codes -> 400. */
export function virheKoodiHttp(koodi: string): number {
  switch (koodi) {
    case 'EITOSITETTA':
    case 'EIRAPORTTIA':
      return 404;
    case 'PVMLUKITTU':
      return 409;
    case 'EIVALMISTU':
      return 422;
    case 'EITILIKAUTTA':
      return 400;
    default:
      return 400;
  }
}

/** Kartoita TunnistusVirhe.koodi HTTP-statukseksi. */
export function tunnistusKoodiHttp(koodi: string): number {
  switch (koodi) {
    case 'EMAIL_VARATTU':
      return 409;
    case 'HEIKKO_SALASANA':
    case 'EPAKELPO_EMAIL':
      return 400;
    default: // VAARA_TUNNUS, EI_SESSIOTA
      return 401;
  }
}
