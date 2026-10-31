import { tositteenAlkupera } from '../alv/alkupera.js';
import type { LiiteMeta, UusiLiite } from '../liitteet/liite.js';
import { etsiKumppaniNimella } from '../partners/kumppaninTunnistus.js';
import { tarkasta, voiValmistua } from '../validation/tarkasta.js';
import { TositeTila, onKirjanpidossa } from '../vouchers/enums.js';
import type { IsoDate, Tosite, TositeVienti } from '../vouchers/types.js';
import { rakennaValidointiKonteksti } from './context.js';
import { pitaakoNumeroUusiksi, tilikausiPaivalle } from './numbering.js';
import {
  type ListattuTosite,
  type ResourceEnv,
  ResourceError,
  type Storage,
  type StoredTosite,
  type TositeFilter,
} from './storage.js';

/** Kauden lukituksen rajapäivä (TilitPaatetty) tai null (mirroring context.ts). */
async function haeLukitusraja(storage: Storage): Promise<IsoDate | null> {
  const asetukset = await storage.getAsetukset();
  return (asetukset.TilitPaatetty as IsoDate | undefined) ?? null;
}

/**
 * Estä KIRJATUN (tila >= 100) tositteen poisto/demotointi/uudelleenpäiväys, jos sen
 * TALLENNETTU päivä TAI jokin sen tallennettu vienti osuu lukittuun kauteen
 * (pvm <= TilitPaatetty). Vientipäivä on kirjanpidon (saldot/raportit) tosiasiallinen
 * peruste, ja tarkasta lippaa PVMLUKITTU:n vientikohtaisesti — joten pelkkä tositepäivä
 * jättäisi aukon (kausirajan yli kirjattu tosite). Suora päivävertailu, EI tarkasta-ajoa.
 * Luonnokset (tila < 100) eivät ole kirjoilla, joten niitä ei suojata.
 */
function tarkistaEiLukittu(vanha: StoredTosite | null, lukitusraja: IsoDate | null): void {
  if (vanha === null || !onKirjanpidossa(vanha.tila) || lukitusraja === null) return;
  const osuuLukkoon = vanha.pvm <= lukitusraja || vanha.viennit.some((v) => v.pvm <= lukitusraja);
  if (osuuLukkoon) {
    throw new ResourceError('PVMLUKITTU', 'Tosite osuu lukittuun tilikauteen');
  }
}

export async function haeTosite(storage: Storage, id: number): Promise<StoredTosite | null> {
  return storage.getTosite(id);
}

/**
 * Tositelista + liitemäärä ja alkuperä (kotimaa/EU/muu) per tosite. Kiinteä määrä kyselyitä
 * listan koosta riippumatta: liitteet yhdellä COUNT-kyselyllä, kumppanit kerralla.
 */
export async function listaaTositteet(
  storage: Storage,
  filter: TositeFilter,
): Promise<ListattuTosite[]> {
  const [tositteet, liitteita, kumppanit] = await Promise.all([
    storage.listTositteet(filter),
    storage.laskeLiitteet(),
    storage.getKumppanit(),
  ]);
  const maat = new Map(kumppanit.map((k) => [k.id, k.maa]));
  return tositteet.map((t) => {
    const alkupera = tositteenAlkupera(
      t.viennit,
      t.kumppani !== undefined ? maat.get(t.kumppani) : undefined,
    );
    return { ...t, liitteita: liitteita.get(t.id) ?? 0, ...(alkupera ? { alkupera } : {}) };
  });
}

export type TositeSyote = Omit<Tosite, 'tila' | 'tunniste'> & {
  id?: number;
  tila?: number;
  tunniste?: number;
};

