import { useTallennaLiite } from '@/app/kysely';
import type { LiiteMeta } from '@penni/engine';
import { useCallback, useRef, useState } from 'react';
import type { LadattavaLiite } from './LiitteidenLataus.js';
import { avaaErikseen } from './avaaErikseen.js';
import { laskeSha } from './laskeSha.js';

/** Vielä tallentamaton liite: tavut muistissa, väliaikainen negatiivinen id. */
export type OdottavaLiite = LiiteMeta & { data: Uint8Array };

/**
 * Liitteet, jotka lisätään ennen kuin tositteella on id (uusi tosite, täsmäytyksen käsikirjaus).
 * Tavut pysyvät muistissa, kunnes `tallennaTositteelle` vie ne tallennetulle tositteelle.
 */
export function useOdottavatLiitteet(alku: readonly LadattavaLiite[] = []) {
  const { tallenna } = useTallennaLiite();
  const seuraavaId = useRef(-1);
  const [odottavat, setOdottavat] = useState<OdottavaLiite[]>(() =>
    alku.map((l) => ({ id: seuraavaId.current--, tosite: 0, luotu: '', ...l })),
  );

  const lisaa = useCallback((l: LadattavaLiite) => {
    const id = seuraavaId.current--;
    setOdottavat((o) => [...o, { id, tosite: 0, luotu: '', ...l }]);
  }, []);

  const poista = useCallback((id: number) => {
    setOdottavat((o) => o.filter((l) => l.id !== id));
  }, []);

  /**
   * Avaa liitteen erikseen samalla polulla kuin tallennetut liitteet: `avaaErikseen` päättää
   * sisällön perusteella, avataanko se ikkunaan vai ladataanko tiedostona. Tallennettua tyyppiä
   * ei käytetä sellaisenaan, koska blob-URL perii sovelluksen originin — text/html-liite
   * ajaisi muuten skriptiä sovelluksen nimissä, työpöydällä myös paikallista API:a vasten.
   */
  function avaa(id: number) {
    const liite = odottavat.find((l) => l.id === id);
    if (liite) avaaErikseen(liite);
  }

  /**
   * Tallentaa kaikki odottavat liitteet tositteelle ja tyhjentää jonon (myös epäonnistuneet,
   * etteivät ne päädy seuraavalle tositteelle). Palauttaa epäonnistuneiden nimet.
   */
  async function tallennaTositteelle(tosite: number): Promise<string[]> {
    const epaonnistuneet: string[] = [];
    for (const l of odottavat) {
      try {
        await tallenna({
          tosite,
          nimi: l.nimi,
          tyyppi: l.tyyppi,
          sha: await laskeSha(l.data),
          luotu: new Date().toISOString(),
          data: l.data,
        });
      } catch {
        epaonnistuneet.push(l.nimi);
      }
    }
    setOdottavat([]);
    return epaonnistuneet;
  }

  return { odottavat, lisaa, poista, avaa, tallennaTositteelle };
}

/** Käyttäjälle näytettävä viesti, kun tosite tallentui mutta osa liitteistä ei. */
export function liitevirheViesti(epaonnistuneet: readonly string[]): string | null {
  return epaonnistuneet.length > 0
    ? `Tosite tallentui, mutta liitteen tallennus epäonnistui: ${epaonnistuneet.join(', ')}. Lisää liite tositteelle uudelleen.`
    : null;
}
