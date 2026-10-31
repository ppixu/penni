import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSIONS, ajaMigraatiot } from '@penni/storage-sqlite';
import Database from 'better-sqlite3';
import { type Istunto, kehitysPyynto } from './asiakas.js';
import { pyorista } from './tilasto.js';

/** Taulut tuontijärjestyksessä (vierasavaimet: tosite ennen vientiä ja liitettä). */
const RIVITAULUT = ['asetus', 'tili', 'tilikausi', 'kumppani', 'tosite', 'vienti', 'loki'] as const;
/** Yhden tuontipyynnön rivijoukon arvioitu JSON-koko ja rivimäärä (DO-raja 2 MB / rivi pysyy). */
const PYYNTO_TAVUA = 1_000_000;
const PYYNTO_RIVEJA = 2000;

export interface TuontiTulos {
  /** Rivimäärät tauluittain lähteessä (täsmäävät kohteeseen; ei sisältöä). */
  rivit: Record<string, number>;
  liitteita: number;
  liiteTavut: number;
  lahdeTiedostoTavut: number;
  /** Skeemaversio ennen mahdollista migraatiota (temp-kopiossa) ja sen jälkeen. */
  skeemaEnnen: number;
  skeemaJalkeen: number;
  /** Lähteen taulut, joita tuonti ei tunne (vain nimet; ei tuotu). */
  ohitetutTaulut: string[];
  kestoMs: number;
}

type Arvo = string | number | null;

/** Kopioi tiedosto ja sen WAL-sivutiedostot temp-hakemistoon; lähdetiedostoa ei koskaan avata. */
function kopioiTilapaisesti(lahde: string): { hakemisto: string; tiedosto: string } {
  const hakemisto = mkdtempSync(join(tmpdir(), 'penni-mittaus-'));
  const tiedosto = join(hakemisto, 'kirja.penni');
  copyFileSync(lahde, tiedosto);
  for (const pääte of ['-wal', '-shm']) {
    if (existsSync(lahde + pääte)) copyFileSync(lahde + pääte, tiedosto + pääte);
  }
  return { hakemisto, tiedosto };
}

function skeemaVersio(db: Database.Database): number {
  const taulu = db.prepare("SELECT name FROM sqlite_master WHERE name = 'migraatio'").get();
  if (!taulu) throw new Error('Tiedosto ei ole Penni-kirja (migraatio-taulua ei ole)');
  const rivi = db.prepare('SELECT MAX(versio) AS v FROM migraatio').get() as { v: number | null };
  return (rivi.v ?? -1) + 1;
}

/**
 * Lataa `.penni`-kirja paikalliseen Book DO:hon kehitystuontireiteillä. Lähde kopioidaan ensin
 * temp-hakemistoon (WAL-sivutiedostoineen) ja migroidaan sinne tarvittaessa; alkuperäistä ei
 * avata eikä muuteta. Rivit lähetetään tauluittain ≤1 MB:n erissä; liitteet yksitellen raakana
 * binäärinä, jolloin tavut menevät R2:een (ei riviin). Lopuksi rivimäärät verrataan lähteeseen.
 */
