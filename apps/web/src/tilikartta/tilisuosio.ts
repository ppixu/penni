import { useInit, usePaivitaAsetukset } from '@/app/kysely';
import { useMemo } from 'react';

/**
 * Tilien suosikit ja piilotukset. Samat asetusavaimet ja muoto kuin Kitsaksessa
 * (kitsas/db/tilimodel.cpp: "suosikkitilit", "piilotilit"; pilkuin eroteltu numerolista),
 * joten Kitsaksesta tuodun kirjan suosikit näkyvät sellaisenaan.
 */
export const SUOSIKIT_AVAIN = 'suosikkitilit';
export const PIILOTETUT_AVAIN = 'piilotilit';

/** "3000,8430,0" → {3000, 8430}. Kitsas kirjoittaa tyhjästä joukosta "0" — se ei ole tili. */
export function lueTiliLista(arvo: string | undefined): Set<number> {
  const tulos = new Set<number>();
  for (const osa of (arvo ?? '').split(',')) {
    const n = Number(osa.trim());
    if (Number.isInteger(n) && n > 0) tulos.add(n);
  }
  return tulos;
}

/** Joukko → "1910,3000" (nousevasti, jotta asetus ei vaihdu turhaan järjestyksen takia). */
export function kirjoitaTiliLista(tilit: Iterable<number>): string {
  return [...new Set(tilit)].sort((a, b) => a - b).join(',');
}

export interface TiliSuosio {
  suosikit: ReadonlySet<number>;
  piilotetut: ReadonlySet<number>;
  /** Suosikiksi merkitseminen poistaa piilotuksen (tila on yksi kolmesta, kuten Kitsaksessa). */
  asetaSuosikki: (numero: number, suosikki: boolean) => Promise<boolean>;
  /** Piilottaminen poistaa suosikin. */
  asetaPiilotettu: (numero: number, piilotettu: boolean) => Promise<boolean>;
  virheviesti: string | null;
}

/** Avoimen kirjan suosikit ja piilotukset sekä niiden tallennus asetuksiin. */
export function useTiliSuosio(): TiliSuosio {
  const { data: init } = useInit();
  const { tallenna, virheviesti } = usePaivitaAsetukset();
  const suosikit = useMemo(() => lueTiliLista(init?.asetukset[SUOSIKIT_AVAIN]), [init]);
  const piilotetut = useMemo(() => lueTiliLista(init?.asetukset[PIILOTETUT_AVAIN]), [init]);

  function paivita(numero: number, suosikki: boolean, piilotettu: boolean) {
    const s = new Set(suosikit);
    const p = new Set(piilotetut);
    if (suosikki) s.add(numero);
    else s.delete(numero);
    if (piilotettu) p.add(numero);
    else p.delete(numero);
    return tallenna({
      [SUOSIKIT_AVAIN]: kirjoitaTiliLista(s),
      [PIILOTETUT_AVAIN]: kirjoitaTiliLista(p),
    });
  }

  return {
    suosikit,
    piilotetut,
    asetaSuosikki: (numero, suosikki) =>
      paivita(numero, suosikki, suosikki ? false : piilotetut.has(numero)),
    asetaPiilotettu: (numero, piilotettu) =>
      paivita(numero, piilotettu ? false : suosikit.has(numero), piilotettu),
    virheviesti,
  };
}
