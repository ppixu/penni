import type { TositeEditoriTila } from '@/editori/types';
import type { KpClient } from '@penni/asiakas';
import {
  type IsoDate,
  type Tiliote,
  type TilioteTiedot,
  TositeTyyppi,
  poimiTiliotteet,
} from '@penni/engine';
import { muotoilePvm } from '@penni/euro';

/** Suomalainen IBAN tiliotteen tekstistä välilyönnit poistettuina (Kitsaksen kartan `iban`). */
export function poimiIban(teksti: string): string | undefined {
  const osuma = /\bFI\d{2}(?: ?\d{4}){3} ?\d{2}\b/.exec(teksti);
  return osuma ? osuma[0].replace(/ /g, '') : undefined;
}

/**
 * Lue pankin kuukausitiliote PDF:n tekstikerroksesta (sama moottorin `poimiTiliotteet` kuin
 * täsmäytyksessä). null, jos tiedosto ei ole kausellinen tiliote — esim. kuitti tai lasku —
 * jolloin kutsuja jatkaa kuitin lukuun.
 */
export async function lueTiliotePdf(
  pdf: Blob,
  pdfTeksti: (pdf: Blob) => Promise<string> = async (b) =>
    (await import('@/kuitit/pdf.js')).luePdfTeksti(b),
): Promise<{ tiliote: Tiliote; iban?: string } | null> {
  const teksti = await pdfTeksti(pdf);
  const tiliote = poimiTiliotteet(teksti);
  if (!tiliote.kausi) return null;
  const iban = poimiIban(teksti);
  return iban ? { tiliote, iban } : { tiliote };
}

/** Luettu tiliote tositteen tiedoiksi pankkitilille `tili`. null ilman kautta. */
export function tilioteTiedoiksi(
  tiliote: Pick<Tiliote, 'kausi' | 'alkusaldo' | 'loppusaldo'>,
  tili: number,
  iban?: string,
): TilioteTiedot | null {
  if (!tiliote.kausi) return null;
  const t: TilioteTiedot = { tili, alkupvm: tiliote.kausi.alkaa, loppupvm: tiliote.kausi.loppuu };
  if (iban) t.iban = iban;
  if (tiliote.alkusaldo !== undefined) t.alkusaldo = tiliote.alkusaldo;
  if (tiliote.loppusaldo !== undefined) t.loppusaldo = tiliote.loppusaldo;
  return t;
}

function kuukaudenViimeinen(iso: IsoDate): IsoDate {
  const v = Number(iso.slice(0, 4));
  const k = Number(iso.slice(5, 7));
  return new Date(Date.UTC(v, k, 0)).toISOString().slice(0, 10);
}

/** "Tiliote 9/2026" kokonaiselle kalenterikuukaudelle, muuten "Tiliote 1.9.2026–15.9.2026". */
export function tiliotteenOtsikko(t: Pick<TilioteTiedot, 'alkupvm' | 'loppupvm'>): string {
  const koko =
    t.alkupvm.endsWith('-01') &&
    t.alkupvm.slice(0, 7) === t.loppupvm.slice(0, 7) &&
    kuukaudenViimeinen(t.alkupvm) === t.loppupvm;
  return koko
    ? `Tiliote ${Number(t.alkupvm.slice(5, 7))}/${t.alkupvm.slice(0, 4)}`
    : `Tiliote ${muotoilePvm(t.alkupvm)}–${muotoilePvm(t.loppupvm)}`;
}

/**
 * Lomakkeen täyttö luetusta tiliotteesta: tyyppi Tiliote, päivä kauden viimeinen päivä,
 * selite (jos tyhjä) ja tiliotteen tiedot. Rivit säilyvät.
 */
export function tilioteTaytto(
  tiedot: TilioteTiedot,
  nykyinen: TositeEditoriTila,
): { tila: TositeEditoriTila; kuvaus: string; lahde: string } {
  return {
    tila: {
      ...nykyinen,
      tyyppi: TositeTyyppi.TILIOTE,
      paiva: tiedot.loppupvm,
      selite: nykyinen.selite || tiliotteenOtsikko(tiedot),
      tiliote: tiedot,
    },
    kuvaus: `${muotoilePvm(tiedot.alkupvm)}–${muotoilePvm(tiedot.loppupvm)}`,
    lahde: 'tiliotteesta',
  };
}

/**
 * Lue tositteen ensimmäinen PDF-liite tiliotteena. Palauttaa tiedot pankkitilille `tili` tai
 * käyttäjälle näytettävän syyn, miksi lukeminen ei onnistunut.
 */
export async function lueTositteenTiliote(
  client: Pick<KpClient, 'haeLiitteet' | 'haeLiite'>,
  tositeId: number,
  tili: number | undefined,
): Promise<TilioteTiedot | string> {
  if (tili === undefined) return 'Kirjanpidossa ei ole pankkitiliä.';
  const pdf = (await client.haeLiitteet(tositeId)).find((l) => l.tyyppi === 'application/pdf');
  if (!pdf) return 'Tositteella ei ole PDF-liitettä.';
  const liite = await client.haeLiite(pdf.id);
  if (!liite) return 'Liitettä ei löytynyt.';
  try {
    const luettu = await lueTiliotePdf(
      new Blob([new Uint8Array(liite.data)], { type: 'application/pdf' }),
    );
    const tiedot = luettu && tilioteTiedoiksi(luettu.tiliote, tili, luettu.iban);
    return tiedot ?? 'Liitteestä ei löytynyt tiliotteen kautta ja saldoja.';
  } catch {
    return 'Liitteen lukeminen epäonnistui.';
  }
}
