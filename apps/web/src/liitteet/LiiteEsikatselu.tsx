import { useKpClient } from '@/app/KpClientProvider';
import { Button } from '@/components/ui/button';
import type { LiiteMeta } from '@penni/engine';
import { useEffect, useState } from 'react';

/** Kuvamuodot, jotka näytetään <img>-elementissä (ei SVG:tä: se on skriptattavaa XML:ää). */
const KUVAT = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function alkaa(data: Uint8Array, tavut: readonly number[], kohta = 0): boolean {
  return tavut.every((t, i) => data[kohta + i] === t);
}

/** PDF-otsake saa PDF-määrittelyn mukaan olla tiedoston ensimmäisen kilotavun sisällä. */
function onPdf(data: Uint8Array): boolean {
  const raja = Math.min(data.length - 4, 1024);
  for (let i = 0; i <= raja; i++) {
    if (alkaa(data, [0x25, 0x50, 0x44, 0x46, 0x2d], i)) return true; // "%PDF-"
  }
  return false;
}

/**
 * Upotettavan esikatselun MIME-tyyppi tai null, jos liitettä ei voi näyttää sivulla.
 *
 * Liitteet ovat käyttäjän tuomaa, mielivaltaista sisältöä (Kitsas-tuonnissa myös HTML kelpaa
 * tyypiksi). Blob-URL perii sivun originin, joten upotettava tyyppi päätellään sisällöstä
 * sallittujen muotojen joukosta eikä tallennettua tyyppiä käytetä sellaisenaan: PDF vain, jos
 * tavut ovat PDF:ää (selaimen PDF-katselin), muut vain kuvina <img>-elementissä, jossa skriptit
 * eivät aja. Kaikki muu avataan erikseen kuten ennenkin.
 */
export function esikatselunTyyppi(tyyppi: string, data: Uint8Array): string | null {
  if (onPdf(data)) return 'application/pdf';
  if (alkaa(data, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (alkaa(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (alkaa(data, [0x52, 0x49, 0x46, 0x46]) && alkaa(data, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp';
  if (alkaa(data, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  const ilmoitettu = tyyppi.split(';')[0]?.trim().toLowerCase() ?? '';
  return KUVAT.has(ilmoitettu) ? ilmoitettu : null;
}

/** Liitteen metatiedot; `data` mukana, kun liitettä ei ole vielä tallennettu (uusi tosite). */
export type NaytettavaLiite = LiiteMeta & { data?: Uint8Array };

type Tila =
  | { vaihe: 'ladataan' }
  | { vaihe: 'valmis'; url: string; laji: 'pdf' | 'kuva' }
  | { vaihe: 'eiTuettu'; tyyppi: string }
  | { vaihe: 'virhe'; viesti: string };

/**
 * Yhden liitteen esikatselu: PDF selaimen omassa katselimessa (<iframe>), kuvat <img>:nä, muut
 * tiedostot "Avaa erikseen" -toiminnolla. Liitteen tavut haetaan asiakkaalta (tai käytetään
 * mukana tulevia, vielä tallentamattoman liitteen tavuja) ja näytetään object-URL:na, joka
 * vapautetaan liitteen vaihtuessa ja komponentin poistuessa.
 */
export function LiiteEsikatselu({
  liite,
  onAvaaErikseen,
}: {
  liite: NaytettavaLiite;
  onAvaaErikseen: (id: number) => void;
}) {
  const client = useKpClient();
  const [tila, setTila] = useState<Tila>({ vaihe: 'ladataan' });

  useEffect(() => {
    let peruttu = false;
    let url: string | null = null;
    setTila({ vaihe: 'ladataan' });
    const lahde = liite.data
      ? Promise.resolve({ tyyppi: liite.tyyppi, data: liite.data })
      : client.haeLiite(liite.id);
    lahde
      .then((l) => {
        if (peruttu) return;
        if (!l) {
          setTila({ vaihe: 'virhe', viesti: 'Liitettä ei löytynyt.' });
          return;
        }
        const tyyppi = esikatselunTyyppi(l.tyyppi, l.data);
        if (!tyyppi) {
          setTila({ vaihe: 'eiTuettu', tyyppi: l.tyyppi });
          return;
        }
        url = URL.createObjectURL(new Blob([new Uint8Array(l.data)], { type: tyyppi }));
        setTila({ vaihe: 'valmis', url, laji: tyyppi === 'application/pdf' ? 'pdf' : 'kuva' });
      })
      .catch(() => {
        if (!peruttu) setTila({ vaihe: 'virhe', viesti: 'Liitteen esikatselu epäonnistui.' });
      });
    return () => {
      peruttu = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, liite.id, liite.tyyppi, liite.data]);

  if (tila.vaihe === 'valmis' && tila.laji === 'pdf')
    return (
      <iframe
        title={`Esikatselu: ${liite.nimi}`}
        src={tila.url}
        className="h-full w-full flex-1 border-0 bg-[var(--surface)]"
      />
    );
  if (tila.vaihe === 'valmis')
    return (
      <div className="flex-1 overflow-auto bg-[var(--surface)] p-2">
        <img
          src={tila.url}
          alt={`Esikatselu: ${liite.nimi}`}
          className="mx-auto h-auto max-w-full"
          // Rikkinäinen tai väärin merkitty kuva (esim. HEIC .jpg-nimellä): avaus erikseen.
          onError={() => setTila({ vaihe: 'eiTuettu', tyyppi: liite.tyyppi })}
        />
      </div>
    );
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[12.5px] text-[var(--text-muted)]">
      {tila.vaihe === 'ladataan' ? (
        <p>Ladataan esikatselua…</p>
      ) : (
        <>
          <p>
            {tila.vaihe === 'virhe'
              ? tila.viesti
              : `Tiedostoa ${liite.nimi} ei voi esikatsella tässä${tila.tyyppi ? ` (${tila.tyyppi})` : ''}.`}
          </p>
          <Button
            variant="sec"
            size="compact"
            type="button"
            onClick={() => onAvaaErikseen(liite.id)}
          >
            Avaa erikseen
          </Button>
        </>
      )}
    </div>
  );
}
