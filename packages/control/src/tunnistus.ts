import type { ControlStore, IsoDateTime, Kayttaja } from './portti.js';
import { julkinen } from './portti.js';
import { hashaaSalasana, tarkistaSalasana } from './salasana.js';
import { luoToken, tiivistaToken } from './token.js';
import { TunnistusVirhe } from './virheet.js';

const OLETUS_KESTO_MS = 30 * 24 * 60 * 60 * 1000; // 30 vrk
const EMAIL_RE = /.+@.+\..+/;
const MIN_SALASANA = 8;

export interface TunnistusAsetukset {
  kello: () => IsoDateTime;
  sessionKestoMs?: number;
}
export interface TunnistusTulos {
  kayttaja: Kayttaja;
  token: string;
}

async function aloitaSessio(
  store: ControlStore,
  kayttajaId: number,
  a: TunnistusAsetukset,
): Promise<string> {
  const token = luoToken();
  const nyt = a.kello();
  const vanhenee = new Date(
    new Date(nyt).getTime() + (a.sessionKestoMs ?? OLETUS_KESTO_MS),
  ).toISOString();
  await store.luoSessio({
    tokenHash: tiivistaToken(token),
    kayttajaId,
    luotu: nyt,
    vanhenee,
    viimeksiKaytetty: nyt,
  });
  return token;
}

export async function rekisteroi(
  store: ControlStore,
  syote: { email: string; salasana: string; nimi?: string },
  a: TunnistusAsetukset,
): Promise<TunnistusTulos> {
  const email = syote.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new TunnistusVirhe('EPAKELPO_EMAIL');
  if (syote.salasana.length < MIN_SALASANA) throw new TunnistusVirhe('HEIKKO_SALASANA');
  const salasanaHash = await hashaaSalasana(syote.salasana);
  const kayttaja = await store.luoKayttaja({
    email,
    salasanaHash,
    aika: a.kello(),
    ...(syote.nimi !== undefined ? { nimi: syote.nimi } : {}),
  });
  const token = await aloitaSessio(store, kayttaja.id, a);
  return { kayttaja, token };
}

export async function kirjaudu(
  store: ControlStore,
  syote: { email: string; salasana: string },
  a: TunnistusAsetukset,
): Promise<TunnistusTulos> {
  const tiedot = await store.haeKayttajaEmaililla(syote.email.trim());
  if (!tiedot || !(await tarkistaSalasana(syote.salasana, tiedot.salasanaHash))) {
    throw new TunnistusVirhe('VAARA_TUNNUS');
  }
  const token = await aloitaSessio(store, tiedot.id, a);
  return { kayttaja: julkinen(tiedot), token };
}

export async function haeMinut(
  store: ControlStore,
  token: string,
  a: TunnistusAsetukset,
): Promise<Kayttaja> {
  const sessio = await store.haeSessio(tiivistaToken(token));
  if (!sessio || sessio.vanhenee <= a.kello()) throw new TunnistusVirhe('EI_SESSIOTA');
  const tiedot = await store.haeKayttajaTiedot(sessio.kayttajaId);
  if (!tiedot) throw new TunnistusVirhe('EI_SESSIOTA');
  return julkinen(tiedot);
}

export async function kirjauduUlos(store: ControlStore, token: string): Promise<void> {
  await store.poistaSessio(tiivistaToken(token)); // idempotentti
}

export async function vaihdaSalasana(
  store: ControlStore,
  kayttajaId: number,
  syote: { vanhaSalasana: string; uusiSalasana: string },
  _a: TunnistusAsetukset,
): Promise<void> {
  const tiedot = await store.haeKayttajaTiedot(kayttajaId);
  if (!tiedot || !(await tarkistaSalasana(syote.vanhaSalasana, tiedot.salasanaHash))) {
    throw new TunnistusVirhe('VAARA_TUNNUS');
  }
  if (syote.uusiSalasana.length < MIN_SALASANA) throw new TunnistusVirhe('HEIKKO_SALASANA');
  await store.paivitaSalasana(kayttajaId, await hashaaSalasana(syote.uusiSalasana));
}
