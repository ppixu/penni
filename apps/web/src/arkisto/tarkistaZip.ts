import type { IsoDate } from '@penni/engine';
import { arkistoKirjauksenAvain, lueKirjaus } from './arkistoKirjaus';
import { tarkistaPurettu } from './tarkiste';
import { pura } from './zip';

/** Pennin kirjoittamat paketit: tilikauden arkisto ja koko kirjanpidon vienti. */
export type ZipLaji = 'arkisto' | 'vienti';

const LISTA: Record<ZipLaji, string> = { arkisto: 'arkisto.sha256', vienti: 'vienti.sha256' };

/** Arkiston juuritiivisteen suhde kirjanpitoon arkistoinnin yhteydessä tallennettuun. */
export type KirjanTiiviste = 'tasmaa' | 'eri' | 'ei-kirjausta';

export interface ZipTarkistus {
  laji: ZipLaji | null;
  ok: boolean;
  juuriTiiviste: string;
  virheet: string[];
  /** Tiivistelistan rivit eli tarkistettujen tiedostojen määrä. */
  tiedostoja: number;
  /** Arkiston kausi ja luontihetki manifestista; viennillä null. */
  tilikausi: { alkaa: IsoDate; loppuu: IsoDate } | null;
  luotu: string | null;
  /** Vain arkistolle. */
  kirjanTiiviste: KirjanTiiviste | null;
}

const dekoodaa = new TextDecoder();

function hylatty(virhe: string): ZipTarkistus {
  return {
    laji: null,
    ok: false,
    juuriTiiviste: '',
    virheet: [virhe],
    tiedostoja: 0,
    tilikausi: null,
    luotu: null,
    kirjanTiiviste: null,
  };
}

function lueManifest(data: Uint8Array | undefined): {
  tilikausi: { alkaa: IsoDate; loppuu: IsoDate } | null;
  luotu: string | null;
} {
  try {
    const m = JSON.parse(dekoodaa.decode(data)) as {
      tilikausi?: { alkaa?: unknown; loppuu?: unknown };
      luotu?: unknown;
    };
    const k = m.tilikausi;
    return {
      tilikausi:
        typeof k?.alkaa === 'string' && typeof k.loppuu === 'string'
          ? { alkaa: k.alkaa as IsoDate, loppuu: k.loppuu as IsoDate }
          : null,
      luotu: typeof m.luotu === 'string' ? m.luotu : null,
    };
  } catch {
    return { tilikausi: null, luotu: null };
  }
}

/**
 * Tarkistaa käyttäjän valitseman zipin: tunnistaa, onko se tilikauden arkisto vai kirjanpidon
 * vienti, laskee jokaisen tiedoston SHA-256:n tiivistelistaa vasten (`tarkistaPurettu`) ja
 * vertaa arkiston juuritiivistettä kirjanpitoon arkistoinnin yhteydessä tallennettuun
 * (`Arkistoitu/<loppuu>`).
 */
export async function tarkistaZip(
  zip: Uint8Array,
  asetukset: Readonly<Record<string, string>>,
): Promise<ZipTarkistus> {
  let purettu: Map<string, Uint8Array>;
  try {
    purettu = pura(zip);
  } catch {
    return hylatty('Tiedosto ei ole zip-paketti.');
  }

  // Polku juurikansion alla; useat juuret tai juuren tiedostot raportoi tarkistaPurettu.
  const juurenAlla = (polku: string) => polku.slice(polku.indexOf('/') + 1);
  const listaPolku = (laji: ZipLaji) =>
    [...purettu.keys()].find((p) => p.includes('/') && juurenAlla(p) === LISTA[laji]);
  const laji: ZipLaji | null = listaPolku('arkisto')
    ? 'arkisto'
    : listaPolku('vienti')
      ? 'vienti'
      : null;
  if (!laji) return hylatty('Tiedosto ei ole Pennin arkisto eikä kirjanpidon vienti.');

  const tulos = await tarkistaPurettu(purettu, LISTA[laji]);
  const lista = purettu.get(listaPolku(laji) as string);
  const tiedostoja = lista
    ? dekoodaa
        .decode(lista)
        .split('\n')
        .filter((r) => r !== '').length
    : 0;

  if (laji === 'vienti') {
    return { ...tulos, laji, tiedostoja, tilikausi: null, luotu: null, kirjanTiiviste: null };
  }

  const manifestPolku = [...purettu.keys()].find(
    (p) => p.includes('/') && juurenAlla(p) === 'manifest.json',
  );
  const { tilikausi, luotu } = lueManifest(manifestPolku ? purettu.get(manifestPolku) : undefined);
  const kirjaus = tilikausi
    ? lueKirjaus(asetukset[arkistoKirjauksenAvain(tilikausi.loppuu)])
    : null;
  const kirjanTiiviste: KirjanTiiviste = !kirjaus
    ? 'ei-kirjausta'
    : kirjaus.tiiviste === tulos.juuriTiiviste
      ? 'tasmaa'
      : 'eri';
  return { ...tulos, laji, tiedostoja, tilikausi, luotu, kirjanTiiviste };
}
