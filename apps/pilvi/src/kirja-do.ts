import { ResourceError } from '@penni/engine';
import { luoKasittelijat, tunnistusALS, virheKoodiHttp } from '@penni/server/kasittelijat';
import { type KirjaDOEnv, KirjaDO as KirjaPohja, luoR2Liitevarasto } from '@penni/storage-do';
import { type SqliteCoreSeed, sha256Heksa } from '@penni/storage-sqlite-core';
import {
  type DoLaskurit,
  type KehitysEnv,
  TUONTI_TAULUT,
  YHTEENVETO_TAULUT,
  laskevaR2,
  laskuritPaalla,
  tuontiPaalla,
  tyhjatDoLaskurit,
} from './kehitys.js';

/** Sopimusreitin syöte RPC:n yli (ts-restin validoimat osat; otsakkeita ei välitetä). */
export interface ReittiSyote {
  params?: unknown;
  query?: unknown;
  body?: unknown;
}
/**
 * Pyyntökohtainen konteksti: Workerin kello, tunnistettu käyttäjä (audit-lokiin) ja kirjan id
 * (R2-liiteavaimen etuliite; DO ei muuten tunne omaa nimeään).
 */
export interface Konteksti {
  aika: string;
  userId: number;
  kirjaId: string;
}
export interface ReittiVastaus {
  status: number;
  body: unknown;
}

type Kasittelija = (syote: ReittiSyote) => Promise<ReittiVastaus>;

/** Liitetaulun sarakkeet, jotka tuonti kopioi sellaisenaan (tavut menevät liitevarastoon). */
export interface TuotuLiiteRivi {
  id: number;
  tosite: number;
  nimi: string;
  roolinimi: string | null;
  tyyppi: string;
  sha: string | null;
  luotu: string;
  json: string;
}

type TuontiArvo = string | number | null;

/** DO SQLiten sidottujen parametrien yläraja lausetta kohden. */
const MAX_PARAMETRIT = 100;

/**
 * Yksi kirjanpito = yksi Durable Object. Koko sopimuskäsittelijä (decode → moottori → encode)
 * ajetaan aktorin sisällä yhtenä RPC-kutsuna eikä Storage-kutsuja kierrätetä verkon yli
 * yksitellen. Käsittelijät ovat samat kuin apps/serverin (@penni/server/kasittelijat).
 *
 * Sarjallistus: pelkkä DO:n input gate ei riitä. Kun Storage-kutsu odottaa muuta I/O:ta kuin
 * oman SQLiten (liitevaraston R2-kirjoitus), gate aukeaa ja toinen RPC pääsisi ajamaan kesken
 * "tarkista tila/lukko → kirjoita" -jakson (esim. TilitPaatetty asetettaisiin liitteen R2-siirron
 * aikana ja liite kirjautuisi lukittuun kauteen). Siksi `kasittele`-kutsut ajetaan yksi kerrallaan
 * (promise-ketju, FIFO): jokainen käsittelijä on kirjan kannalta atominen kuten ennen R2:ta, kun
 * kaikki Storage-kutsut olivat synkronista SQL:ää. Hinta: yksi kirja käsittelee yhden pyynnön
 * kerrallaan (myös lukupyynnöt odottavat käynnissä olevaa 10 MiB:n liitelatausta).
 */
export class KirjaDO extends KirjaPohja {
  /** Viimeisimmän jonotetun kasittele-kutsun valmistuminen (ei koskaan hylkää). */
  #jono: Promise<void> = Promise.resolve();
  /** Mittauslaskurit (vain kun PILVI_KEHITYS_LASKURIT=1); muuten undefined eikä kukaan laske. */
  #laskurit: DoLaskurit | undefined;
  readonly #kehitysEnv: KehitysEnv;

  constructor(ctx: DurableObjectState, env: KirjaDOEnv & KehitysEnv) {
    const laskurit = laskuritPaalla(env) ? tyhjatDoLaskurit(crypto.randomUUID()) : undefined;
    super(
      ctx,
      laskurit && env.LIITTEET ? { ...env, LIITTEET: laskevaR2(env.LIITTEET, laskurit.r2) } : env,
    );
    this.#laskurit = laskurit;
    this.#kehitysEnv = env;
    if (laskurit) {
      this.sqlHavainto = ({ luettu, kirjoitettu }) => {
        laskurit.sqlLauseita++;
        laskurit.rowsRead += luettu;
        laskurit.rowsWritten += kirjoitettu;
      };
    }
  }

