import type { IsoDate } from '../vouchers/types.js';
import { type RaporttiRivi, laadiRaportti } from './raportti.js';
import { type ResourceEnv, ResourceError, type Storage } from './storage.js';

export type TilinpaatosMuoto = 'yleinen' | 'pien' | 'mikro';

/** Tilinpäätöksen muoto -> raporttikaavaparit (kokoluokan mukaiset tase/tulos-kaavat). */
const KAAVAT: Record<TilinpaatosMuoto, { tase: string; tulos: string }> = {
  yleinen: { tase: 'tase/yleinen', tulos: 'tulos/yleinen' },
  pien: { tase: 'tase/PMA', tulos: 'tulos/pienbrutto' },
  mikro: { tase: 'tase/PMA', tulos: 'tulos/mikrobrutto' },
};

export interface TilinpaatosParams {
  alkaa: IsoDate;
  muoto?: TilinpaatosMuoto;
}

export interface TilinpaatosDoc {
  tilikausi: { alkaa: IsoDate; loppuu: IsoDate };
  muoto: TilinpaatosMuoto;
  tuloslaskelma: RaporttiRivi[];
  tase: RaporttiRivi[];
  liitetiedot: string;
  vahvistettu: IsoDate | null;
}

export interface LiitetiedotSyote {
  loppupvm: IsoDate;
  teksti: string;
}

/** Kokoaa tilikauden tilinpäätöksen: tuloslaskelma + tase (olemassa olevalla raporttimoottorilla)
 *  sekä tallennetut liitetiedot ja vahvistuspäivä. Puhdas luku — ei kirjaa mitään. */
export async function laadiTilinpaatos(
  storage: Storage,
  env: ResourceEnv,
  params: TilinpaatosParams,
): Promise<TilinpaatosDoc> {
  const kaudet = await storage.getTilikaudet();
  const kausi = kaudet.find((t) => t.alkaa === params.alkaa);
  if (!kausi) throw new ResourceError('EITILIKAUTTA', `Tilikautta ${params.alkaa} ei ole`);

  const asetukset = await storage.getAsetukset();
  const pyydetty = params.muoto ?? (asetukset.Tilinpaatosmuoto as TilinpaatosMuoto | undefined);
  const muoto: TilinpaatosMuoto = pyydetty && pyydetty in KAAVAT ? pyydetty : 'yleinen';
  const kaava = KAAVAT[muoto];

  const tuloslaskelma = await laadiRaportti(storage, env, {
    muoto: kaava.tulos,
    pvm: kausi.loppuu,
    alkupvm: kausi.alkaa,
  });
  const tase = await laadiRaportti(storage, env, { muoto: kaava.tase, pvm: kausi.loppuu });

  return {
    tilikausi: { alkaa: kausi.alkaa, loppuu: kausi.loppuu },
    muoto,
    tuloslaskelma,
    tase,
    liitetiedot: asetukset[`liitetiedot/${kausi.loppuu}`] ?? '',
    vahvistettu: (asetukset[`vahvistettu/${kausi.loppuu}`] as IsoDate | undefined) ?? null,
  };
}

/** Tallentaa tilikauden liitetiedot (yksi vapaatekstilohko). Vahvistettua ei voi muokata. */
export async function tallennaLiitetiedot(
  storage: Storage,
  syote: LiitetiedotSyote,
): Promise<void> {
  const kaudet = await storage.getTilikaudet();
  if (!kaudet.some((t) => t.loppuu === syote.loppupvm))
    throw new ResourceError(
      'EITILIKAUTTA',
      `Liitetiedot on kohdistettava tilikauden loppupäivään; ${syote.loppupvm} ei ole minkään tilikauden loppu`,
    );
  const asetukset = await storage.getAsetukset();
  if (asetukset[`vahvistettu/${syote.loppupvm}`])
    throw new ResourceError(
      'JOVAHVISTETTU',
      'Vahvistetun tilinpäätöksen liitetietoja ei voi muokata',
    );
  await storage.patchAsetukset({ [`liitetiedot/${syote.loppupvm}`]: syote.teksti });
}

export interface VahvistusSyote {
  alkaa: IsoDate;
}

/** Vahvistaa (lukitsee lopullisesti) tilikauden tilinpäätöksen. Edellyttää, että kausi on jo
 *  päätetty (TilitPaatetty kattaa kauden lopun). Ei kirjaa tulosta omaan pääomaan — saldot
 *  laskevat sen valmiiksi. */
export async function vahvistaTilinpaatos(
  storage: Storage,
  syote: VahvistusSyote,
  env: ResourceEnv,
): Promise<void> {
  const kaudet = await storage.getTilikaudet();
  const kausi = kaudet.find((t) => t.alkaa === syote.alkaa);
  if (!kausi) throw new ResourceError('EITILIKAUTTA', `Tilikautta ${syote.alkaa} ei ole`);
  const asetukset = await storage.getAsetukset();
  const raja = asetukset.TilitPaatetty ?? null;
  if (raja === null || raja < kausi.loppuu)
    throw new ResourceError('EIPAATETTY', 'Lukitse tilikausi ennen tilinpäätöksen vahvistamista');
  if (asetukset[`vahvistettu/${kausi.loppuu}`])
    throw new ResourceError('JOVAHVISTETTU', 'Tilinpäätös on jo vahvistettu');
  await storage.patchAsetukset({ [`vahvistettu/${kausi.loppuu}`]: env.aika.slice(0, 10) });
}

/** Peruu tilinpäätöksen vahvistuksen (kausi jää TilitPaatetty-lukituksi). */
export async function peruVahvistus(storage: Storage, syote: VahvistusSyote): Promise<void> {
  const kaudet = await storage.getTilikaudet();
  const kausi = kaudet.find((t) => t.alkaa === syote.alkaa);
  if (!kausi) throw new ResourceError('EITILIKAUTTA', `Tilikautta ${syote.alkaa} ei ole`);
  await storage.patchAsetukset({ [`vahvistettu/${kausi.loppuu}`]: null });
}
