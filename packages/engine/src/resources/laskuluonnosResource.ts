import type { Cents } from '@penni/euro';
import { laskuSummat } from '../laskutus/laskuSummat.js';
import { TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import type { IsoDate } from '../vouchers/types.js';
import { type MyyntilaskuSyote, kirjaaMyyntilaskuYdin } from './myyntilaskuResource.js';
import { type ResourceEnv, ResourceError, type Storage, type StoredTosite } from './storage.js';

/** Tositetyypit, joista voi olla laskuluonnos. */
export const LUONNOSTYYPIT: readonly number[] = [
  TositeTyyppi.MYYNTILASKU,
  TositeTyyppi.MAKSUMUISTUTUS,
];

/**
 * Laskuluonnos = myyntilasku tai maksumuistutus tilassa 50–99. Mukana tuodut Kitsas-luonnokset
 * (tila 50), joilla on Kitsaksen generoimat viennit; kirjaus generoi ne uudelleen riveistä.
 */
export function onLaskuluonnos(t: StoredTosite): boolean {
  return (
    t.tila >= TositeTila.LUONNOS &&
    t.tila < TositeTila.KIRJANPIDOSSA &&
    LUONNOSTYYPIT.includes(t.tyyppi)
  );
}

/** Rakentaa tallennetusta luonnoksesta kirjauksen syötteen. */
function luonnosSyotteeksi(t: StoredTosite): MyyntilaskuSyote {
  return {
    pvm: t.pvm,
    rivit: t.rivit ?? [],
    ...(t.laskupvm !== undefined ? { laskupvm: t.laskupvm } : {}),
    ...(t.erapvm !== undefined ? { erapvm: t.erapvm } : {}),
    ...(t.kumppani !== undefined ? { kumppani: t.kumppani } : {}),
    ...(t.otsikko !== undefined ? { otsikko: t.otsikko } : {}),
    ...(t.maksutapa !== undefined ? { maksutapa: t.maksutapa } : {}),
    ...(t.sarja !== '' ? { sarja: t.sarja } : {}),
    ...(t.jakso !== undefined ? { jakso: t.jakso } : {}),
    ...(t.info !== undefined ? { info: t.info } : {}),
    ...(t.viivkorko !== undefined ? { viivkorko: t.viivkorko } : {}),
    ...(t.toisto !== undefined ? { toisto: t.toisto } : {}),
    ...(t.toistoPvm !== undefined ? { toistoPvm: t.toistoPvm } : {}),
    ...(t.ryhma !== undefined ? { ryhma: t.ryhma } : {}),
  };
}

/** Maksumuistutuksen kirjaus. Tehtävä 9 korvaa tämän; siihen asti muistutusta ei voi kirjata. */
async function kirjaaMuistutusluonnos(_t: StoredTosite): Promise<StoredTosite> {
  throw new ResourceError(
    'EIMUISTUTUSTIETOJA',
    'Maksumuistutuksen kirjaus ei ole vielä käytössä tai muistutukselta puuttuvat tiedot',
  );
}

/**
 * Kirjaa luonnoksen: yhdistää `muutokset` tallennetun luonnoksen kenttien päälle ja ajaa
 * kirjauksen luonnoksen omalla id:llä, jolloin eräavain pysyy luonnoksen id:nä. Kirjatun
 * tositteen pvm tulee yhdistetyistä tiedoista. Muu kuin luonnos (kirjattu, poistettu, puuttuva)
 * → EILUONNOS.
 */
export async function kirjaaLaskuluonnos(
  storage: Storage,
  id: number,
  env: ResourceEnv,
  muutokset: Partial<MyyntilaskuSyote> = {},
): Promise<StoredTosite> {
  const t = await storage.getTosite(id);
  if (!t || !onLaskuluonnos(t))
    throw new ResourceError('EILUONNOS', `Tosite ${id} ei ole laskuluonnos`);

  if (t.tyyppi === TositeTyyppi.MAKSUMUISTUTUS) return kirjaaMuistutusluonnos(t);

  const { luonnos: _luonnos, id: _id, ...muutos } = muutokset;
  return kirjaaMyyntilaskuYdin(storage, { ...luonnosSyotteeksi(t), ...muutos }, env, id);
}

export interface LaskuluonnosRivi {
  tosite: number;
  tyyppi: number;
  tila: number;
  pvm: IsoDate;
  erapvm?: IsoDate;
  kumppani?: number;
  asiakas?: string;
  otsikko?: string;
  summa: Cents;
  toisto?: number;
  alkuperainenTosite?: number;
  ryhma?: string;
}

/**
 * Luonnokset (tila 50–99; myyntilasku ja maksumuistutus), vanhin päivä ensin. Summa on laskulla
 * rivien brutto (`laskuSummat`), muistutuksella muistutusmaksu + korko.
 */
export async function listaaLaskuluonnokset(storage: Storage): Promise<LaskuluonnosRivi[]> {
  const [tositteet, kumppanit] = await Promise.all([
    storage.listTositteet({ bucket: 'luonnos' }),
    storage.getKumppanit(),
  ]);
  const nimet = new Map(kumppanit.map((k) => [k.id, k.nimi]));

  const rivit: LaskuluonnosRivi[] = [];
  for (const t of tositteet.filter(onLaskuluonnos)) {
    const summa =
      t.tyyppi === TositeTyyppi.MAKSUMUISTUTUS
        ? ((t.muistutus ? t.muistutus.maksu + t.muistutus.korko : 0) as Cents)
        : laskuSummat(t.rivit ?? []).brutto;
    const asiakas = t.kumppani !== undefined ? nimet.get(t.kumppani) : undefined;
    rivit.push({
      tosite: t.id,
      tyyppi: t.tyyppi,
      tila: t.tila,
      pvm: t.pvm,
      summa,
      ...(t.erapvm !== undefined ? { erapvm: t.erapvm } : {}),
      ...(t.kumppani !== undefined ? { kumppani: t.kumppani } : {}),
      ...(asiakas !== undefined ? { asiakas } : {}),
      ...(t.otsikko !== undefined ? { otsikko: t.otsikko } : {}),
      ...(t.toisto !== undefined ? { toisto: t.toisto } : {}),
      ...(t.alkuperainenTosite !== undefined ? { alkuperainenTosite: t.alkuperainenTosite } : {}),
      ...(t.ryhma !== undefined ? { ryhma: t.ryhma } : {}),
    });
  }
  rivit.sort((a, b) => (a.pvm === b.pvm ? a.tosite - b.tosite : a.pvm < b.pvm ? -1 : 1));
  return rivit;
}
