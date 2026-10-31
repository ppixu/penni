import type { IsoDate } from '../vouchers/types.js';
import { type Tiliote, onkoKuukausitiliote, poimiKuukausitiliote } from './poimiKuukausitiliote.js';
import { poimiTiliote } from './poimiTiliote.js';

const TAPAHTUMAT_KAUSI =
  /Tapahtumat\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/;

function iso(v: string | undefined, kk: string | undefined, d: string | undefined): IsoDate {
  return `${v ?? ''}-${(kk ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`;
}

/**
 * Tunnistaa tiliotteen muodon ja poimii sen: pankin kuukausitiliote (kausi + saldot) tai
 * "Tapahtumat"-luettelo (rivi per tapahtuma, ei saldoja). Kutsuja voi näin syöttää minkä
 * tahansa tuetun PDF:n tekstin samaan funktioon.
 */
export function poimiTiliotteet(teksti: string): Tiliote {
  if (onkoKuukausitiliote(teksti)) return poimiKuukausitiliote(teksti);
  const tulos: Tiliote = { muoto: 'tapahtumat', tapahtumat: poimiTiliote(teksti) };
  const k = TAPAHTUMAT_KAUSI.exec(teksti.replace(/\s+/g, ' '));
  if (k) tulos.kausi = { alkaa: iso(k[3], k[2], k[1]), loppuu: iso(k[6], k[5], k[4]) };
  return tulos;
}
