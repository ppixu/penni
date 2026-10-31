/** transformers.js:n progress_callback-ilmoituksen kentät, joita laskuri tarvitsee. */
export interface LatausIlmoitus {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

/** Prosessorin pienten tiedostojen (tokenisoija, asetukset) osuus palkista; loput kuuluu painoille. */
const PROSESSORIN_OSUUS = 0.05;

/**
 * Kokoaa lukumallin latauksen yhdeksi osuudeksi 0..1. Lataus on kaksi peräkkäistä vaihetta:
 *
 * 1. Prosessori (`AutoProcessor.from_pretrained`): pieniä tiedostoja, jotka kirjasto raportoi
 *    tiedostokohtaisilla `progress`-ilmoituksilla. Näiden yhteisosuus kuvataan palkin alkuun
 *    (0..PROSESSORIN_OSUUS), jottei se ehdi 100 %:iin ennen kuin painot on ladattu.
 * 2. Malli (`AutoModelForImageTextToText.from_pretrained`): kirjasto ilmoittaa kaikki odotetut
 *    tiedostot kokoineen etukäteen ja lähettää niistä `progress_total`-kokonaisilmoituksia.
 *    Ensimmäinen sellainen aloittaa mallin vaiheen; se kuvataan palkin loppuosaan, ja siitä
 *    eteenpäin tiedostokohtaiset ilmoitukset ohitetaan (kokonaisilmoitus kattaa ne jo).
 *
 * Osuus ei koskaan pienene, ja vain kasvanut osuus ilmoitetaan. 1 saavutetaan vasta, kun mallin
 * kaikki tiedostot on ladattu.
 */
export function luoEdistymisLaskuri(
  ilmoita: (osuus: number) => void,
): (tieto: LatausIlmoitus) => void {
  const prosessorinTiedostot = new Map<string, { ladattu: number; koko: number }>();
  let mallinVaihe = false;
  let paras = 0;
  const julkaise = (osuus: number) => {
    if (osuus <= paras) return;
    paras = osuus;
    ilmoita(osuus);
  };
  return (tieto) => {
    if (typeof tieto.loaded !== 'number' || typeof tieto.total !== 'number') return;
    if (tieto.status === 'progress_total') {
      if (tieto.total <= 0) return;
      mallinVaihe = true;
      const suhde = Math.min(1, tieto.loaded / tieto.total);
      julkaise(Math.min(1, PROSESSORIN_OSUUS + (1 - PROSESSORIN_OSUUS) * suhde));
      return;
    }
    if (tieto.status !== 'progress' || tieto.file === undefined || mallinVaihe) return;
    prosessorinTiedostot.set(tieto.file, { ladattu: tieto.loaded, koko: tieto.total });
    let ladattu = 0;
    let koko = 0;
    for (const t of prosessorinTiedostot.values()) {
      ladattu += t.ladattu;
      koko += t.koko;
    }
    if (koko <= 0) return;
    julkaise(PROSESSORIN_OSUUS * Math.min(1, ladattu / koko));
  };
}
