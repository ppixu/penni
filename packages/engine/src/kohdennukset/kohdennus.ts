import type { Monikielinen } from '../accounts/tili.js';
import { ResourceError } from '../resources/storage.js';
import { type IsoDate, onkoPvmValidi } from '../vouchers/types.js';

/**
 * Kohdennuksen tyyppi (Kitsas db/kohdennus.h:36-42). Kitsaksen tyyppi 0 = Yleinen ei ole
 * tallennettu rivi Pennissä: se on implisiittinen id 0 ("ei kohdennettu").
 */
export const KohdennusTyyppi = { KUSTANNUSPAIKKA: 1, PROJEKTI: 2, MERKKAUS: 3 } as const;
export type KohdennusTyyppiArvo = 1 | 2 | 3;

/** Implisiittinen "Yleinen"-kohdennus: kohdentamattomat viennit. Ei koskaan tallennettu. */
export const YLEINEN_ID = 0;

/** Kustannuspaikka, projekti tai merkkaus. Tallennetut id:t ≥ 1. */
export interface Kohdennus {
  id: number;
  tyyppi: KohdennusTyyppiArvo;
  /** Vain projekteilla: kustannuspaikan id; puuttuu = Yleisen alla. */
  kuuluu?: number;
  nimi: Monikielinen;
  alkaa?: IsoDate; // voimassaolon alku (mukaan lukien); puuttuu = avoin
  paattyy?: IsoDate; // voimassaolon loppu (mukaan lukien); puuttuu = avoin
  [avain: string]: unknown; // Kitsaksen muut json-avaimet kulkevat sellaisinaan
}

/**
 * Uusi/päivitettävä kohdennus; id annettu => päivitys (tai tuonnissa säilytettävä id).
 * Kirjoitettu auki kuten UusiKumppani: Omit<Kohdennus,'id'> pudottaisi nimetyt kentät
 * indeksisignatuurin takia.
 */
export interface UusiKohdennus {
  id?: number;
  tyyppi: KohdennusTyyppiArvo;
  kuuluu?: number;
  nimi: Monikielinen;
  alkaa?: IsoDate;
  paattyy?: IsoDate;
  [avain: string]: unknown;
}

/** Kohdennus ja sen käyttömäärä (viennit kohdennuksena + merkkausrivit). */
export interface KohdennusKaytolla extends Kohdennus {
  lkm: number;
}

/** Nimi pyydetyllä kielellä, muuten suomeksi, muuten tyhjä. */
export function kohdennuksenNimi(k: Kohdennus, kieli?: string): string {
  return (kieli !== undefined ? k.nimi[kieli] : undefined) ?? k.nimi.fi ?? '';
}

function kustannuspaikka(
  kaikki: readonly Kohdennus[],
  id: number | undefined,
): Kohdennus | undefined {
  if (id === undefined) return undefined;
  return kaikki.find((x) => x.id === id && x.tyyppi === KohdennusTyyppi.KUSTANNUSPAIKKA);
}

/** Näyttöpolku "Kustannuspaikka/Projekti" (Kitsas db/kohdennusmodel.cpp:96-101). Yleisen tai
 *  tuntemattoman vanhemman alla oleva projekti, kustannuspaikka ja merkkaus: pelkkä nimi. */
export function kohdennuksenPolku(k: Kohdennus, kaikki: readonly Kohdennus[]): string {
  const nimi = kohdennuksenNimi(k);
  if (k.tyyppi !== KohdennusTyyppi.PROJEKTI) return nimi;
  const vanhempi = kustannuspaikka(kaikki, k.kuuluu);
  return vanhempi ? `${kohdennuksenNimi(vanhempi)}/${nimi}` : nimi;
}

/** Voimassa päivänä: alkaa ≤ pvm ≤ paattyy, kumpikin raja valinnainen
 *  (kirjaus/kohdennusproxymodel.cpp:68-103). */
export function onVoimassa(k: Kohdennus, pvm: IsoDate): boolean {
  return (!k.alkaa || k.alkaa <= pvm) && (!k.paattyy || pvm <= k.paattyy);
}

/** Voimassa välillä: voimassaolo ja [alku, loppu] menevät päällekkäin (yksikin yhteinen päivä). */
export function onVoimassaValilla(k: Kohdennus, alku: IsoDate, loppu: IsoDate): boolean {
  return (!k.alkaa || k.alkaa <= loppu) && (!k.paattyy || k.paattyy >= alku);
}

/** Merkkauslistan kanoninen muoto: nouseva, uniikki, vain positiiviset kokonaisluvut;
 *  tyhjä => undefined (avain jätetään pois). */
