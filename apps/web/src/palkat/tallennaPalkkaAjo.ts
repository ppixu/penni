import { laskeSha } from '@/liitteet/laskeSha';
import { palkkalaskelmat, palkkatietoilmoitus } from '@/palkat/palkkaAjonTiedostot';
import type { KpClient } from '@penni/asiakas';
import {
  type Asetukset,
  type PalkkaAjo,
  type StoredTosite,
  TositeTila,
  TositeTyyppi,
  type TositeVienti,
} from '@penni/engine';
import { muotoileEuro } from '@penni/euro';
import { aikaleima, deliveryId, palkkaViennit, sha256Hex } from '@penni/palkat';
import {
  type PalkkaAjoLuonnos,
  PalkkaAjoVirhe,
  edeltavatAjot,
  haePalkkaAjot,
  laskeAjoTiedoista,
  luePalkkatiedot,
  palkkaAjonOtsikko,
  vaadiPalkkatilit,
} from './palkkaAjoTiedot';

export type { PalkkaAjoLuonnos } from './palkkaAjoTiedot';

/**
 * Palkka-ajon elinkaari (spec "Lifecycle and status"): Tallenna kirjaa Palkka-tositteen ja antaa
 * OmaVero-veloille (ennakonpidätys + sava, 2920) erän = tositteen id; Muokkaa päivittää saman
 * tositteen; Merkitse lähetetyksi tallentaa ilmoituksen tunnisteen ja tiivisteen sekä liittää
 * palkkalaskelmat, minkä jälkeen ajo on vain luku. Palkkatietoilmoituksen XML:ää ei tallenneta.
 */

const nykyhetki = () => new Date().toISOString();

