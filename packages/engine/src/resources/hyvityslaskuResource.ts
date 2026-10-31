import { seuraavaLaskunumero } from '../laskutus/seuraavaLaskunumero.js';
import { TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import type { IsoDate, TositeVienti } from '../vouchers/types.js';
import { type ResourceEnv, ResourceError, type Storage, type StoredTosite } from './storage.js';
import { tallennaTosite } from './tositeResource.js';

export interface HyvityslaskuSyote {
  alkuperainenTosite: number;
  pvm: IsoDate;
  otsikko?: string;
}

/**
 * Hyvityslasku = alkuperäisen tositteen vientien käänteiskirjaus (kirjattuunpuolet vaihtaen,
 * era säilytetään settauspuolella -> nettouttaa alkuperäisen erän queryErat'ssa). Myyntilaskun
 * (tyyppi 210-219) hyvitys on HYVITYSLASKU(214); ostolaskun (MENO-perhe) hyvitys on
 * MENO(100)-käänteiskirjaus. Täysimääräinen hyvitys (koko tosite). Legacy: laskudialogitehdas.cpp.
 */
export async function tallennaHyvityslasku(
  storage: Storage,
  syote: HyvityslaskuSyote,
  env: ResourceEnv,
): Promise<StoredTosite> {
  const alkup = await storage.getTosite(syote.alkuperainenTosite);
  if (!alkup)
    throw new ResourceError('EITOSITETTA', `Tositetta ${syote.alkuperainenTosite} ei ole`);
  if (!alkup.viennit.some((v) => v.era != null))
    throw new ResourceError('EIHYVITETTAVAA', 'Hyvitettävällä tositteella ei ole erää');

  const viennit: TositeVienti[] = alkup.viennit.map((v) => ({
    ...v,
    debet: v.kredit,
    kredit: v.debet,
    pvm: syote.pvm,
  }));

  const myynti = alkup.tyyppi >= TositeTyyppi.MYYNTILASKU && alkup.tyyppi <= 219;
  const tyyppi = myynti ? TositeTyyppi.HYVITYSLASKU : TositeTyyppi.MENO;

  // Myynnin hyvityslasku jatkaa myyntilaskujen numerosarjaa ja perii alkuperäisen viitteen
  // (tositeroute.cpp:236-265, laskudialogitehdas.cpp:141-177).
  const numero = myynti
    ? await seuraavaLaskunumero(storage, await storage.getAsetukset())
    : undefined;

  return tallennaTosite(
    storage,
    {
      pvm: syote.pvm,
      tyyppi,
      tila: TositeTila.KIRJANPIDOSSA,
      sarja: '',
      viennit,
      alkuperainenTosite: syote.alkuperainenTosite,
      ...(numero !== undefined ? { numero } : {}),
      ...(myynti && alkup.viite !== undefined ? { viite: alkup.viite } : {}),
      ...(alkup.kumppani !== undefined ? { kumppani: alkup.kumppani } : {}),
      ...(syote.otsikko !== undefined ? { otsikko: syote.otsikko } : {}),
    },
    env,
  );
}
