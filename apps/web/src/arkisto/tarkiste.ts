import { laskeSha } from '@/liitteet/laskeSha';
import { pura } from './zip';

export { laskeSha };

/** Tiedostot, joita `arkisto.sha256` ei luettele. */
export const EI_LISTALLA = ['arkisto.sha256', 'index.html', 'arkistovarmenne.html'];

const dekoodaa = new TextDecoder();

/** `arkisto.sha256`: rivi `<sha-256 heksana> *<polku>\n`, järjestettynä polun mukaan. */
export async function sha256Lista(
  tiedostot: readonly { polku: string; data: Uint8Array }[],
): Promise<string> {
  const jarjestetty = [...tiedostot].sort((a, b) =>
    a.polku < b.polku ? -1 : a.polku > b.polku ? 1 : 0,
  );
  let lista = '';
  for (const t of jarjestetty) lista += `${await laskeSha(t.data)} *${t.polku}\n`;
  return lista;
}

export interface ArkistonTarkistus {
  ok: boolean;
  juuriTiiviste: string;
  virheet: string[];
}

/**
 * Tarkistaa arkisto-zipin: zipissä on yksi juurikansio, jonka alla `arkisto.sha256`
 * luettelee muiden tiedostojen tiivisteet (polut suhteessa juurikansioon).
 */
export async function tarkistaArkisto(
  zip: Uint8Array,
  listanNimi = 'arkisto.sha256',
): Promise<ArkistonTarkistus> {
  const virheet: string[] = [];
  const tiedostot = new Map<string, Uint8Array>();
  const juuret = new Set<string>();
  for (const [polku, data] of pura(zip)) {
    const i = polku.indexOf('/');
    if (i < 0) {
      // Juuren ulkopuolinen tiedosto ei kuulu arkistoon, eikä se saa varjostaa juurikansion tiedostoa.
      virheet.push(`tiedosto juuressa: ${polku}`);
      continue;
    }
    juuret.add(polku.slice(0, i));
    tiedostot.set(polku.slice(i + 1), data);
  }
  if (juuret.size > 1) {
    // Toisen juuren samanniminen tiedosto korvaisi ensimmäisen: muutettu arkisto menisi läpi.
    return {
      ok: false,
      juuriTiiviste: '',
      virheet: [...virheet, `useita juurikansioita: ${[...juuret].sort().join(', ')}`],
    };
  }

  const listaTavut = tiedostot.get(listanNimi);
  if (!listaTavut) {
    return { ok: false, juuriTiiviste: '', virheet: [...virheet, `puuttuu: ${listanNimi}`] };
  }
  const juuriTiiviste = await laskeSha(listaTavut);

  const listatut = new Set<string>();
  for (const rivi of dekoodaa.decode(listaTavut).split('\n')) {
    if (rivi === '') continue;
    const osuma = /^([0-9a-f]{64}) \*(.+)$/.exec(rivi);
    if (!osuma) {
      virheet.push(`virheellinen rivi: ${rivi}`);
      continue;
    }
    const sha = osuma[1] as string;
    const polku = osuma[2] as string;
    listatut.add(polku);
    const data = tiedostot.get(polku);
    if (!data) virheet.push(`puuttuu: ${polku}`);
    else if ((await laskeSha(data)) !== sha) virheet.push(`muuttunut: ${polku}`);
  }

  const ohitettavat = new Set([...EI_LISTALLA, listanNimi]);
  for (const polku of [...tiedostot.keys()].sort()) {
    if (!listatut.has(polku) && !ohitettavat.has(polku)) virheet.push(`listaamaton: ${polku}`);
  }

  const index = tiedostot.get('index.html');
  if (index && !dekoodaa.decode(index).includes(juuriTiiviste)) {
    virheet.push('juuritiiviste ei täsmää index.html');
  }

  return { ok: virheet.length === 0, juuriTiiviste, virheet };
}
