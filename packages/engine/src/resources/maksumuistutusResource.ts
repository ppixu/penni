import type { Cents } from '@penni/euro';
import { laskeMaksumuistutus } from '../laskutus/maksumuistutus.js';
import { lisaaPaivia, oikaiseErapaiva } from '../laskutus/paivat.js';
import { Maksutapa, TositeTila, TositeTyyppi, onKirjanpidossa } from '../vouchers/enums.js';
import type { IsoDate } from '../vouchers/types.js';
import { onkoMaksuperusteinenAlv } from './context.js';
import { type ResourceEnv, ResourceError, type Storage, type StoredTosite } from './storage.js';
import { tallennaTosite } from './tositeResource.js';

export interface MaksumuistutusSyote {
  /** Muistutettavien laskujen id:t; jokaiselle syntyy oma luonnos. */
  tositteet: number[];
  pvm: IsoDate;
  /** Oletus: `pvm` + `LaskuMaksuaika` päivää, oikaistuna pankkipäivään. */
  erapvm?: IsoDate;
  /** Muistutusmaksu; oletus `OLETUS_MUISTUTUSMAKSU`. */
  maksu?: Cents;
  korko: boolean;
  viivkorko?: number;
}

/**
 * Muistutuksen lähtötiedot: muistutettava lasku, sen aiemmat kirjatut muistutukset (vanhin
 * ensin) ja erän saldo päivänä `pvm`. Jos annettu tosite on itse muistutus, lähtökohtana on sen
 * alkuperäinen lasku, koska muistutusketju on aina laskun erällä.
 */
export async function muistutettavanTiedot(
  storage: Storage,
  laskuId: number,
  pvm: IsoDate,
): Promise<{ lasku: StoredTosite; aiemmat: StoredTosite[]; saldo: Cents }> {
  let lasku = await storage.getTosite(laskuId);
  if (!lasku) throw new ResourceError('EITOSITETTA', `Tositetta ${laskuId} ei ole`);
  if (lasku.tyyppi === TositeTyyppi.MAKSUMUISTUTUS && lasku.alkuperainenTosite !== undefined) {
    const alkuperainen = await storage.getTosite(lasku.alkuperainenTosite);
    if (!alkuperainen)
      throw new ResourceError('EITOSITETTA', `Tositetta ${lasku.alkuperainenTosite} ei ole`);
    lasku = alkuperainen;
  }

  const id = lasku.id;
  const [muistutukset, erat] = await Promise.all([
    storage.listTositteet({ tyyppi: TositeTyyppi.MAKSUMUISTUTUS }),
    storage.queryErat({ saldopvm: pvm }),
  ]);
  const aiemmat = muistutukset
    .filter((m) => m.alkuperainenTosite === id && onKirjanpidossa(m.tila))
    .sort((a, b) => (a.pvm === b.pvm ? a.id - b.id : a.pvm < b.pvm ? -1 : 1));
  return { lasku, aiemmat, saldo: (erat.get(id) ?? 0) as Cents };
}

/**
 * Voiko laskusta tehdä muistutuksen (spec §4.1; laskulistawidget.cpp:202-208): kirjattu myyntilasku
 * tai muistutus, maksutapa LASKU/ENNAKKOLASKU, kantaa erän, `erapvm < tanaan` ja erän saldo > 0.
 */
export function onMuistutettava(t: StoredTosite, saldo: Cents, tanaan: IsoDate): boolean {
  const maksutapa = t.maksutapa ?? Maksutapa.LASKU;
  return (
    onKirjanpidossa(t.tila) &&
    (t.tyyppi === TositeTyyppi.MYYNTILASKU || t.tyyppi === TositeTyyppi.MAKSUMUISTUTUS) &&
    (maksutapa === Maksutapa.LASKU || maksutapa === Maksutapa.ENNAKKOLASKU) &&
    t.viennit.some((v) => v.era != null) &&
    t.erapvm !== undefined &&
    t.erapvm < tanaan &&
    saldo > 0
  );
}

/**
 * Luo maksumuistutusluonnokset (tyyppi 216, tila VALMISLASKU) erääntyneistä laskuista. Kaikki
 * laskut tarkistetaan ennen kuin yhtään luonnosta tallennetaan, joten huono id erässä ei jätä
 * osittaista tulosta. Luonnoksella ei ole numeroa, viitettä eikä vientejä; kirjauksessa summat
 * lasketaan uudelleen. Alkuperäistä laskua ei muuteta.
 */
export async function luoMaksumuistutukset(
  storage: Storage,
  syote: MaksumuistutusSyote,
  env: ResourceEnv,
): Promise<StoredTosite[]> {
  const asetukset = await storage.getAsetukset();
  if (onkoMaksuperusteinenAlv(asetukset, syote.pvm))
    throw new ResourceError(
      'MAKSUPERUSTEINEN',
      'Maksumuistutusta ei voi tehdä, kun maksuperusteinen alv on käytössä',
    );

  const erapvm =
    syote.erapvm ??
    oikaiseErapaiva(lisaaPaivia(syote.pvm, Number(asetukset.LaskuMaksuaika ?? '14')));
  const peruskorko = Number(asetukset.LaskuPeruskorko ?? '0');
  const kumppanit = await storage.getKumppanit();

  const luonnokset = [];
  for (const laskuId of syote.tositteet) {
    const { lasku, aiemmat, saldo } = await muistutettavanTiedot(storage, laskuId, syote.pvm);
    if (!onMuistutettava(lasku, saldo, syote.pvm))
      throw new ResourceError('EIMUISTUTETTAVA', `Tositteesta ${laskuId} ei voi tehdä muistutusta`);

    const kumppani =
      lasku.kumppani !== undefined ? kumppanit.find((k) => k.id === lasku.kumppani) : undefined;
    const laskettu = laskeMaksumuistutus({
      alkuperainen: {
        erapvm: lasku.erapvm as IsoDate,
        ...(lasku.viivkorko !== undefined ? { viivkorko: lasku.viivkorko } : {}),
      },
      aiemmatMuistutukset: aiemmat.map((m) => ({
        pvm: m.pvm,
        maksu: m.muistutus?.maksu ?? (0 as Cents),
        korko: m.muistutus?.korko ?? (0 as Cents),
      })),
      aiempiSaldo: saldo,
      pvm: syote.pvm,
      korko: syote.korko,
      peruskorko,
      yritysasiakas: !!kumppani?.alvtunnus,
      ...(syote.maksu !== undefined ? { maksu: syote.maksu } : {}),
      ...(syote.viivkorko !== undefined ? { viivkorko: syote.viivkorko } : {}),
    });
    luonnokset.push({
      pvm: syote.pvm,
      tyyppi: TositeTyyppi.MAKSUMUISTUTUS,
      tila: TositeTila.VALMISLASKU,
      sarja: '',
      maksutapa: Maksutapa.LASKU,
      erapvm,
      otsikko: `Maksumuistutus laskusta ${lasku.numero ?? lasku.id}`,
      alkuperainenTosite: lasku.id,
      muistutus: { ...laskettu, aiemmat: [lasku.id, ...aiemmat.map((m) => m.id)] },
      viennit: [],
      ...(lasku.kumppani !== undefined ? { kumppani: lasku.kumppani } : {}),
    });
  }

  const tallennetut: StoredTosite[] = [];
  for (const luonnos of luonnokset) tallennetut.push(await tallennaTosite(storage, luonnos, env));
  return tallennetut;
}