export async function tuoKirja(
  istunto: Istunto,
  kirjaId: string,
  lahdeTiedosto: string,
): Promise<TuontiTulos> {
  const alku = performance.now();
  const lahdeTiedostoTavut = statSync(lahdeTiedosto).size;
  const kopio = kopioiTilapaisesti(lahdeTiedosto);
  let db: Database.Database | undefined;
  try {
    db = new Database(kopio.tiedosto);
    const ennen = skeemaVersio(db);
    if (ennen > SCHEMA_VERSIONS.length) {
      throw new Error(
        `Kirjan skeemaversio ${ennen} on uudempi kuin tämä koodi tuntee (${SCHEMA_VERSIONS.length})`,
      );
    }
    if (ennen < SCHEMA_VERSIONS.length) ajaMigraatiot(db);
    const jalkeen = skeemaVersio(db);

    const kaikkiTaulut = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((r) => r.name);
    const tunnetut = new Set<string>([...RIVITAULUT, 'liite', 'migraatio']);
    const ohitetut = kaikkiTaulut.filter((t) => !tunnetut.has(t));

    const rivit: Record<string, number> = {};
    const laheta = async (taulu: string, sarakkeet: string[], era: Arvo[][]): Promise<void> => {
      await kehitysPyynto(istunto, kirjaId, 'POST', 'tuonti/rivit', {
        taulu,
        sarakkeet,
        rivit: era,
      });
    };

    for (const taulu of RIVITAULUT) {
      const lause = db.prepare(`SELECT * FROM "${taulu}"`);
      const sarakkeet = lause.columns().map((c) => c.name);
      let era: Arvo[][] = [];
      let eranKoko = 0;
      let lkm = 0;
      for (const r of lause.iterate() as IterableIterator<Record<string, unknown>>) {
        const arvot = sarakkeet.map((s) => {
          const a = r[s];
          if (a === null || typeof a === 'string' || typeof a === 'number') return a;
          throw new Error(`Taulun ${taulu} sarake ${s}: odottamaton arvotyyppi ${typeof a}`);
        });
        era.push(arvot);
        lkm++;
        eranKoko += arvot.reduce<number>((s, a) => s + (typeof a === 'string' ? a.length : 12), 0);
        if (era.length >= PYYNTO_RIVEJA || eranKoko >= PYYNTO_TAVUA) {
          await laheta(taulu, sarakkeet, era);
          era = [];
          eranKoko = 0;
        }
      }
      if (era.length > 0) await laheta(taulu, sarakkeet, era);
      rivit[taulu] = lkm;
    }

    // Liitteet: tavut raakana pyynnön runkona (R2:een), metatieto otsakkeessa.
    let liitteita = 0;
    let liiteTavut = 0;
    const liiteLause = db.prepare(
      'SELECT id, tosite, nimi, roolinimi, tyyppi, sha, luotu, json, varasto_avain, data FROM liite ORDER BY id',
    );
    for (const r of liiteLause.iterate() as IterableIterator<
      Record<string, string | number | Buffer | null>
    >) {
      if (r.varasto_avain != null) {
        throw new Error(
          `Liite ${r.id}: tavut ovat jo ulkoisessa varastossa, tuonti odottaa riviltä`,
        );
      }
      const data = r.data as Buffer;
      const { data: _pois, varasto_avain: _va, ...meta } = r;
      const vastaus = await fetch(`${istunto.pohja}/api/kirjat/${kirjaId}/kehitys/tuonti/liite`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${istunto.token}`,
          'x-liite-rivi': encodeURIComponent(JSON.stringify(meta)),
          'content-type': 'application/octet-stream',
        },
        body: data as unknown as BodyInit,
      });
      if (!vastaus.ok) {
        throw new Error(
          `Liitteen ${r.id} tuonti epäonnistui: ${vastaus.status} ${await vastaus.text()}`,
        );
      }
      liitteita++;
      liiteTavut += data.byteLength;
    }
    rivit.liite = liitteita;

    // Tarkistus: kohteen rivimäärät = lähteen.
    const kohde = await kehitysPyynto<{ rivit: Record<string, number> }>(
      istunto,
      kirjaId,
      'GET',
      'yhteenveto',
    );
    for (const [taulu, n] of Object.entries(rivit)) {
      if (kohde.rivit[taulu] !== n) {
        throw new Error(
          `Tuonti: taulun ${taulu} rivejä lähteessä ${n}, kohteessa ${kohde.rivit[taulu]}`,
        );
      }
    }

    return {
      rivit,
      liitteita,
      liiteTavut,
      lahdeTiedostoTavut,
      skeemaEnnen: ennen,
      skeemaJalkeen: jalkeen,
      ohitetutTaulut: ohitetut,
      kestoMs: pyorista(performance.now() - alku),
    };
  } finally {
    db?.close();
    rmSync(kopio.hakemisto, { recursive: true, force: true });
  }
}
