import { lisaaPaivia, oikaiseErapaiva, siirraKuukausia } from '../laskutus/paivat.js';
import { type Toisto, paivitaRivienAlv, pohjaLaskusta, siirraJaksoa } from '../laskutus/toisto.js';
import type { Tuote } from '../laskutus/tuote.js';
import { TositeTila, TositeTyyppi, onKirjanpidossa } from '../vouchers/enums.js';
import type { IsoDate, TositeRivi } from '../vouchers/types.js';
import { tallennaMyyntilasku } from './myyntilaskuResource.js';
import { tilikausiPaivalle } from './numbering.js';
import { type ResourceEnv, ResourceError, type Storage, type StoredTosite } from './storage.js';

export interface ToistoLaskustaSyote {
  tosite: number;
  kuukausia: number;
  /** Ensimmäinen luontipäivä; oletus laskupvm + `kuukausia` kuukautta. */
  seuraava?: IsoDate;
  /** Viimeinen mahdollinen luontipäivä (mukaan lukien). */
  loppuu?: IsoDate;
  nimi?: string;
}

export interface ErantyneetToistot {
  /** Luotujen luonnosten tosite-id:t luontijärjestyksessä. */
  luodut: number[];
  /** Ajo ohitettiin: tälle päivälle ei ole tilikautta tai päivä on lukitussa kaudessa. */
  ohitettu?: 'EITILIKAUTTA' | 'LUKITTU';
}

function kelpaaValiksi(kuukausia: number): boolean {
  return Number.isInteger(kuukausia) && kuukausia >= 1;
}

/**
 * Luo toiston KIRJATUSTA myyntilaskusta (spec §5.2). Puuttuva tai poistettu tosite → EITOSITETTA;
 * muu kuin kirjattu myyntilasku (esim. luonnos) → EIKELPAA; `kuukausia` ei kokonaisluku ≥ 1 →
 * EIKUUKAUSIA. Asiakas tulee laskulta, pohja `pohjaLaskusta`:lla.
 */
export async function luoToistoLaskusta(
  storage: Storage,
  syote: ToistoLaskustaSyote,
  _env: ResourceEnv,
): Promise<Toisto> {
  const t = await storage.getTosite(syote.tosite);
  if (!t || t.tila === TositeTila.POISTETTU)
    throw new ResourceError('EITOSITETTA', `Tositetta ${syote.tosite} ei ole`);
  if (t.tyyppi !== TositeTyyppi.MYYNTILASKU || !onKirjanpidossa(t.tila))
    throw new ResourceError('EIKELPAA', 'Toiston voi luoda vain kirjatusta myyntilaskusta');
  if (!kelpaaValiksi(syote.kuukausia))
    throw new ResourceError('EIKUUKAUSIA', 'Toistovälin on oltava vähintään yksi kuukausi');

  return storage.saveToisto({
    ...(syote.nimi !== undefined ? { nimi: syote.nimi } : {}),
    ...(t.kumppani !== undefined ? { kumppani: t.kumppani } : {}),
    kuukausia: syote.kuukausia,
    seuraava: syote.seuraava ?? siirraKuukausia(t.laskupvm ?? t.pvm, syote.kuukausia),
    ...(syote.loppuu !== undefined ? { loppuu: syote.loppuu } : {}),
    pohja: pohjaLaskusta(t, syote.kuukausia),
    lahdeTosite: t.id,
    aktiivinen: true,
  });
}

const avain = (toisto: number, pvm: IsoDate) => `${toisto}|${pvm}`;

/** Poistamattomien (luonnos tai kirjattu) myyntilaskujen (toisto, toistoPvm)-avaimet. */
async function olemassaOlevat(storage: Storage): Promise<Set<string>> {
  const [luonnokset, kirjatut] = await Promise.all([
    storage.listTositteet({ bucket: 'luonnos', tyyppi: TositeTyyppi.MYYNTILASKU }),
    storage.listTositteet({ bucket: 'kirjanpidossa', tyyppi: TositeTyyppi.MYYNTILASKU }),
  ]);
  const avaimet = new Set<string>();
  for (const t of [...luonnokset, ...kirjatut])
    if (t.toisto !== undefined && t.toistoPvm !== undefined)
      avaimet.add(avain(t.toisto, t.toistoPvm));
  return avaimet;
}

