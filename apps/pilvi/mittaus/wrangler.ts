import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAMA_HAKEMISTO = dirname(fileURLToPath(import.meta.url));
const PILVI_JUURI = join(TAMA_HAKEMISTO, '..');
const KONFIGURAATIO = join(TAMA_HAKEMISTO, 'wrangler.mittaus.jsonc');

export interface WranglerIstunto {
  /** Esim. http://127.0.0.1:8787 */
  pohja: string;
  /** wrangler-prosessin pid (vain tämä ja sen jälkeläiset pysäytetään). */
  pid: number;
  /** Kaikkien workerd-lapsiprosessien kertynyt CPU-aika (ms; ps:n resoluutio 10 ms). */
  workerdCpuMs(): number;
  /** wranglerin viimeiset lokirivit virhetilanteita varten. */
  loki(): string;
  pysayta(): Promise<void>;
}

export interface KaynnistysValinnat {
  /** Miniflaren pysyvä tila (DO-SQLite, R2); sama hakemisto = sama data uudelleenkäynnistyksen yli. */
  persistHakemisto: string;
  /** PILVI_KEHITYS_LASKURIT=1 (oletus: päällä). */
  laskurit?: boolean;
  /** Odotusaika valmiille palvelimelle (ms). */
  aikaraja?: number;
}

/** Vapaa TCP-portti (kuuntele 0:ssa, lue, sulje). */
function vapaaPortti(): Promise<number> {
  return new Promise((resolve, reject) => {
    const palvelin = createServer();
    palvelin.once('error', reject);
    palvelin.listen(0, '127.0.0.1', () => {
      const osoite = palvelin.address();
      const portti = typeof osoite === 'object' && osoite ? osoite.port : 0;
      palvelin.close(() => resolve(portti));
    });
  });
}

interface ProsessiRivi {
  pid: number;
  ppid: number;
  cputime: string;
  komento: string;
}

/** ps -A: pid, ppid, cputime ([[dd-]hh:]mm:ss.cc) ja komento. */
function prosessit(): ProsessiRivi[] {
  const ulos = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,cputime=,command='], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const rivit: ProsessiRivi[] = [];
  for (const rivi of ulos.split('\n')) {
    const osuma = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(rivi);
    if (osuma) {
      rivit.push({
        pid: Number(osuma[1]),
        ppid: Number(osuma[2]),
        cputime: osuma[3] as string,
        komento: osuma[4] as string,
      });
    }
  }
  return rivit;
}

/** ps:n cputime ([[dd-]hh:]mm:ss[.cc]) millisekunteina. */
export function cputimeMs(aika: string): number {
  const [paivat, loppu] = aika.includes('-') ? (aika.split('-') as [string, string]) : ['0', aika];
  const osat = loppu.split(':').map(Number);
  let s = 0;
  for (const o of osat) s = s * 60 + o;
  return Math.round((Number(paivat) * 86400 + s) * 1000);
}

/** Juuriprosessin kaikki jälkeläiset (ei juurta itseään). */
export function jalkelaiset(
  juuri: number,
  kaikki: readonly ProsessiRivi[] = prosessit(),
): number[] {
  const lapset = new Map<number, number[]>();
  for (const p of kaikki) lapset.set(p.ppid, [...(lapset.get(p.ppid) ?? []), p.pid]);
  const ulos: number[] = [];
  const jono = [...(lapset.get(juuri) ?? [])];
  while (jono.length > 0) {
    const pid = jono.shift() as number;
    ulos.push(pid);
    jono.push(...(lapset.get(pid) ?? []));
  }
  return ulos;
}

function elossa(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const odota = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Käynnistä paikallinen `wrangler dev` mittauskonfiguraatiolla (ei tiliyhteyttä, ei deployta):
 * vapaat portit, oma persist-hakemisto ja kehitysmuuttujat --var:llä. Palautettu `pysayta`
 * lopettaa vain tämän käynnistämän wrangler-prosessin ja sen jälkeläiset (ei koskaan muita
 * workerd-prosesseja).
 */
export async function kaynnistaWrangler(valinnat: KaynnistysValinnat): Promise<WranglerIstunto> {
  const portti = await vapaaPortti();
  const inspektori = await vapaaPortti();
  const wranglerBin = join(
    dirname(createRequire(join(PILVI_JUURI, 'package.json')).resolve('wrangler/package.json')),
    'bin',
    'wrangler.js',
  );
  const args = [
    wranglerBin,
    'dev',
    '-c',
    KONFIGURAATIO,
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    String(portti),
    '--inspector-port',
    String(inspektori),
    '--persist-to',
    valinnat.persistHakemisto,
    '--log-level',
    'warn',
    '--var',
    'PAIKALLINEN_WORKERD:1',
    '--var',
    'PILVI_KEHITYS_TUONTI:1',
    ...(valinnat.laskurit === false ? [] : ['--var', 'PILVI_KEHITYS_LASKURIT:1']),
  ];
  const lapsi: ChildProcess = spawn(process.execPath, args, {
    cwd: PILVI_JUURI,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let lokiTeksti = '';
  const kerää = (d: Buffer) => {
    lokiTeksti = (lokiTeksti + d.toString()).slice(-8000);
  };
  lapsi.stdout?.on('data', kerää);
  lapsi.stderr?.on('data', kerää);
  let kaatui: number | null = null;
  lapsi.once('exit', (koodi) => {
    kaatui = koodi ?? -1;
  });
  const pid = lapsi.pid as number;
  const pohja = `http://127.0.0.1:${portti}`;

  const pysayta = async (): Promise<void> => {
    const kaikki = jalkelaiset(pid);
    if (elossa(pid)) lapsi.kill('SIGTERM');
    for (let i = 0; i < 100 && kaatui === null; i++) await odota(100);
    if (kaatui === null) lapsi.kill('SIGKILL');
    // Jälkeläiset, jotka jäivät henkiin (vain ne, jotka olivat tämän wranglerin alla).
    await odota(300);
    for (const p of kaikki) {
      if (elossa(p)) {
        try {
          process.kill(p, 'SIGTERM');
        } catch {
          // jo poissa
        }
      }
    }
  };

  // Valmis, kun Worker vastaa: /api/muu ei koske yhteenkään DO:hon (DO:t pysyvät kylminä).
  const raja = Date.now() + (valinnat.aikaraja ?? 90_000);
  for (;;) {
    if (kaatui !== null) throw new Error(`wrangler dev päättyi (${kaatui}):\n${lokiTeksti}`);
    try {
      const r = await fetch(`${pohja}/muu`);
      await r.arrayBuffer();
      if (r.status === 404) break;
    } catch {
      // ei vielä kuuntele
    }
    if (Date.now() > raja) {
      await pysayta();
      throw new Error(`wrangler dev ei valmistunut ajoissa:\n${lokiTeksti}`);
    }
    await odota(250);
  }

  return {
    pohja,
    pid,
    workerdCpuMs: () => {
      const kaikki = prosessit();
      const omat = new Set(jalkelaiset(pid, kaikki));
      return kaikki
        .filter((p) => omat.has(p.pid) && /workerd/.test(p.komento))
        .reduce((s, p) => s + cputimeMs(p.cputime), 0);
    },
    loki: () => lokiTeksti,
    pysayta,
  };
}
