import { laskeSha } from '@/liitteet/laskeSha';
import type { KpClient } from '@penni/asiakas';

export type TallennusTulos = 'tallennettu' | 'oli-jo' | 'ei-tallennettu' | 'kausi-lukittu';

/** Onko hylkäys moottorin PVMLUKITTU (rakenteellinen tarkistus: virhe voi tulla siirtokerroksen läpi). */
function onKausiLukittu(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'PVMLUKITTU';
}

/** Ensimmäinen vapaa nimi: lasku-<numero>.pdf, sitten lasku-<numero>-2.pdf, -3, … */
function vapaaNimi(numero: string, olemassa: ReadonlySet<string>): string {
  const perus = `lasku-${numero}`;
  if (!olemassa.has(`${perus}.pdf`)) return `${perus}.pdf`;
  for (let n = 2; ; n++) {
    if (!olemassa.has(`${perus}-${n}.pdf`)) return `${perus}-${n}.pdf`;
  }
}

/**
 * Tallentaa laskun PDF:n tositteen liitteeksi vain-lisäävästi (spec "Storing the PDF"):
 * jos jokin liite on jo täsmälleen nämä tavut (sha) → 'oli-jo'; muuten `lisaaLiite` (auditoitu,
 * tarkistaa kauden lukituksen) lisää uuden liitteen. Tallennusongelmat eivät koskaan estä
 * latausta, joten mikään tallennusvirhe ei heitä: lukittu kausi → 'kausi-lukittu', mikä tahansa
 * muu (myös `haeLiitteet`-virhe) → 'ei-tallennettu'.
 */
export async function tallennaLaskuPdf(p: {
  client: Pick<KpClient, 'haeLiitteet' | 'lisaaLiite'>;
  tositeId: number;
  numero: string;
  tavut: Uint8Array;
  nyt: string; // ISO-aikaleima `luotu`-kenttään
}): Promise<TallennusTulos> {
  try {
    const sha = await laskeSha(p.tavut);
    const olemassa = await p.client.haeLiitteet(p.tositeId);
    if (olemassa.some((l) => l.sha === sha)) return 'oli-jo';
    const nimi = vapaaNimi(p.numero, new Set(olemassa.map((l) => l.nimi)));
    await p.client.lisaaLiite({
      tosite: p.tositeId,
      nimi,
      tyyppi: 'application/pdf',
      sha,
      luotu: p.nyt,
      data: p.tavut,
    });
    return 'tallennettu';
  } catch (e) {
    return onKausiLukittu(e) ? 'kausi-lukittu' : 'ei-tallennettu';
  }
}

/** Käynnistää selaimen latauksen (Blob + <a download>); tyyppi oletuksena PDF. */
export function lataaSelaimeen(
  tavut: Uint8Array,
  tiedostonimi: string,
  tyyppi = 'application/pdf',
): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(tavut)], { type: tyyppi }));
  const linkki = document.createElement('a');
  linkki.href = url;
  linkki.download = tiedostonimi;
  linkki.rel = 'noopener';
  document.body.appendChild(linkki);
  linkki.click();
  linkki.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
