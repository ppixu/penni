/**
 * Penni's copyright, licence and source offer, shared by the web app (Tietoja view) and both
 * network transports (`apps/server`, `apps/pilvi`). AGPL-3.0-or-later §13 requires a modified
 * version that users interact with over a network to offer them its Corresponding Source; the
 * servers answer it at LAHDEKOODI_POLKU. Wording follows NOTICE.md.
 *
 * Whoever hosts a modified Penni must point the offer at THEIR source: the servers take the URL
 * from configuration (PENNI_LAHDEKOODI_URL / LAHDEKOODI_URL) and fall back to LAHDEKOODI_URL.
 */

/** Upstream source repository. */
export const LAHDEKOODI_URL = 'https://github.com/ppixu/penni';

/** HTTP path of the source offer on both servers (outside the API prefix, no login needed). */
export const LAHDEKOODI_POLKU = '/lahdekoodi';

export const TEKIJANOIKEUS = '© 2026 Olli Pikkarainen';

export const LISENSSI = 'AGPL-3.0-or-later';

export const LISENSSI_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/** Kitsas, from which the chart data and parts of the engine are derived (see NOTICE.md). */
export const KITSAS = {
  url: 'https://github.com/artoh/kitupiikki',
  tekijanoikeus: '© Arto Hyvättinen ja Kitsas Oy',
  lisenssi: 'GPL-3.0-or-later',
} as const;

export const SIVUSTO_URL = 'https://penni.pro';

export const YHTEYS_EMAIL = 'hei@penni.pro';

/** Plain-text source offer served at LAHDEKOODI_POLKU. */
export function lahdekoodiTarjous(url: string = LAHDEKOODI_URL): string {
  return [
    'Penni – kirjanpito-ohjelma',
    TEKIJANOIKEUS,
    '',
    'Penni on vapaa ohjelmisto: sitä saa levittää ja muokata GNU Affero General Public',
    'License -lisenssin version 3 tai (valintasi mukaan) minkä tahansa myöhemmän version',
    `ehdoilla (${LISENSSI}). Ohjelmalla ei ole MINKÄÄNLAISTA TAKUUTA. Lisenssi: ${LISENSSI_URL}`,
    '',
    `Tämän palvelun lähdekoodi: ${url}`,
    '',
    'Osa Pennistä (tilikarttadata ja osa moottorista) pohjautuu Kitsas-kirjanpito-ohjelmaan',
    `(${KITSAS.tekijanoikeus}, ${KITSAS.lisenssi}, ${KITSAS.url}). Penni on itsenäinen,`,
    'muokattu teos, eikä Kitsas Oy ole sen tekijä tai tue sitä.',
    '',
    `Source code of this service (${LISENSSI}): ${url}`,
    '',
  ].join('\n');
}
