import type { Cents } from '@penni/euro';
import { Maksutapa, TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import { nettoYhteensaCents } from '../vouchers/rivi.js';
import type { TositeRivi } from '../vouchers/types.js';
import { ResourceError, type Storage, type StoredTosite } from './storage.js';

/** Asiakkaan ennakkolaskun avoin (vielä loppulaskulla hyvittämätön) netto yhdellä verokannalla. */
export interface AvoinEnnakko {
  tosite: number; // ennakkolaskun tosite-id (= vähennysrivin `ennakkoTosite`)
  numero?: string;
  alvProsentti: number;
  netto: Cents; // ennakkolaskun rivien netto tällä kannalla
  avoin: Cents; // netto − loppulaskujen vähennykset
}

const avain = (tosite: number, alvProsentti: number) => `${tosite}/${alvProsentti}`;

/**
 * Tuotu Kitsas-ennakko: Kitsas avaa 2861-riville toisen erän (rivivientigeneroija.cpp:220-223),
 * joten tositteella on useampi erällinen vienti. Sen avointa ei voi johtaa luotettavasti (spec §6.1).
 */
function onTuotuEnnakko(t: StoredTosite): boolean {
  return t.viennit.filter((v) => v.era != null).length > 1;
}

/**
 * Asiakkaan avoimet ennakot "Hyvitä ennakko" -valintaan (spec §6.1). Pennin ennakkolasku ei avaa
 * toista erää, vaan avoin johdetaan: kirjatun ennakkolaskun rivien netto kannoittain miinus
 * kirjattujen laskujen vähennysrivit (`ennakkoTosite` = ennakon id, netto negatiivinen). Hyvitetyn
 * (hyvityslasku 214) loppulaskun vähennykset eivät kuluta ennakkoa. Vain `avoin > 0` palautetaan;
 * tuodut Kitsas-ennakot jätetään pois.
 */
export async function haeAvoimetEnnakot(
  storage: Storage,
  kumppani: number,
): Promise<AvoinEnnakko[]> {
  const [laskut, hyvitykset] = await Promise.all([
    storage.listTositteet({ bucket: 'kirjanpidossa', tyyppi: TositeTyyppi.MYYNTILASKU }),
    storage.listTositteet({ bucket: 'kirjanpidossa', tyyppi: TositeTyyppi.HYVITYSLASKU }),
  ]);
  const hyvitetyt = new Set(hyvitykset.map((h) => h.alkuperainenTosite));

  const vahennetty = new Map<string, number>();
  for (const t of laskut) {
    if (t.maksutapa === Maksutapa.ENNAKKOLASKU || hyvitetyt.has(t.id)) continue;
    for (const r of t.rivit ?? []) {
      if (r.ennakkoTosite == null) continue;
      const k = avain(r.ennakkoTosite, r.alvProsentti);
      vahennetty.set(k, (vahennetty.get(k) ?? 0) - nettoYhteensaCents(r));
    }
  }

  const tulos: AvoinEnnakko[] = [];
  for (const t of laskut) {
    if (t.maksutapa !== Maksutapa.ENNAKKOLASKU || t.kumppani !== kumppani) continue;
    if (onTuotuEnnakko(t)) continue;
    const kannoittain = new Map<number, number>();
    for (const r of t.rivit ?? [])
      kannoittain.set(
        r.alvProsentti,
        (kannoittain.get(r.alvProsentti) ?? 0) + nettoYhteensaCents(r),
      );
    for (const [alvProsentti, netto] of kannoittain) {
      const avoin = netto - (vahennetty.get(avain(t.id, alvProsentti)) ?? 0);
      if (avoin <= 0) continue;
      tulos.push({
        tosite: t.id,
        ...(t.numero !== undefined ? { numero: t.numero } : {}),
        alvProsentti,
        netto: netto as Cents,
        avoin: avoin as Cents,
      });
    }
  }
  tulos.sort((a, b) => a.tosite - b.tosite || a.alvProsentti - b.alvProsentti);
  return tulos;
}

/**
 * Loppulaskun ennakon vähennysrivien tarkistus kirjattaessa (spec §6.1), ennen laskunumeron
 * lukemista. Jokaisen `ennakkoTosite`-rivin on viitattava kirjattuun, poistamattomaan
 * ennakkolaskuun samalta asiakkaalta, eikä yhden ennakon (kannoittain) vähennysten summa tällä
 * laskulla saa ylittää ennakon avointa nettoa. Tuotu Kitsas-ennakko ei ole avoimissa, joten sitä
 * ei voi vähentää. Rikkomus -> `EIENNAKKOA`.
 */
export async function tarkistaEnnakonVahennykset(
  storage: Storage,
  kumppani: number | undefined,
  rivit: readonly TositeRivi[],
): Promise<void> {
  const vahennysrivit = rivit.filter((r) => r.ennakkoTosite != null);
  if (vahennysrivit.length === 0) return;

  const vahennetty = new Map<string, { tosite: number; alvProsentti: number; summa: number }>();
  for (const r of vahennysrivit) {
    const id = r.ennakkoTosite as number;
    const e = await storage.getTosite(id);
    if (e === null || e.tila === TositeTila.POISTETTU)
      throw new ResourceError('EIENNAKKOA', `Ennakkolaskua ${id} ei löydy`);
    const nimi = e.numero !== undefined ? `Lasku ${e.numero}` : `Tosite ${id}`;
    if (e.tyyppi !== TositeTyyppi.MYYNTILASKU || e.maksutapa !== Maksutapa.ENNAKKOLASKU)
      throw new ResourceError('EIENNAKKOA', `${nimi} ei ole ennakkolasku`);
    if (e.tila < TositeTila.KIRJANPIDOSSA)
      throw new ResourceError('EIENNAKKOA', `${nimi} ei ole kirjattu`);
    if (kumppani === undefined || e.kumppani !== kumppani)
      throw new ResourceError('EIENNAKKOA', `${nimi} on toisen asiakkaan ennakko`);
    const netto = nettoYhteensaCents(r);
    if (netto >= 0)
      throw new ResourceError('EIENNAKKOA', `${nimi}: vähennysrivin summan on oltava negatiivinen`);
    const k = avain(id, r.alvProsentti);
    const tama = vahennetty.get(k) ?? { tosite: id, alvProsentti: r.alvProsentti, summa: 0 };
    tama.summa -= netto;
    vahennetty.set(k, tama);
  }

  const avoimet = new Map(
    (await haeAvoimetEnnakot(storage, kumppani as number)).map((a) => [
      avain(a.tosite, a.alvProsentti),
      a,
    ]),
  );
  for (const [k, v] of vahennetty) {
    const avoin = avoimet.get(k)?.avoin ?? 0;
    if (v.summa > avoin) {
      const e = await storage.getTosite(v.tosite);
      const nimi = e?.numero !== undefined ? `Lasku ${e.numero}` : `Tosite ${v.tosite}`;
      throw new ResourceError(
        'EIENNAKKOA',
        `${nimi}: ennakkoa on avoinna vain ${(avoin / 100).toFixed(2).replace('.', ',')} € (alv ${v.alvProsentti} %), vähennys on ${(v.summa / 100).toFixed(2).replace('.', ',')} €`,
      );
    }
  }
}