export async function tallennaTosite(
  storage: Storage,
  syote: TositeSyote,
  env: ResourceEnv,
): Promise<StoredTosite> {
  const tila = syote.tila ?? TositeTila.KIRJANPIDOSSA;
  const sarja = syote.sarja ?? '';
  const kaudet = await storage.getTilikaudet();
  const vanha = syote.id !== undefined ? await storage.getTosite(syote.id) : null;
  tarkistaEiLukittu(vanha, await haeLukitusraja(storage));

  // Numbering policy (unifies tositeroute.cpp:212-234).
  // Päivitys ilman tunnistetta säilyttää tallennetun numeron — muuten numerointiin jäisi aukko.
  let tunniste = syote.tunniste ?? vanha?.tunniste ?? 0;
  if (syote.id !== undefined && tunniste) {
    if (
      !vanha ||
      pitaakoNumeroUusiksi({
        vanhaPvm: vanha.pvm,
        vanhaSarja: vanha.sarja,
        uusiPvm: syote.pvm,
        uusiSarja: sarja,
        kaudet,
      })
    ) {
      tunniste = 0;
    }
  }
  if (!onKirjanpidossa(tila)) tunniste = 0;
  if (!tunniste && onKirjanpidossa(tila)) {
    const kausi = tilikausiPaivalle(kaudet, syote.pvm);
    if (!kausi)
      throw new ResourceError('EITILIKAUTTA', `Päivälle ${syote.pvm} ei ole avointa tilikautta`);
    tunniste =
      (await storage.maxTunniste(kausi.alkaa, kausi.loppuu, sarja === '' ? null : sarja)) + 1;
  }

  // Listan johdetut kentät (ListattuTosite: liitemäärä, alkuperä) eivät kuulu tositteeseen — pudota, jos listattu
  // rivi tallennetaan sellaisenaan takaisin (InProcessClient välittää olion koskemattomana).
  const {
    liitteita: _liitteita,
    alkupera: _alkupera,
    ...tositeKentat
  } = syote as TositeSyote & { liitteita?: unknown; alkupera?: unknown };
  const voucher: Tosite & { id?: number } = { ...tositeKentat, tila, tunniste, sarja };
  // Kumppaniton tosite (tiliote, kuitti, ruudukko) liitetään samannimiseen kumppaniin, jotta
  // kumppanin tositteet löytyvät myös Pennissä luoduista. Annettu kumppani säilyy aina.
  if (voucher.kumppani === undefined && voucher.otsikko) {
    const kumppani = etsiKumppaniNimella(voucher.otsikko, await storage.getKumppanit());
    if (kumppani) voucher.kumppani = kumppani.id;
  }

  // Validation gate.
  const ctx = await rakennaValidointiKonteksti(storage, env);
  const rikkeet = tarkasta(voucher, ctx);
  if (rikkeet.some((r) => r.code === 'PVMLUKITTU')) {
    throw new ResourceError('PVMLUKITTU', 'Tosite osuu lukittuun tilikauteen');
  }
  if (onKirjanpidossa(tila) && !voiValmistua(rikkeet)) {
    const estavat = rikkeet.filter((r) => r.severity === 'block').map((r) => r.code);
    throw new ResourceError('EIVALMISTU', `Tositetta ei voi kirjata: ${estavat.join(', ')}`);
  }

  return storage.saveTosite(voucher, {
    aika: env.aika,
    ...(env.userId !== undefined ? { userId: env.userId } : {}),
    ...(env.lahde !== undefined ? { lahde: env.lahde } : {}),
  });
}

export async function muutaTositteenTila(
  storage: Storage,
  id: number,
  tila: number,
  env: ResourceEnv,
): Promise<StoredTosite> {
  const vanha = await storage.getTosite(id);
  if (!vanha) throw new ResourceError('EITOSITETTA', `Tositetta ${id} ei ole`);
  tarkistaEiLukittu(vanha, await haeLukitusraja(storage));

  let tunniste = vanha.tunniste;
  if (!tunniste && onKirjanpidossa(tila)) {
    const kaudet = await storage.getTilikaudet();
    const kausi = tilikausiPaivalle(kaudet, vanha.pvm);
    if (!kausi)
      throw new ResourceError('EITILIKAUTTA', `Päivälle ${vanha.pvm} ei ole avointa tilikautta`);
    tunniste =
      (await storage.maxTunniste(
        kausi.alkaa,
        kausi.loppuu,
        vanha.sarja === '' ? null : vanha.sarja,
      )) + 1;
  }

  // Re-validate against the stored voucher before finalizing.
  if (onKirjanpidossa(tila)) {
    const ctx = await rakennaValidointiKonteksti(storage, env);
    const rikkeet = tarkasta({ ...vanha, tila }, ctx);
    if (rikkeet.some((r) => r.code === 'PVMLUKITTU'))
      throw new ResourceError('PVMLUKITTU', 'Tosite osuu lukittuun tilikauteen');
    if (!voiValmistua(rikkeet)) {
      const estavat = rikkeet.filter((r) => r.severity === 'block').map((r) => r.code);
      throw new ResourceError('EIVALMISTU', `Tositetta ei voi kirjata: ${estavat.join(', ')}`);
    }
  }

  const audit = {
    aika: env.aika,
    ...(env.userId !== undefined ? { userId: env.userId } : {}),
    ...(env.lahde !== undefined ? { lahde: env.lahde } : {}),
  };
  return storage.patchTositeTila(id, tila, tunniste, audit, { tila });
}

