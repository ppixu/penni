import { laskeSha } from '@/liitteet/laskeSha';
import type { KpClient } from '@penni/asiakas';
import { type StoredTosite, TositeTyyppi } from '@penni/engine';
import type { LaskuMalli } from '@penni/lasku-pdf';

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

/**
 * Maksumuistutuksen aiemmat asiakirjat (`muistutus.aiemmat`, vanhin ensin) PDF:n osioita varten.
 * Muilla tositteilla tyhjä lista. Puuttuva asiakirja heittää: muistutus ilman sen erittelyä
 * olisi epätäydellinen, joten PDF jätetään tekemättä.
 */
export async function haeAiemmat(
  client: Pick<KpClient, 'haeTosite'>,
  tosite: StoredTosite,
): Promise<StoredTosite[]> {
  if (tosite.tyyppi !== TositeTyyppi.MAKSUMUISTUTUS || !tosite.muistutus) return [];
  return Promise.all(
    tosite.muistutus.aiemmat.map(async (id) => {
      const aiempi = await client.haeTosite(id);
      if (aiempi === null) throw new Error(`aiempaa asiakirjaa ${id} ei löydy`);
      return aiempi;
    }),
  );
}

/**
 * Lataa laskun PDF:n: hakee maksumuistutuksen aiemmat asiakirjat, muodostaa niistä (`muodosta`)
 * näkymämallin ja PDF-tavut, lataa ne selaimeen ja yrittää tallentaa ne tositteen liitteeksi
 * vain-lisäävästi. Tallennusongelmat eivät koskaan estä latausta. Palauttaa käyttäjälle
 * näytettävän huomautuksen (liitteen tallennus jäi tekemättä, aiempia asiakirjoja ei saatu tai
 * PDF:n muodostus epäonnistui) tai null. Jos malli on estetty (`pdfEste`), ei lataa mitään ja
 * palauttaa syyn huomautuksena.
 */
export async function lataaLaskuPdf(p: {
  tosite: StoredTosite;
  /** Rakentaa näkymämallin; `aiemmat` on tyhjä muilla kuin maksumuistutuksilla. */
  muodosta: (aiemmat: readonly StoredTosite[]) => LaskuMalli;
  client: Pick<KpClient, 'haeLiitteet' | 'lisaaLiite' | 'haeTosite'>;
  nyt: string;
}): Promise<string | null> {
  let aiemmat: StoredTosite[];
  try {
    aiemmat = await haeAiemmat(p.client, p.tosite);
  } catch (e) {
    return `PDF:ää ei ladattu: aiempia asiakirjoja ei voitu hakea${e instanceof Error && e.message ? ` (${e.message})` : ''}`;
  }
  const malli = p.muodosta(aiemmat);
  if (malli.pdfEste !== null) return `PDF:ää ei ladattu: ${malli.pdfEste}`;
  if (malli.numero === null) return null;
  try {
    // Dynaaminen import: Inter-fontit (~1,1 MB base64) eivät kuulu pääpaketin latausjonoon.
    const { rakennaLaskuPdf } = await import('@penni/lasku-pdf');
    const tavut = await rakennaLaskuPdf(malli);
    lataaSelaimeen(tavut, malli.tiedostonimi);
    const tulos = await tallennaLaskuPdf({
      client: p.client,
      tositeId: p.tosite.id,
      numero: malli.numero,
      tavut,
      nyt: p.nyt,
    });
    if (tulos === 'kausi-lukittu') return 'PDF:ää ei voitu tallentaa liitteeksi (kausi lukittu)';
    if (tulos === 'ei-tallennettu') return 'PDF:ää ei voitu tallentaa liitteeksi';
    return null;
  } catch (e) {
    return `PDF:n muodostus epäonnistui${e instanceof Error && e.message ? `: ${e.message}` : '.'}`;
  }
}
