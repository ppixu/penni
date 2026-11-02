import type { Cents } from '@penni/euro';
import { Maksutapa, TositeTyyppi } from '../vouchers/enums.js';
import { nettoYhteensaCents } from '../vouchers/rivi.js';
import type { Storage, StoredTosite } from './storage.js';

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