/** Paikallinen kalenteripäivä 'YYYY-MM-DD' aikaleimasta. */
function paivaksi(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Palkkatositteen sarja kirjan tositesarjoista (`tositesarjat`, "500" → "P"; Kitsas-asetus). */
function palkkaSarja(asetukset: Asetukset): string {
  try {
    const sarjat = JSON.parse(asetukset.tositesarjat ?? '{}') as Record<string, unknown>;
    const s = sarjat[String(TositeTyyppi.PALKKA)];
    if (typeof s === 'string') return s;
  } catch {
    // viallinen asetus: oletus
  }
  return 'P';
}

/** Palkka-ajon tosite, jota saa muokata: kirjattu, palkka-ajo, ei merkitty lähetetyksi. */
async function haeMuokattava(client: KpClient, id: number): Promise<StoredTosite> {
  const t = await client.haeTosite(id);
  if (!t || !t.palkka || t.tyyppi !== TositeTyyppi.PALKKA || t.tila < TositeTila.KIRJANPIDOSSA) {
    throw new PalkkaAjoVirhe('EI_PALKKA_AJO', 'Palkka-ajoa ei löydy tai se on poistettu.');
  }
  if (t.palkka.ilmoitus) {
    throw new PalkkaAjoVirhe(
      'LAHETETTY',
      'Palkkatietoilmoitus on merkitty lähetetyksi, joten palkka-ajoa ei voi enää muuttaa Pennissä. Korjaukset tehdään Tulorekisterin asiointipalvelussa.',
    );
  }
  return t;
}

/** Laskee ajon kirjan nykyisistä tiedoista; edeltävät ajot verokortin tulokertymään. */
export async function laskeAjo(
  client: KpClient,
  l: PalkkaAjoLuonnos,
  olemassaOlevaId?: number,
  nyt: () => string = nykyhetki,
): Promise<PalkkaAjo> {
  const tiedot = luePalkkatiedot(await client.haeAsetukset());
  const ajot = await haePalkkaAjot(client);
  return laskeAjoTiedoista(l, tiedot, edeltavatAjot(ajot, l.maksupaiva, olemassaOlevaId), nyt());
}

/** Estää negatiivisen nettopalkan (palkkaViennit heittäisi myös) nimetyllä viestillä. */
function tarkistaNetot(ajo: PalkkaAjo): void {
  const negatiiviset = ajo.henkilot.filter((h) => h.tulos.nettopalkka < 0);
  if (negatiiviset.length > 0) {
    const kuvaus = negatiiviset
      .map((h) => `${h.nimi} ${muotoileEuro(h.tulos.nettopalkka)}`)
      .join(', ');
    throw new PalkkaAjoVirhe(
      'NEGATIIVINEN',
      `Nettopalkka on negatiivinen (${kuvaus}): eläke- ja työttömyysvakuutusmaksut ylittävät rahana maksettavan määrän. Lisää rahapalkkaa tai poista etu ennen tallennusta.`,
    );
  }
}

/**
 * Tallentaa uuden palkka-ajon (Palkka-tosite, tyyppi 500, kirjattu) tai päivittää olemassa olevan
 * saman id:n tositteen. OmaVero-erä = tositteen id kuten ostolaskuilla
 * (`ostolaskuResource.ts`: ensin tallennus, sitten erä id:llä).
 */
export async function tallennaPalkkaAjo(
  client: KpClient,
  l: PalkkaAjoLuonnos,
  olemassaOlevaId?: number,
  nyt: () => string = nykyhetki,
): Promise<StoredTosite> {
  const vanha = olemassaOlevaId !== undefined ? await haeMuokattava(client, olemassaOlevaId) : null;
  const asetukset = await client.haeAsetukset();
  const tiedot = luePalkkatiedot(asetukset);
  const tilit = vaadiPalkkatilit(tiedot);
  const ajot = await haePalkkaAjot(client);
  const ajo = laskeAjoTiedoista(
    l,
    tiedot,
    edeltavatAjot(ajot, l.maksupaiva, olemassaOlevaId),
    nyt(),
  );
  tarkistaNetot(ajo);

  const perus = {
    pvm: l.maksupaiva,
    tyyppi: TositeTyyppi.PALKKA,
    tila: TositeTila.KIRJANPIDOSSA,
    sarja: vanha?.sarja ?? palkkaSarja(asetukset),
    otsikko: palkkaAjonOtsikko(l.kausiAlkaa, l.kausiLoppuu),
    palkka: ajo,
  };
  const viennit = (eraId?: number): TositeVienti[] =>
    palkkaViennit(ajo.henkilot, tilit, l.maksupaiva, eraId);

  if (vanha) return client.paivitaTosite(vanha.id, { ...perus, viennit: viennit(vanha.id) });
  // Erä on tositteen id, joka tiedetään vasta ensimmäisen tallennuksen jälkeen.
  const luotu = await client.luoTosite({ ...perus, viennit: viennit() });
  try {
    return await client.paivitaTosite(luotu.id, { ...perus, viennit: viennit(luotu.id) });
  } catch (e) {
    // Tosite on jo kirjattu (ilman erää): uusi tallennus loisi kaksoiskappaleen. Ohjataan
    // korjaamaan sama ajo (Muokkaa tallentaa erän).
    const nro = `${luotu.sarja} ${luotu.tunniste}`.trim();
    const syy = e instanceof Error && e.message ? ` (${e.message})` : '';
    throw new PalkkaAjoVirhe(
      'KESKEN',
      `Palkka-ajo tallennettiin tositteeksi ${nro}, mutta OmaVero-erän merkintä epäonnistui${syy}. Älä tallenna lomaketta uudelleen: avaa palkanmaksu ja tallenna se Muokkaa-toiminnolla.`,
      luotu.id,
    );
  }
}

/** Ensimmäinen vapaa nimi: nimi.pdf, sitten nimi-2.pdf, -3, … (kuten laskun PDF). */
function vapaaNimi(nimi: string, olemassa: ReadonlySet<string>): string {
  if (!olemassa.has(nimi)) return nimi;
  const perus = nimi.replace(/\.pdf$/, '');
  for (let n = 2; ; n++) {
    if (!olemassa.has(`${perus}-${n}.pdf`)) return `${perus}-${n}.pdf`;
  }
}

/**
 * Merkitsee palkkatietoilmoituksen lähetetyksi: XML muodostetaan uudelleen samoista tiedoista
 * (deterministinen), sen SHA-256 ja DeliveryId tallennetaan tositteelle, ja palkkalaskelmat
 * liitetään tositteeseen vain-lisäävästi (sama sha jo liitteenä → ei uutta). Liitteet lisätään
 * ennen merkintää, jotta keskeytynyt merkintä voidaan toistaa.
 *
 * `ladattuSha` on käyttäjän lataaman XML:n SHA-256. Jos uudelleen muodostettu XML eroaa siitä
 * (rekisteriä tai asetuksia muutettu latauksen jälkeen), merkintä hylätään eikä mitään kirjoiteta:
 * tositteelle saa tallentua vain lähetetyn tiedoston tiiviste.
 */
export async function merkitseLahetetyksi(
  client: KpClient,
  tositeId: number,
  ladattuSha: string,
  nyt: () => string = nykyhetki,
): Promise<void> {
  const tosite = await haeMuokattava(client, tositeId);
  const palkka = structuredClone(tosite.palkka as PalkkaAjo);
  const { xml } = await palkkatietoilmoitus(client, tosite);
  const sha256 = await sha256Hex(xml);
  if (sha256 !== ladattuSha) {
    throw new PalkkaAjoVirhe(
      'XML_MUUTTUNUT',
      'Palkkatietoilmoitus on muuttunut lataamisen jälkeen (työntekijän tietoja tai palkka-asetuksia on muutettu). Lataa XML uudelleen, lataa se Tulorekisteriin ja merkitse sitten lähetetyksi.',
    );
  }

  const hetki = nyt();
  const olemassa = await client.haeLiitteet(tosite.id);
  const shat = new Set(olemassa.map((l) => l.sha));
  const nimet = new Set(olemassa.map((l) => l.nimi));
  for (const { nimi, pdf } of await palkkalaskelmat(client, tosite)) {
    const sha = await laskeSha(pdf);
    if (shat.has(sha)) continue;
    const vapaa = vapaaNimi(nimi, nimet);
    await client.lisaaLiite({
      tosite: tosite.id,
      nimi: vapaa,
      tyyppi: 'application/pdf',
      sha,
      luotu: hetki,
      data: pdf,
    });
    shat.add(sha);
    nimet.add(vapaa);
  }

  palkka.ilmoitus = {
    lahetetty: paivaksi(hetki),
    deliveryId: deliveryId(tosite.id, aikaleima(palkka.laskettu, 'Palkka-ajon tallennusaika')),
    sha256,
  };
  const { id: _id, tunniste: _tunniste, ...kentat } = tosite;
  await client.paivitaTosite(tosite.id, { ...kentat, palkka });
}
