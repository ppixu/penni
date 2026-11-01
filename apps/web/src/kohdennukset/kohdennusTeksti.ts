import {
  type Kohdennus,
  KohdennusTyyppi,
  YLEINEN_ID,
  kohdennuksenNimi,
  kohdennuksenPolku,
} from '@penni/engine';
import { muotoilePvm } from '@penni/euro';

/**
 * Kohdennussolun teksti: kohdennuksen polku, sitten merkkaukset pisteellä erotettuna, esim.
 * "Nuorisotoiminta/Kesäleiri · Avustus". Tallentamaton id näytetään muodossa "Tuntematon (n)".
 * Kohdentamaton (puuttuu tai 0) ja merkkaukseton rivi => tyhjä.
 */
export function kohdennusSolunTeksti(
  kohdennus: number | undefined,
  merkkaukset: readonly number[] | undefined,
  kaikki: readonly Kohdennus[],
): string {
  const nimi = (id: number): string => {
    const k = kaikki.find((x) => x.id === id);
    return k ? kohdennuksenPolku(k, kaikki) : `Tuntematon (${id})`;
  };
  const osat: string[] = [];
  if (kohdennus !== undefined && kohdennus !== YLEINEN_ID) osat.push(nimi(kohdennus));
  for (const m of merkkaukset ?? []) osat.push(nimi(m));
  return osat.join(' · ');
}

/** "Voimassa 1.1.2026–31.12.2026"; avoin loppu "… alkaen", avoin alku "… asti"; ei rajoja => tyhjä. */
export function voimassaTeksti(k: { alkaa?: string; paattyy?: string }): string {
  if (k.alkaa && k.paattyy) return `Voimassa ${muotoilePvm(k.alkaa)}–${muotoilePvm(k.paattyy)}`;
  if (k.alkaa) return `Voimassa ${muotoilePvm(k.alkaa)} alkaen`;
  if (k.paattyy) return `Voimassa ${muotoilePvm(k.paattyy)} asti`;
  return '';
}

const TYYPIN_NIMET: Record<number, string> = {
  [KohdennusTyyppi.KUSTANNUSPAIKKA]: 'Kustannuspaikka',
  [KohdennusTyyppi.PROJEKTI]: 'Projekti',
  [KohdennusTyyppi.MERKKAUS]: 'Merkkaus',
};

export function kohdennusTyyppiNimi(tyyppi: number): string {
  return TYYPIN_NIMET[tyyppi] ?? String(tyyppi);
}

export interface KohdennusRyhma<K extends Kohdennus> {
  kustannuspaikka: K;
  projektit: K[];
}

export interface KohdennustenRyhmat<K extends Kohdennus> {
  kustannuspaikat: KohdennusRyhma<K>[];
  /** Projektit, joilla ei ole (tunnettua) kustannuspaikkaa: Yleisen alla. */
  yleiset: K[];
  merkkaukset: K[];
}

/** Listan ryhmittely: kustannuspaikat projekteineen, Yleisen projektit ja merkkaukset, kukin nimijärjestyksessä. */
export function kohdennustenRyhmat<K extends Kohdennus>(
  kaikki: readonly K[],
): KohdennustenRyhmat<K> {
  const jarjesta = (lista: K[]): K[] =>
    lista.sort((a, b) => kohdennuksenNimi(a).localeCompare(kohdennuksenNimi(b), 'fi'));
  const kp = jarjesta(kaikki.filter((k) => k.tyyppi === KohdennusTyyppi.KUSTANNUSPAIKKA));
  const projektit = kaikki.filter((k) => k.tyyppi === KohdennusTyyppi.PROJEKTI);
  const tunnettu = new Set(kp.map((k) => k.id));
  return {
    kustannuspaikat: kp.map((kustannuspaikka) => ({
      kustannuspaikka,
      projektit: jarjesta(projektit.filter((p) => p.kuuluu === kustannuspaikka.id)),
    })),
    yleiset: jarjesta(projektit.filter((p) => p.kuuluu === undefined || !tunnettu.has(p.kuuluu))),
    merkkaukset: jarjesta(kaikki.filter((k) => k.tyyppi === KohdennusTyyppi.MERKKAUS)),
  };
}