  /** Luo kirja siemenestä (migraatiot + siemen tyhjään kantaan; olemassa olevaan ei kosketa). */
  alusta(siemen: SqliteCoreSeed, kirjaId: string): void {
    this.kirja(siemen, kirjaId);
  }

  /**
   * Aja sopimusreitti `reitti` tämän kirjan Storagea vasten. Virheet palautetaan HTTP-vastauksina
   * (ResourceError kuten palvelimella), koska virheluokka ei säily RPC-rajan yli.
   */
  async kasittele(
    reitti: string,
    syote: ReittiSyote,
    konteksti: Konteksti,
  ): Promise<ReittiVastaus> {
    const laskurit = this.#laskurit;
    return this.#jonossa(async () => {
      if (!laskurit) return this.#aja(reitti, syote, konteksti);
      const alku = performance.now();
      try {
        return await this.#aja(reitti, syote, konteksti);
      } finally {
        laskurit.kasittelyja++;
        laskurit.kasittelyMs += performance.now() - alku;
      }
    });
  }

  /** Aja fn kirjan FIFO-jonossa (yksi kerrallaan, ks. luokan kuvaus). */
  async #jonossa<T>(fn: () => Promise<T>): Promise<T> {
    const edellinen = this.#jono;
    let vapauta: () => void = () => {};
    this.#jono = new Promise<void>((valmis) => {
      vapauta = valmis;
    });
    await edellinen;
    try {
      return await fn();
    } finally {
      vapauta();
    }
  }

  async #aja(reitti: string, syote: ReittiSyote, konteksti: Konteksti): Promise<ReittiVastaus> {
    const kasittelijat = luoKasittelijat(
      this.kirja({}, konteksti.kirjaId),
      () => konteksti.aika,
    ) as unknown as Record<string, Kasittelija>;
    const kasittelija = Object.hasOwn(kasittelijat, reitti) ? kasittelijat[reitti] : undefined;
    if (!kasittelija) {
      return { status: 404, body: { virhe: 'Reittiä ei löydy', koodi: 'EI_LOYDY' } };
    }
    try {
      return await tunnistusALS.run({ userId: konteksti.userId }, () => kasittelija(syote));
    } catch (e) {
      if (e instanceof ResourceError) {
        return { status: virheKoodiHttp(e.code), body: { virhe: e.message, koodi: e.code } };
      }
      // Muukin virhe vastataan tässä eikä heitetä RPC-rajan yli: Worker saa aina vastauksen,
      // ja yksityiskohdat jäävät tämän kirjan lokiin.
      console.error('[pilvi] KirjaDO: odottamaton virhe', e);
      return { status: 500, body: { virhe: 'Palvelinvirhe' } };
    }
  }

  // --- Vain paikalliseen kehitykseen ja mittaukseen (kehitys.ts; ilman ympäristömuuttujaa heittää) ---

  #vaadiTuonti(): void {
    if (!tuontiPaalla(this.#kehitysEnv)) throw new Error('Kehitystuonti ei ole käytössä');
  }

  /**
   * Tuo yhden taulun rivejä sellaisenaan (sarakkeet tarkistetaan taulun todellisia sarakkeita
   * vasten, joten kutsuja ei voi injektoida SQL:ää). Rivit kirjoitetaan monirivisinä INSERTeinä
   * (≤100 sidottua parametria lausetta kohden) yhdessä transaktiossa. Liite kulkee tuoLiite.
   */
  kehitysTuoRivit(taulu: string, sarakkeet: string[], rivit: TuontiArvo[][]): Promise<number> {
    this.#vaadiTuonti();
    return this.#jonossa(async () => {
      if (!(TUONTI_TAULUT as readonly string[]).includes(taulu)) {
        throw new Error(`Taulua ${taulu} ei tuoda riveinä`);
      }
      const sql = this.ctx.storage.sql;
      const olemassa = new Set(
        sql
          .exec<{ name: string }>('SELECT name FROM pragma_table_info(?)', taulu)
          .toArray()
          .map((r) => r.name),
      );
      if (sarakkeet.length === 0 || sarakkeet.some((c) => !olemassa.has(c))) {
        throw new Error(`Taulun ${taulu} sarakkeet eivät täsmää`);
      }
      const rivejaLausetta = Math.max(1, Math.floor(MAX_PARAMETRIT / sarakkeet.length));
      const ryhma = `(${sarakkeet.map(() => '?').join(', ')})`;
      const kirjoitus = taulu === 'asetus' ? 'INSERT OR REPLACE' : 'INSERT';
      this.ctx.storage.transactionSync(() => {
        for (let i = 0; i < rivit.length; i += rivejaLausetta) {
          const osa = rivit.slice(i, i + rivejaLausetta);
          for (const r of osa) {
            if (r.length !== sarakkeet.length) throw new Error('Rivin pituus ei täsmää');
          }
          sql.exec(
            `${kirjoitus} INTO "${taulu}" (${sarakkeet.map((c) => `"${c}"`).join(', ')}) VALUES ${osa
              .map(() => ryhma)
              .join(', ')}`,
            ...osa.flat(),
          );
        }
      });
      return rivit.length;
    });
  }

  /**
   * Tuo yksi liite: tavut liitevarastoon (R2, sama avain kuin tavallisella polulla) ja SQLiteen
   * vain metatieto — kuten lisaaLiite tekisi. Rivin id säilytetään, jotta tositteen liitteet
   * täsmäävät lähdekirjaan.
   */
  kehitysTuoLiite(kirjaId: string, rivi: TuotuLiiteRivi, tavut: ArrayBuffer): Promise<void> {
    this.#vaadiTuonti();
    return this.#jonossa(async () => {
      const bucket = this.env.LIITTEET;
      if (!bucket) throw new Error('LIITTEET-sidonta puuttuu');
      const data = new Uint8Array(tavut);
      const avain = await luoR2Liitevarasto(bucket, kirjaId).tallenna(
        await sha256Heksa(data),
        data,
      );
      this.ctx.storage.sql.exec(
        'INSERT INTO liite (id, tosite, nimi, roolinimi, tyyppi, sha, luotu, data, varasto_avain, koko, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        rivi.id,
        rivi.tosite,
        rivi.nimi,
        rivi.roolinimi,
        rivi.tyyppi,
        rivi.sha,
        rivi.luotu,
        new ArrayBuffer(0),
        avain,
        data.byteLength,
        rivi.json,
      );
    });
  }

  /** Rivimäärät tauluittain ja kannan koko tavuina (vain lukuja, ei sisältöä). */
  kehitysYhteenveto(): { rivit: Record<string, number>; kantaTavua: number } {
    this.#vaadiTuonti();
    const sql = this.ctx.storage.sql;
    const rivit: Record<string, number> = {};
    for (const taulu of YHTEENVETO_TAULUT) {
      rivit[taulu] = sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM "${taulu}"`).one().n;
    }
    return { rivit, kantaTavua: sql.databaseSize };
  }

  /** Lokirivit annetuille tositteille: yhteensä ja tilassa >= 100 (kirjattu) — vain lukumäärät. */
  kehitysLokimaarat(ids: number[]): { yhteensa: number; kirjattu: number } {
    this.#vaadiTuonti();
    const sql = this.ctx.storage.sql;
    let yhteensa = 0;
    let kirjattu = 0;
    for (let i = 0; i < ids.length; i += MAX_PARAMETRIT) {
      const osa = ids.slice(i, i + MAX_PARAMETRIT);
      const ph = osa.map(() => '?').join(', ');
      const r = sql
        .exec<{ n: number; k: number }>(
          `SELECT COUNT(*) AS n, COALESCE(SUM(tila >= 100), 0) AS k FROM loki WHERE tosite IN (${ph})`,
          ...osa,
        )
        .one();
      yhteensa += r.n;
      kirjattu += r.k;
    }
    return { yhteensa, kirjattu };
  }

  /** DO-laskurit; `nollaa` palauttaa nykyiset ja aloittaa alusta (esiintymä säilyy). */
  kehitysLaskurit(nollaa: boolean): DoLaskurit | null {
    const l = this.#laskurit;
    if (!l) return null;
    const kopio = structuredClone(l);
    if (nollaa) {
      // Paikallaan: R2-käärellä ja SQL-havainnoijalla on viittaus näihin olioihin.
      const tyhja = tyhjatDoLaskurit(l.esiintyma);
      Object.assign(l.r2, tyhja.r2);
      Object.assign(l, { ...tyhja, r2: l.r2 });
    }
    return kopio;
  }
}