/** Tuoterivit saavat á-hinnan tuoterekisteristä; poistetun tuotteen rivi säilyy ennallaan. */
function paivitaHinnat(rivit: readonly TositeRivi[], tuotteet: ReadonlyMap<number, Tuote>) {
  return rivit.map((r) => {
    const tuote = r.tuote !== undefined ? tuotteet.get(r.tuote) : undefined;
    return tuote ? { ...r, aNetto: tuote.aNetto } : r;
  });
}

/** Luo yhden toiston luonnoksen ajastetulle päivälle `toisto.seuraava`. */
async function luoLuonnos(
  storage: Storage,
  toisto: Toisto,
  tanaan: IsoDate,
  lukitusraja: IsoDate | null,
  tuotteet: ReadonlyMap<number, Tuote>,
  env: ResourceEnv,
): Promise<StoredTosite> {
  const { pohja, seuraava } = toisto;
  // Lukittuun kauteen osuva (myöhässä luotava) lasku päivätään tälle päivälle, kuten Kitsas
  // päivää kaikki uusitut laskut (laskunuusinta.cpp:112-114); toistoPvm säilyy ajastettuna.
  const laskupvm = lukitusraja !== null && seuraava <= lukitusraja ? tanaan : seuraava;
  const rivit = paivitaHinnat(
    paivitaRivienAlv(pohja.rivit, pohja.jakso?.loppuu ?? laskupvm),
    tuotteet,
  );
  return tallennaMyyntilasku(
    storage,
    {
      pvm: laskupvm,
      laskupvm,
      erapvm: oikaiseErapaiva(lisaaPaivia(laskupvm, pohja.maksuaikaPaivia)),
      rivit,
      maksutapa: pohja.maksutapa,
      ...(toisto.kumppani !== undefined ? { kumppani: toisto.kumppani } : {}),
      ...(pohja.otsikko !== undefined ? { otsikko: pohja.otsikko } : {}),
      ...(pohja.sarja !== undefined ? { sarja: pohja.sarja } : {}),
      ...(pohja.jakso !== undefined ? { jakso: pohja.jakso } : {}),
      ...(typeof pohja.info === 'string' ? { info: pohja.info } : {}),
      ...(typeof pohja.viivkorko === 'number' ? { viivkorko: pohja.viivkorko } : {}),
      luonnos: true,
      toisto: toisto.id,
      toistoPvm: seuraava,
    },
    env,
  );
}

/** Siirtää aikataulua yhden välin: seuraava ja pohjan jakso; päättymisen jälkeen ei aktiivinen. */
function siirraAikataulua(t: Toisto): Toisto {
  const seuraava = siirraKuukausia(t.seuraava, t.kuukausia);
  return {
    ...t,
    seuraava,
    pohja: {
      ...t.pohja,
      ...(t.pohja.jakso !== undefined ? { jakso: siirraJaksoa(t.pohja.jakso, t.kuukausia) } : {}),
    },
    aktiivinen: t.loppuu === undefined || seuraava <= t.loppuu,
  };
}

const onErantynyt = (t: Toisto, tanaan: IsoDate) =>
  t.aktiivinen &&
  kelpaaValiksi(t.kuukausia) &&
  t.seuraava <= tanaan &&
  (t.loppuu === undefined || t.seuraava <= t.loppuu);

