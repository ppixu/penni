import type { IsoDate } from '../vouchers/types.js';
import { ResourceError, type Storage, type Tilikausi } from './storage.js';

/** Edellinen päivä ISO-muodossa (UTC-turvallinen kokonaislukulaskenta, ei aikavyöhykettä/liukulukua). */
export function edellinenPaiva(iso: IsoDate): IsoDate {
  const v = Number(iso.slice(0, 4));
  const k = Number(iso.slice(5, 7));
  const p = Number(iso.slice(8, 10));
  return new Date(Date.UTC(v, k - 1, p - 1)).toISOString().slice(0, 10);
}

function haeKausi(kaudet: Tilikausi[], alkaa: IsoDate): Tilikausi {
  const kausi = kaudet.find((t) => t.alkaa === alkaa);
  if (!kausi) throw new ResourceError('EITILIKAUTTA', `Tilikautta ${alkaa} ei ole`);
  return kausi;
}

/**
 * Lukitse kirjanpito valitun tilikauden loppuun asti (TilitPaatetty = kausi.loppuu).
 * TilitPaatetty on yksi globaali raja, joka liikkuu vain eteenpäin: lukitus saa
 * ainoastaan siirtää rajaa myöhemmäksi. Jos raja on jo tämän kauden lopussa tai sen yli,
 * kausi on jo lukittu (JOLUKITTU). Lukitus etenee vanhimmasta uusimpaan, joten se
 * estetään myös, jos jokin aiempi kausi on vielä auki (EDELLINENAUKI).
 */
export async function paataTilikausi(storage: Storage, alkaa: IsoDate): Promise<void> {
  const kaudet = await storage.getTilikaudet();
  const kausi = haeKausi(kaudet, alkaa);
  const asetukset = await storage.getAsetukset();
  const raja = asetukset.TilitPaatetty ?? null;
  if (raja !== null && raja >= kausi.loppuu)
    throw new ResourceError('JOLUKITTU', 'Tilikausi on jo lukittu');
  for (const k of kaudet) {
    if (k.alkaa < alkaa && (raja === null || raja < k.loppuu))
      throw new ResourceError('EDELLINENAUKI', 'Aiempi tilikausi on vielä auki');
  }
  await storage.patchAsetukset({ TilitPaatetty: kausi.loppuu });
}

/**
 * Avaa valittu tilikausi (TilitPaatetty = kausi.alkaa - 1 pv). Globaali raja liikkuu
 * avattaessa vain taaksepäin: jos raja on tyhjä tai jo ennen tämän kauden alkua, kausi ei
 * ole lukittu (JOAUKI). Avaus etenee uusimmasta vanhimpaan, joten se estetään, jos jokin
 * myöhempi kausi on yhä lukittu (SEURAAVALUKITTU).
 */
export async function avaaTilikausi(storage: Storage, alkaa: IsoDate): Promise<void> {
  const kaudet = await storage.getTilikaudet();
  const kausi = haeKausi(kaudet, alkaa);
  const asetukset = await storage.getAsetukset();
  if (asetukset[`vahvistettu/${kausi.loppuu}`])
    throw new ResourceError(
      'VAHVISTETTU',
      'Peru tilinpäätöksen vahvistus ennen tilikauden avaamista',
    );
  const raja = asetukset.TilitPaatetty ?? null;
  if (raja === null || raja < kausi.alkaa)
    throw new ResourceError('JOAUKI', 'Tilikausi ei ole lukittu');
  for (const k of kaudet) {
    if (k.alkaa > alkaa && k.loppuu <= raja)
      throw new ResourceError('SEURAAVALUKITTU', 'Myöhempi tilikausi on lukittu');
  }
  await storage.patchAsetukset({ TilitPaatetty: edellinenPaiva(kausi.alkaa) });
}
