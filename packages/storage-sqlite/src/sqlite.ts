import { existsSync, linkSync, rmSync } from 'node:fs';
import type { Storage } from '@penni/engine';
import { type SqliteCoreSeed, createSqliteCoreStorage } from '@penni/storage-sqlite-core';
import Database from 'better-sqlite3';
import { luoBetterSqliteAjuri } from './ajuri-better.js';

/** Seed-data tuoreelle tietokannalle (sama muoto kuin conformance/memory-siemen). */
export type SqliteSeed = SqliteCoreSeed;

export interface SqliteOptions {
  /** Tiedostopolku; oletus ':memory:'. */
  tiedosto?: string;
}

/** Storage-toteutus + close()-kahva yhteydelle. */
export interface SqliteStorage extends Storage {
  close(): void;
  /**
   * Kirjoita avoimesta kannasta yhtenäinen kopio tiedostoon `kohde`. Ei koskaan ylikirjoita
   * olemassa olevaa tiedostoa. Heittää, jos kopio ei läpäise eheystarkistusta.
   */
  varmuuskopioi(kohde: string): void;
}

/**
 * better-sqlite3-pohjainen Storage. Ohut kääre: avaa yhteyden + pragmat, delegoi koko logiikan
 * @penni/storage-sqlite-coreen. Ajaa migraatiot ja siementää tyhjän kannan ytimessä.
 */
export function createSqliteStorage(
  seed: SqliteSeed = {},
  options: SqliteOptions = {},
): SqliteStorage {
  const ajuri = luoBetterSqliteAjuri(options.tiedosto ?? ':memory:');
  const storage = createSqliteCoreStorage(ajuri, seed);
  return Object.assign(storage, {
    varmuuskopioi(kohde: string): void {
      if (existsSync(kohde)) throw new Error(`Varmuuskopiota ei tehty: ${kohde} on jo olemassa.`);
      // VACUUM INTO ottaa yhtenäisen tilannekuvan avoimesta kannasta (myös WAL-tilassa). Kopio
      // kirjoitetaan ensin väliaikaistiedostoon ja nimetään vasta tarkistettuna: synkronoitu
      // kansio (Dropbox) ei koskaan näe puolikasta varmuuskopiota oikealla nimellä.
      const osittainen = `${kohde}.osittainen`;
      rmSync(osittainen, { force: true });
      try {
        ajuri.run('VACUUM INTO ?', [osittainen]);
        const tarkistus = new Database(osittainen, { readonly: true });
        try {
          const tulos = tarkistus.pragma('integrity_check', { simple: true });
          if (tulos !== 'ok') throw new Error(`Varmuuskopion eheystarkistus epäonnistui: ${tulos}`);
        } finally {
          tarkistus.close();
        }
        // linkSync epäonnistuu (EEXIST), jos kohde ehti syntyä välissä — ei koskaan ylikirjoitusta.
        linkSync(osittainen, kohde);
        rmSync(osittainen);
      } catch (virhe) {
        rmSync(osittainen, { force: true });
        throw virhe;
      }
    },
  });
}