export async function poistaTosite(storage: Storage, id: number, env: ResourceEnv): Promise<void> {
  const vanha = await storage.getTosite(id);
  if (!vanha) throw new ResourceError('EITOSITETTA', `Tositetta ${id} ei ole`);
  tarkistaEiLukittu(vanha, await haeLukitusraja(storage));
  const audit = {
    aika: env.aika,
    ...(env.userId !== undefined ? { userId: env.userId } : {}),
    ...(env.lahde !== undefined ? { lahde: env.lahde } : {}),
  };
  await storage.softDeleteTosite(id, audit);
}

/**
 * Liittää uuden liitteen (kuitti, lasku) tositteelle kirjattuna muutoksena — agenttirajapinnan
 * (CLI) polku. Sovelluksen oma liitelataus käyttää suoraa tallennaLiite-kutsua; tämä lisää sen
 * päälle kaksi sääntöä:
 *
 * - Liitteen saa vain LUONNOKSELLE (tila 50) tai kirjatulle (tila >= 100) tositteelle, ja
 *   kirjatulle vain, jos se ei osu lukittuun kauteen (sama sääntö kuin poistossa/muokkauksessa:
 *   tositepäivä tai jokin vientipäivä <= TilitPaatetty -> PVMLUKITTU). Tositteen todisteen
 *   lisääminen ei muuta kirjanpitoa, mutta suljetun kauden aineisto on lopullinen.
 * - Lisäys kirjataan tositteen lokiin (Tositeloki) env.lahde-tiedolla: tositteen tila ja numero
 *   pysyvät ennallaan, ja lokirivin data on `{ liite: { id, nimi, tyyppi, sha } }` (vrt.
 *   muutaTositteenTila, jonka lokirivin data on `{ tila }`).
 *
 * Aina uusi liite: syötteen id ja roolinimi ohitetaan, jottei agentti voi korvata olemassa
 * olevaa liitettä.
 */
export async function lisaaLiite(
  storage: Storage,
  liite: UusiLiite,
  env: ResourceEnv,
): Promise<LiiteMeta> {
  const tosite = await storage.getTosite(liite.tosite);
  if (!tosite) throw new ResourceError('EITOSITETTA', `Tositetta ${liite.tosite} ei ole`);
  if (tosite.tila !== TositeTila.LUONNOS && !onKirjanpidossa(tosite.tila)) {
    throw new ResourceError(
      'LIITE_EI_SALLITTU',
      `Liitteen voi lisätä vain luonnokselle tai kirjatulle tositteelle (tositteen ${tosite.id} tila on ${tosite.tila})`,
    );
  }
  tarkistaEiLukittu(tosite, await haeLukitusraja(storage));

  const { id: _id, roolinimi: _rooli, ...uusi } = liite;
  const meta = await storage.saveLiite(uusi);
  const audit = {
    aika: env.aika,
    ...(env.userId !== undefined ? { userId: env.userId } : {}),
    ...(env.lahde !== undefined ? { lahde: env.lahde } : {}),
  };
  await storage.patchTositeTila(tosite.id, tosite.tila, tosite.tunniste, audit, {
    liite: { id: meta.id, nimi: meta.nimi, tyyppi: meta.tyyppi, sha: meta.sha ?? null },
  });
  return meta;
}

export async function listaaViennit(
  storage: Storage,
  filter: { alkupvm?: IsoDate; loppupvm?: IsoDate; tili?: number },
): Promise<TositeVienti[]> {
  return storage.listViennit(filter);
}
