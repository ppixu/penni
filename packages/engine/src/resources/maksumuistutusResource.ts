import type { Cents } from '@penni/euro';
import { ViiteTyyppi, viiteEralle } from '@penni/validator';
import { type MuistutusLaskentaSyote, laskeMaksumuistutus } from '../laskutus/maksumuistutus.js';
import { lisaaPaivia, oikaiseErapaiva } from '../laskutus/paivat.js';
import { kasvataLaskunumeroa, lueSeuraavaLaskunumero } from '../laskutus/seuraavaLaskunumero.js';
import {
  Maksutapa,
  TositeTila,
  TositeTyyppi,
  VientiTyyppi,
  onKirjanpidossa,
} from '../vouchers/enums.js';
import type { IsoDate, Muistutus, TositeVienti } from '../vouchers/types.js';
import { onkoMaksuperusteinenAlv } from './context.js';
import { eranVienti, tiliAsetuksesta } from './myyntilaskuResource.js';
import {
  type Asetukset,
  type ResourceEnv,
  ResourceError,
  type Storage,
  type StoredTosite,
} from './storage.js';
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
 * alkuperäinen lasku, koska muistutusketju on aina laskun erällä; `valittu` on annettu tosite.
 */
export async function muistutettavanTiedot(
  storage: Storage,
  laskuId: number,
  pvm: IsoDate,
): Promise<{ lasku: StoredTosite; aiemmat: StoredTosite[]; saldo: Cents; valittu: StoredTosite }> {
  const valittu = await storage.getTosite(laskuId);
  if (!valittu) throw new ResourceError('EITOSITETTA', `Tositetta ${laskuId} ei ole`);
  let lasku = valittu;
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
  return { lasku, aiemmat, saldo: (erat.get(id) ?? 0) as Cents, valittu };
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

type MuistutettavanTiedot = Awaited<ReturnType<typeof muistutettavanTiedot>>;

/**
 * Kelpoisuus koko ketjulle (spec §4.1, ruling 5): valitun tositteen on oltava kirjattu,
 * alkuperäisen laskun täytettävä §4.1 ja uusimman kirjatun muistutuksen eräpäivän oltava ohi.
 */
function tarkistaMuistutettavuus(t: MuistutettavanTiedot, pvm: IsoDate, id: number): void {
  const uusinEra = t.aiemmat[t.aiemmat.length - 1]?.erapvm;
  if (
    !onKirjanpidossa(t.valittu.tila) ||
    !onMuistutettava(t.lasku, t.saldo, pvm) ||
    (uusinEra !== undefined && uusinEra >= pvm)
  )
    throw new ResourceError('EIMUISTUTETTAVA', `Tositteesta ${id} ei voi tehdä muistutusta`);
}

/** Muistutusta ei tehdä eikä kirjata, kun maksuperusteinen alv on voimassa (laskulistawidget.cpp:309-314). */
function tarkistaEiMaksuperusteinen(asetukset: Asetukset, pvm: IsoDate): void {
  if (onkoMaksuperusteinenAlv(asetukset, pvm))
    throw new ResourceError(
      'MAKSUPERUSTEINEN',
      'Maksumuistutusta ei voi tehdä, kun maksuperusteinen alv on käytössä',
    );
}

/** Laskee muistutuksen ketjun tiedoista; `aiemmat` = laskun id + aiemmat muistutukset, vanhin ensin. */
function laskeKetjulle(
  t: MuistutettavanTiedot,
  pvm: IsoDate,
  valinnat: Pick<
    MuistutusLaskentaSyote,
    'korko' | 'maksu' | 'viivkorko' | 'peruskorko' | 'yritysasiakas'
  >,
): Muistutus {
  const laskettu = laskeMaksumuistutus({
    alkuperainen: {
      erapvm: t.lasku.erapvm as IsoDate,
      ...(t.lasku.viivkorko !== undefined ? { viivkorko: t.lasku.viivkorko } : {}),
    },
    aiemmatMuistutukset: t.aiemmat.map((m) => ({
      pvm: m.pvm,
      maksu: m.muistutus?.maksu ?? (0 as Cents),
      korko: m.muistutus?.korko ?? (0 as Cents),
    })),
    aiempiSaldo: t.saldo,
    pvm,
    ...valinnat,
  });
  return { ...laskettu, aiemmat: [t.lasku.id, ...t.aiemmat.map((m) => m.id)] };
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
  tarkistaEiMaksuperusteinen(asetukset, syote.pvm);

  const erapvm =
    syote.erapvm ??
    oikaiseErapaiva(lisaaPaivia(syote.pvm, Number(asetukset.LaskuMaksuaika ?? '14')));
  const peruskorko = Number(asetukset.LaskuPeruskorko ?? '0');
  const kumppanit = await storage.getKumppanit();

  const luonnokset = [];
  for (const laskuId of syote.tositteet) {
    const tiedot = await muistutettavanTiedot(storage, laskuId, syote.pvm);
    tarkistaMuistutettavuus(tiedot, syote.pvm, laskuId);
    const { lasku } = tiedot;

    const kumppani =
      lasku.kumppani !== undefined ? kumppanit.find((k) => k.id === lasku.kumppani) : undefined;
    const muistutus = laskeKetjulle(tiedot, syote.pvm, {
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
      muistutus,
      viennit: [],
      ...(lasku.kumppani !== undefined ? { kumppani: lasku.kumppani } : {}),
    });
  }

  const tallennetut: StoredTosite[] = [];
  for (const luonnos of luonnokset) tallennetut.push(await tallennaTosite(storage, luonnos, env));
  return tallennetut;
}

/** Kirjauksessa muutettavat kentät (ruling 6); korkojakso ja saldot johdetaan aina uudelleen. */
export interface MaksumuistutusMuutokset {
  pvm?: IsoDate;
  erapvm?: IsoDate;
  otsikko?: string;
  muistutus?: { maksu?: Cents; viivkorko?: number };
}

/** IsoDate → d.m.yyyy. */
function suomeksi(pvm: IsoDate): string {
  const [v, kk, pv] = pvm.split('-');
  return `${Number(pv)}.${Number(kk)}.${v}`;
}

/**
 * Kirjaa maksumuistutusluonnoksen (spec §4.4; maksumuistutusmuodostaja.cpp:79-165). Muistutus
 * lasketaan uudelleen ketjusta luonnoksen (tai muutosten) päivän erän saldolla: maksu ja
 * korkoprosentti luonnokselta, korko mukana vain jos luonnoksella on korkoa. Saa numeron
 * `LaskuSeuraavaId`:stä ja viitteen kuten lasku. Viennit (kaikki alv-koodilla 0): debet
 * alkuperäisen erävientin tilille `maksu + korko` samalle erälle (202), kredit
 * `LaskuMaksumuistutustili` (201, "Huomautuskulut") ja `LaskuViivastyskorkotili` (201,
 * "Viivästyskorko d.m.yyyy–d.m.yyyy"). Nollamuistutus kirjataan ilman vientejä. Alkuperäistä
 * laskua ei muuteta.
 */
export async function kirjaaMaksumuistutus(
  storage: Storage,
  luonnos: StoredTosite,
  env: ResourceEnv,
  muutokset: MaksumuistutusMuutokset = {},
): Promise<StoredTosite> {
  const alkuperainenId = luonnos.alkuperainenTosite;
  if (!luonnos.muistutus || alkuperainenId === undefined)
    throw new ResourceError(
      'EIMUISTUTUSTIETOJA',
      'Maksumuistutukselta puuttuvat muistutustiedot tai alkuperäinen lasku',
    );

  const pvm = muutokset.pvm ?? luonnos.pvm;
  const asetukset = await storage.getAsetukset();
  tarkistaEiMaksuperusteinen(asetukset, pvm);
  const tiedot = await muistutettavanTiedot(storage, alkuperainenId, pvm);
  tarkistaMuistutettavuus(tiedot, pvm, alkuperainenId);

  const muistutus = laskeKetjulle(tiedot, pvm, {
    maksu: muutokset.muistutus?.maksu ?? luonnos.muistutus.maksu,
    korko: luonnos.muistutus.korko > 0,
    viivkorko: muutokset.muistutus?.viivkorko ?? luonnos.muistutus.viivkorko,
    // Korkoprosentti annetaan aina, joten oletuskorkoa (peruskorko + 7/8) ei käytetä.
    peruskorko: 0,
    yritysasiakas: false,
  });

  const maksutili = tiliAsetuksesta(asetukset, 'LaskuMaksumuistutustili');
  const korkotili = tiliAsetuksesta(asetukset, 'LaskuViivastyskorkotili');
  if (muistutus.maksu > 0 && maksutili === undefined)
    throw new ResourceError('EILASKUTILIA', 'LaskuMaksumuistutustili puuttuu');
  if (muistutus.korko > 0 && korkotili === undefined)
    throw new ResourceError('EILASKUTILIA', 'LaskuViivastyskorkotili puuttuu');
  const eraLeg = eranVienti(tiedot.lasku.viennit);
  if (!eraLeg || eraLeg.era == null)
    throw new ResourceError('EIMUISTUTETTAVA', `Tositteella ${alkuperainenId} ei ole erää`);

  const otsikko = muutokset.otsikko ?? luonnos.otsikko;
  const erapvm = muutokset.erapvm ?? luonnos.erapvm;
  const nolla = 0 as Cents;
  const vienti = (tili: number, debet: Cents, kredit: Cents, tyyppi: number): TositeVienti => ({
    tili,
    debet,
    kredit,
    pvm,
    alvKoodi: 0,
    alvProsentti: 0,
    tyyppi,
  });
  const viennit: TositeVienti[] = [];
  const yhteensa = (muistutus.maksu + muistutus.korko) as Cents;
  if (yhteensa > 0) {
    viennit.push({
      ...vienti(eraLeg.tili, yhteensa, nolla, VientiTyyppi.MYYNTI + VientiTyyppi.VASTAKIRJAUS),
      era: eraLeg.era,
      ...(otsikko ? { selite: otsikko } : {}),
    });
  }
  if (muistutus.maksu > 0)
    viennit.push({
      ...vienti(
        maksutili as number,
        nolla,
        muistutus.maksu,
        VientiTyyppi.MYYNTI + VientiTyyppi.KIRJAUS,
      ),
      selite: 'Huomautuskulut',
    });
  if (muistutus.korko > 0)
    viennit.push({
      ...vienti(
        korkotili as number,
        nolla,
        muistutus.korko,
        VientiTyyppi.MYYNTI + VientiTyyppi.KIRJAUS,
      ),
      selite: `Viivästyskorko ${suomeksi(muistutus.korkoalkaa)}–${suomeksi(muistutus.korkoloppuu)}`,
    });

  // Numero ja viite kuten laskulla (tositeroute.cpp:236-265 numeroi tyypit 210–216).
  const numero = lueSeuraavaLaskunumero(asetukset);
  const kirjattu = await tallennaTosite(
    storage,
    {
      ...luonnos,
      pvm,
      ...(otsikko !== undefined ? { otsikko } : {}),
      ...(erapvm !== undefined ? { erapvm } : {}),
      tila: TositeTila.KIRJANPIDOSSA,
      numero,
      viite: viiteEralle(ViiteTyyppi.LASKU, Number(numero)),
      muistutus,
      viennit,
    },
    env,
  );
  // Laskuri etenee heti numeron antaneen tallennuksen jälkeen (hylätty kirjaus ei polta numeroa).
  await kasvataLaskunumeroa(storage, numero);
  return kirjattu;
}
