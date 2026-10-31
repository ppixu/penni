import { luoPalvelin } from '@penni/server';
import { createSqliteStorage } from '@penni/storage-sqlite';
import type { SqliteStorage } from '@penni/storage-sqlite';
import type { FastifyInstance } from 'fastify';

/** Where the built web app lives relative to the compiled main process. Overridable for tests. */
let webJuuri: string | undefined;

/** Point sessions at a built web bundle. Called once at startup; tests leave it unset. */
export function asetaWebJuuri(polku: string): void {
  webJuuri = polku;
}

/**
 * One open book: a `.penni` SQLite file, the Fastify app serving it, and the localhost address
 * the renderer loads. Contains no Electron imports so it can be tested in plain Node.
 */
export class KirjaIstunto {
  private closed = false;

  private constructor(
    readonly polku: string,
    readonly osoite: string,
    readonly storage: SqliteStorage,
    private readonly palvelin: FastifyInstance,
  ) {}

  /** Open (or create) a book file and start serving it on an ephemeral localhost port. */
  static async avaa(polku: string): Promise<KirjaIstunto> {
    const storage = createSqliteStorage({}, { tiedosto: polku });
    try {
      const palvelin = luoPalvelin(storage, {
        apiEtuliite: '/api',
        ...(webJuuri ? { staattinenHakemisto: webJuuri } : {}),
      });
      // Portti 0 => käyttöjärjestelmä antaa vapaan portin; sidotaan vain silmukkaosoitteeseen.
      const osoite = await palvelin.listen({ port: 0, host: '127.0.0.1' });
      return new KirjaIstunto(polku, osoite, storage, palvelin);
    } catch (virhe) {
      // luoPalvelin/listen epäonnistui: älä jätä avattua SQLite-yhteyttä roikkumaan.
      storage.close();
      throw virhe;
    }
  }

  /**
   * Stop serving and release the file. Safe to call multiple times.
   *
   * Releasing-by-construction: storage.close() runs whether or not palvelin.close() succeeds,
   * and `closed` is set regardless of which step failed — a failed close must not leave the
   * SQLite handle leaked or make a retry think there is still something open. If both steps
   * fail, the first error is the one thrown.
   */
  async sulje(): Promise<void> {
    if (this.closed) return;
    let ensimmainenVirhe: unknown;
    try {
      await this.palvelin.close();
    } catch (virhe) {
      ensimmainenVirhe = virhe;
    }
    try {
      this.storage.close();
    } catch (virhe) {
      if (ensimmainenVirhe === undefined) ensimmainenVirhe = virhe;
    }
    this.closed = true;
    if (ensimmainenVirhe !== undefined) throw ensimmainenVirhe;
  }
}

/** Owns the single active session and swaps it when the user opens another book. */
export class IstuntoHallinta {
  private istunto: KirjaIstunto | null = null;

  nykyinen(): KirjaIstunto | null {
    return this.istunto;
  }

  /**
   * Serve `polku` instead of whatever is open. Opens the new session BEFORE closing the old
   * one: if `polku` is corrupt/unreadable and `KirjaIstunto.avaa` throws, the previous session
   * is left running rather than leaving the user with no session at all.
   *
   * Invariant: `vaihda` rejects ⇔ nothing changed — the previous session is still the active
   * one. `avaaKirja` in paa.ts relies on exactly this. Opening the new session is the only step
   * that can fail the swap; once it succeeds, `this.istunto` is updated and the swap has
   * happened. Closing the previous session after that point is just cleanup — if it fails, the
   * swap must still be reported as successful, so the failure is logged rather than rejected.
   *
   * `nayta` (optional) shows the new session — in paa.ts it loads the window onto it. It runs
   * with the new session already current (the freshly loaded page's IPC calls are checked
   * against `nykyinen().osoite`) while the old one is still serving. If it throws — e.g. the
   * user chose to stay on a form with unsaved changes, cancelling the navigation — the new
   * session is closed, the old one becomes current again, and the error is rethrown: the same
   * "rejects ⇔ nothing changed" invariant.
   */
  async vaihda(
    polku: string,
    nayta?: (uusi: KirjaIstunto) => Promise<void>,
  ): Promise<KirjaIstunto> {
    const uusi = await KirjaIstunto.avaa(polku);
    const vanha = this.istunto;
    this.istunto = uusi;
    if (nayta) {
      try {
        await nayta(uusi);
      } catch (virhe) {
        this.istunto = vanha;
        try {
          await uusi.sulje();
        } catch (sulkuvirhe) {
          console.error('Perutun kirjanpitoistunnon sulkeminen epäonnistui:', sulkuvirhe);
        }
        throw virhe;
      }
    }
    if (vanha) {
      try {
        await vanha.sulje();
      } catch (virhe) {
        console.error('Edellisen kirjanpitoistunnon sulkeminen epäonnistui:', virhe);
      }
    }
    return this.istunto;
  }

  async suljeKaikki(): Promise<void> {
    if (this.istunto) {
      await this.istunto.sulje();
      this.istunto = null;
    }
  }
}
