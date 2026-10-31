import { Pudotusalue } from '@/components/Pudotusalue';
import { useState } from 'react';

export const LIITE_MAX_TAVUT = 10 * 1024 * 1024;

/** Yhden tiedoston syöte: raakatavut + metatiedot (sha lasketaan kutsujassa). */
export interface LadattavaLiite {
  nimi: string;
  tyyppi: string;
  data: Uint8Array;
}

/**
 * Lukee File-olion tavuiksi. FileReaderilla eikä Blob.arrayBuffer()-metodilla, koska
 * jsdom (testiympäristö) ei toteuta jälkimmäistä — FileReader toimii sekä selaimessa
 * että jsdomissa.
 */
function lueTavut(tiedosto: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const lukija = new FileReader();
    lukija.onload = () => {
      const tulos = lukija.result;
      if (tulos instanceof ArrayBuffer) {
        resolve(new Uint8Array(tulos));
      } else {
        reject(new Error('Tiedoston luku epäonnistui.'));
      }
    };
    lukija.onerror = () => reject(new Error('Tiedoston luku epäonnistui.'));
    lukija.readAsArrayBuffer(tiedosto);
  });
}

/**
 * Tositteen liitteiden lisäys pudotusalueena (yhteinen Pudotusalue-komponentti). Lista
 * liitteistä avaus- ja poistopainikkeineen on Liitelistassa — liitteet näytetään kerran.
 */
export function LiitteidenLataus({ onLataa }: { onLataa: (l: LadattavaLiite) => Promise<void> }) {
  const [virhe, setVirhe] = useState<string | null>(null);

  async function valitut(tiedostot: File[]) {
    setVirhe(null);
    const virheet: string[] = [];
    for (const tiedosto of tiedostot) {
      if (tiedosto.size > LIITE_MAX_TAVUT) {
        virheet.push(
          tiedostot.length > 1
            ? `${tiedosto.name}: liite on liian suuri (yli 10 Mt).`
            : 'Liite on liian suuri (yli 10 Mt).',
        );
        continue;
      }
      try {
        const data = await lueTavut(tiedosto);
        await onLataa({
          nimi: tiedosto.name,
          tyyppi: tiedosto.type || 'application/octet-stream',
          data,
        });
      } catch {
        virheet.push(
          tiedostot.length > 1
            ? `${tiedosto.name}: liitteen tallennus epäonnistui.`
            : 'Liitteen tallennus epäonnistui.',
        );
      }
    }
    if (virheet.length > 0) setVirhe(virheet.join(' '));
  }

  return (
    <section aria-label="liitteiden lataus" className="mt-4 flex flex-col gap-2">
      <Pudotusalue
        otsikko="Lisää liite"
        ohje="Valitse tai pudota kuitti, lasku tai muu tosite (enintään 10 Mt)."
        onValitse={(t) => void valitut(t)}
      />
      {virhe ? (
        <p role="alert" className="text-[12.5px] text-[var(--danger)]">
          {virhe}
        </p>
      ) : null}
    </section>
  );
}