/**
 * Luo erääntyneiden toistojen luonnokset (spec §5.3). Jokaiselle aktiiviselle toistolle, jonka
 * `seuraava ≤ tanaan` (ja ≤ `loppuu`): luonnos ajastetulle päivälle, sitten aikataulu siirtyy
 * välin eteenpäin ja toisto tallennetaan — toistetaan niin kauan kuin erääntyneitä on, joten
 * jokainen väliin jäänyt kuukausi saa oman luonnoksensa.
 *
 * Idempotenssi: luonnos ohitetaan, jos poistamaton (luonnos tai kirjattu) myyntilasku samalla
 * (toisto, toistoPvm)-parilla on jo olemassa. Koska luonnos tallennetaan ennen toistoa, kaatuminen
 * välissä korjautuu seuraavassa ajossa. Poistettua luonnosta ei luoda uudelleen, koska `seuraava`
 * on jo siirtynyt sen ohi.
 *
 * Koko ajo ohitetaan, jos erääntyneitä on mutta tälle päivälle ei ole tilikautta (EITILIKAUTTA) tai
 * päivä on lukitussa kaudessa (LUKITTU) (laskunuusinta.cpp:57-64); ilman erääntyneitä ei ilmoiteta.
 */
export async function luoErantyneetToistot(
  storage: Storage,
  tanaan: IsoDate,
  env: ResourceEnv,
): Promise<ErantyneetToistot> {
  const erantyneet = (await storage.getToistot()).filter((t) => onErantynyt(t, tanaan));
  if (erantyneet.length === 0) return { luodut: [] };

  const [kaudet, asetukset] = await Promise.all([storage.getTilikaudet(), storage.getAsetukset()]);
  if (!tilikausiPaivalle(kaudet, tanaan)) return { luodut: [], ohitettu: 'EITILIKAUTTA' };
  const lukitusraja = (asetukset.TilitPaatetty as IsoDate | undefined) ?? null;
  if (lukitusraja !== null && tanaan <= lukitusraja) return { luodut: [], ohitettu: 'LUKITTU' };

  const [olemassa, tuoteLista] = await Promise.all([
    olemassaOlevat(storage),
    storage.getTuotteet(),
  ]);
  const tuotteet = new Map(tuoteLista.map((t) => [t.id, t]));

  const luodut: number[] = [];
  for (let toisto of erantyneet) {
    while (onErantynyt(toisto, tanaan)) {
      const k = avain(toisto.id, toisto.seuraava);
      if (!olemassa.has(k)) {
        const luonnos = await luoLuonnos(storage, toisto, tanaan, lukitusraja, tuotteet, env);
        olemassa.add(k);
        luodut.push(luonnos.id);
      }
      toisto = await storage.saveToisto(siirraAikataulua(toisto));
    }
  }
  return { luodut };
}

/**
 * Toiston luonnoksen kirjaus päivittää toiston pohjan kirjatusta laskusta (spec §5.2): otsikko,
 * maksutapa, rivit ja maksuaika (vain jos eräpäivää muutettiin: oikaistu eräpäivä ei kasvata
 * maksuaikaa). Aikataulua (`seuraava`, `pohja.jakso`) ei kosketa, koska
 * myöhempiä luonnoksia voi jo olla luotu. Poistettu toisto ohitetaan.
 */
export async function paivitaToistoKirjatusta(
  storage: Storage,
  kirjattu: StoredTosite,
): Promise<void> {
  if (kirjattu.toisto === undefined) return;
  const toisto = (await storage.getToistot()).find((t) => t.id === kirjattu.toisto);
  if (!toisto) return;
  const { otsikko: _otsikko, ...pohja } = toisto.pohja;
  const uusi = pohjaLaskusta(kirjattu, toisto.kuukausia);
  // Pankkipäivään oikaistu, käyttäjän muuttamatta jättämä eräpäivä ei saa kasvattaa maksuaikaa:
  // vanha maksuaika säilyy, jos se tuottaa saman eräpäivän.
  const vanhaErapvm = oikaiseErapaiva(
    lisaaPaivia(kirjattu.laskupvm ?? kirjattu.pvm, pohja.maksuaikaPaivia),
  );
  const maksuaikaPaivia =
    kirjattu.erapvm === vanhaErapvm ? pohja.maksuaikaPaivia : uusi.maksuaikaPaivia;
  await storage.saveToisto({
    ...toisto,
    pohja: {
      ...pohja,
      ...(uusi.otsikko !== undefined ? { otsikko: uusi.otsikko } : {}),
      maksutapa: uusi.maksutapa,
      rivit: uusi.rivit,
      maksuaikaPaivia,
    },
  });
}
