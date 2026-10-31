import { useKpClient } from '@/app/KpClientProvider';
import { useTallennaLiite } from '@/app/kysely';
import type { LadattavaLiite } from '@/liitteet/LiitteidenLataus';
import { laskeSha } from '@/liitteet/laskeSha';
import { type Tili, type TositeAsetukset, type TyolistaRivi, riviTositteeksi } from '@penni/engine';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { siivoaIpcVirhe } from './ipcVirhe.js';
import { annaTasmaysSilta } from './silta.js';

export interface KirjausTulos {
  avain: string;
  /** Syntyikö tosite. Tosi myös silloin kun liitteen tallennus epäonnistui (ks. `varoitus`). */
  ok: boolean;
  tositeId?: number;
  virhe?: string;
  /** Tosite syntyi, mutta jokin sen jälkeen epäonnistui (käytännössä liite). */
  varoitus?: string;
}

/** Virhe luettavaksi tekstiksi; IPC-etuliite pois myös työpöytäsillan heittämistä virheistä. */
function virheViesti(virhe: unknown): string {
  return siivoaIpcVirhe(virhe instanceof Error ? virhe.message : String(virhe));
}

/** Päättelee liitteen MIME-tyypin päätteestä; tuntematon menee oktettivirtana. */
export function mimetyyppi(polku: string): string {
  const p = polku.toLowerCase();
  if (p.endsWith('.pdf')) return 'application/pdf';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

/**
 * Kirjaa valitut rivit luonnostositteiksi ja liittää lähdekuitin sekä käyttäjän riville
 * lisäämät tiedostot (`omat`, rivin avaimella). Rivikohtainen: yhden
 * rivin epäonnistuminen (esim. lukittu kausi) ei keskeytä erää, vaan palautuu tuloksessa.
 *
 * Tositteen luonti ja liitteen tallennus erotellaan tarkoituksella: kun tosite on kerran
 * syntynyt, rivi raportoidaan `ok`:na vaikka liite epäonnistuisi (silloin `varoitus`
 * kertoo mikä jäi tekemättä). Muuten rivi jäisi valituksi ryhmäänsä ja seuraava
 * "Kirjaa valitut" loisi kirjaan saman tositteen toiseen kertaan.
 */
export function useKirjaaRivit() {
  const client = useKpClient();
  const qc = useQueryClient();
  const { tallenna } = useTallennaLiite();
  const [kaynnissa, setKaynnissa] = useState(false);

  async function kirjaa(
    rivit: readonly TyolistaRivi[],
    chart: readonly Tili[],
    asetukset: TositeAsetukset,
    omat: Readonly<Record<string, readonly LadattavaLiite[]>> = {},
  ): Promise<KirjausTulos[]> {
    setKaynnissa(true);
    const tulokset: KirjausTulos[] = [];
    try {
      for (const rivi of rivit) {
        let tositeId: number;
        try {
          const tallennettu = await client.luoTosite(riviTositteeksi(rivi, chart, asetukset));
          tositeId = tallennettu.id;
        } catch (virhe) {
          tulokset.push({ avain: rivi.avain, ok: false, virhe: virheViesti(virhe) });
          continue;
        }
        const tulos: KirjausTulos = { avain: rivi.avain, ok: true, tositeId };
        try {
          const liitteet: LadattavaLiite[] = [];
          if (rivi.kuitti) {
            const data = await annaTasmaysSilta().lueTiedosto(rivi.kuitti.tiedosto);
            const nimi = rivi.kuitti.tiedosto.split('/').pop() ?? 'kuitti';
            liitteet.push({ nimi, tyyppi: mimetyyppi(nimi), data });
          }
          liitteet.push(...(omat[rivi.avain] ?? []));
          for (const l of liitteet) {
            await tallenna({
              tosite: tositeId,
              nimi: l.nimi,
              tyyppi: l.tyyppi,
              sha: await laskeSha(l.data),
              luotu: new Date().toISOString(),
              data: l.data,
            });
          }
        } catch (virhe) {
          tulos.varoitus = `Tosite kirjattiin, mutta liite jäi tallentamatta: ${virheViesti(virhe)}`;
        }
        tulokset.push(tulos);
      }
    } finally {
      setKaynnissa(false);
      // Uudet luonnokset näkyviin tositeluetteloon sekä Menoihin ja Tuloihin.
      for (const avain of ['tositteet', 'menot', 'tulot', 'saldot', 'viennit', 'raportti'])
        void qc.invalidateQueries({ queryKey: [avain] });
    }
    return tulokset;
  }

  return { kirjaa, kaynnissa };
}