export function normalisoiMerkkaukset(m?: readonly number[]): number[] | undefined {
  if (!m) return undefined;
  const out = [...new Set(m.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  return out.length > 0 ? out : undefined;
}

/** Tallennettavan kohdennuksen siistiminen: nimi.fi trimmataan, kuuluu vain projekteille
 *  (Kitsas db/kohdennus.cpp:67-72), kuuluu 0 => puuttuu, tyhjä päivämäärä => puuttuu. Johdettu
 *  käyttömäärä `lkm` (KohdennusKaytolla) ei kuulu tallennettuun: käyttöliittymä tallentaa
 *  muokatun KohdennusKaytolla-olion, joten se pudotetaan. */
export function normalisoiKohdennus(k: UusiKohdennus): UusiKohdennus {
  const { kuuluu, alkaa, paattyy, lkm: _lkm, ...muut } = k;
  const out: UusiKohdennus = { ...muut, nimi: { ...k.nimi } };
  if (typeof out.nimi.fi === 'string') out.nimi.fi = out.nimi.fi.trim();
  if (k.tyyppi === KohdennusTyyppi.PROJEKTI && kuuluu) out.kuuluu = kuuluu;
  if (alkaa) out.alkaa = alkaa;
  if (paattyy) out.paattyy = paattyy;
  return out;
}

/** Kohdennuksen tallennussäännöt; heittää ResourceErrorin. `kaikki` = tallennetut kohdennukset. */
export function validoiKohdennus(k: UusiKohdennus, kaikki: readonly Kohdennus[]): void {
  if (k.id !== undefined && !(Number.isInteger(k.id) && k.id >= 1))
    throw new ResourceError('KOHDENNUSID', `Virheellinen kohdennuksen id ${String(k.id)}`);
  const nimi = k.nimi?.fi;
  if (typeof nimi !== 'string' || nimi.trim() === '')
    throw new ResourceError('KOHDENNUSNIMI', 'Kohdennukselle on annettava nimi');
  if (
    k.tyyppi !== KohdennusTyyppi.KUSTANNUSPAIKKA &&
    k.tyyppi !== KohdennusTyyppi.PROJEKTI &&
    k.tyyppi !== KohdennusTyyppi.MERKKAUS
  )
    throw new ResourceError(
      'KOHDENNUSTYYPPI',
      `Tuntematon kohdennuksen tyyppi ${String(k.tyyppi)}`,
    );
  if (
    k.id !== undefined &&
    k.tyyppi !== KohdennusTyyppi.KUSTANNUSPAIKKA &&
    kustannuspaikka(kaikki, k.id) &&
    kaikki.some((x) => x.tyyppi === KohdennusTyyppi.PROJEKTI && x.kuuluu === k.id)
  )
    throw new ResourceError(
      'KOHDENNUSTYYPPI',
      'Kustannuspaikalla on projekteja, eikä sen tyyppiä voi vaihtaa',
    );
  for (const pvm of [k.alkaa, k.paattyy])
    if (pvm !== undefined && !onkoPvmValidi(pvm))
      throw new ResourceError('KOHDENNUSPVM', `Virheellinen päivämäärä ${pvm}`);
  if (k.alkaa && k.paattyy && k.paattyy < k.alkaa)
    throw new ResourceError('KOHDENNUSPVM', 'Päättymispäivä ei voi olla ennen alkamispäivää');
  if (
    k.tyyppi === KohdennusTyyppi.PROJEKTI &&
    k.kuuluu &&
    (k.kuuluu === k.id || !kustannuspaikka(kaikki, k.kuuluu))
  )
    throw new ResourceError(
      'KOHDENNUSKUULUU',
      'Projektin on kuuluttava kustannuspaikkaan tai Yleiseen',
    );
}

/**
 * Raporttisuodatin kohdennukselle (Kitsas sqlite/routes/saldotroute.cpp:111-147) SaldoQueryn
 * kenttinä: kustannuspaikka => se ja sen projektit; Yleinen 0 => kohdentamattomat ja Yleisen
 * (tai tuntemattoman kustannuspaikan) alla olevat projektit; projekti ja tuntematon id => vain se;
 * merkkaus => merkatut viennit.
 */
export function kohdennusSuodatin(
  kaikki: readonly Kohdennus[],
  id: number,
): { kohdennukset?: number[]; merkkaus?: number } {
  const projektit = kaikki.filter((x) => x.tyyppi === KohdennusTyyppi.PROJEKTI);
  const jarjesta = (ids: number[]) => ids.sort((a, b) => a - b);
  if (id === YLEINEN_ID) {
    const alla = projektit.filter((p) => !kustannuspaikka(kaikki, p.kuuluu)).map((p) => p.id);
    return { kohdennukset: jarjesta([YLEINEN_ID, ...alla]) };
  }
  const k = kaikki.find((x) => x.id === id);
  if (k?.tyyppi === KohdennusTyyppi.MERKKAUS) return { merkkaus: id };
  if (k?.tyyppi === KohdennusTyyppi.KUSTANNUSPAIKKA) {
    const alla = projektit.filter((p) => p.kuuluu === id).map((p) => p.id);
    return { kohdennukset: jarjesta([id, ...alla]) };
  }
  return { kohdennukset: [id] };
}
