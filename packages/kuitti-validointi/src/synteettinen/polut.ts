import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiLaskuri } from '../workersAi.js';

/** Paketin juuri (packages/kuitti-validointi), riippumaton cwd:stä ja `--out`ista. */
export const PAKETTIHAKEMISTO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const FIKSTUURIHAKEMISTO = join(PAKETTIHAKEMISTO, 'fixtures', 'synteettinen');

/**
 * Workers AI -kutsulaskurin YKSI kiinteä paikka (git-ignoroitu). Ei riipu `--out`ista eikä cwd:stä:
 * kutsukatto 60 on koko spiken yhteinen, joten tulosten hakemiston vaihtaminen tai poistaminen
 * ei saa nollata sitä.
 */
export const AI_LASKURI_POLKU = join(PAKETTIHAKEMISTO, '.ai-tila', 'laskuri.json');

/**
 * Ainoa tapa avata syöte Workers AI -ajoa varten: polun on ratkettava (symlinkit mukaan lukien)
 * synteettisten fikstuurien hakemiston alle. Muuten heitetään — oikeita kuitteja ei lähetetä.
 */
export function fikstuuriPolku(nimi: string, juuri: string = FIKSTUURIHAKEMISTO): string {
  const kohde = resolve(juuri, nimi);
  const tarkista = (polku: string, perus: string): boolean => {
    const rel = relative(perus, polku);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  };
  if (!tarkista(kohde, juuri)) {
    throw new Error(
      `Kieltäydytään: ${nimi} ei ole synteettisten fikstuurien hakemiston (${juuri}) alla. Workers AI -ajoon ei lähetetä muuta kuin synteettisiä fikstuureja.`,
    );
  }
  if (existsSync(kohde) && !tarkista(realpathSync(kohde), realpathSync(juuri))) {
    throw new Error(
      `Kieltäydytään: ${nimi} osoittaa symlinkin kautta fikstuurihakemiston ulkopuolelle.`,
    );
  }
  return kohde;
}

const lueLuku = (polku: string): number => {
  try {
    const data: unknown = JSON.parse(readFileSync(polku, 'utf8'));
    const n =
      typeof data === 'object' && data !== null && 'kutsuja' in data
        ? (data as { kutsuja: unknown }).kutsuja
        : 0;
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
};

/**
 * Avaa kiinteän laskurin. Jos tiedostoa ei ole: aloitetaan vanhojen laskurien maksimista
 * (migraatio), ja jos niitäkään ei ole mutta välimuistissa on jo vastauksia (eli kutsuja on
 * kulutettu), kieltäydytään — hiljainen nollaus söisi katon.
 */
export function alustaLaskuri(
  polku: string,
  vanhatLaskurit: readonly string[],
  cacheHakemistot: readonly string[],
): AiLaskuri {
  const laskuri = new AiLaskuri(polku);
  if (existsSync(polku)) return laskuri;
  const vanhat = vanhatLaskurit.filter((p) => existsSync(p)).map(lueLuku);
  if (vanhat.length > 0) {
    laskuri.aseta(Math.max(...vanhat));
    return laskuri;
  }
  const kuluttanut = cacheHakemistot.some(
    (d) => existsSync(d) && readdirSync(d).some((n) => n.endsWith('.txt')),
  );
  if (kuluttanut) {
    throw new Error(
      `Kutsulaskuri ${polku} puuttuu, mutta välimuistissa on jo Workers AI -vastauksia: kutsuja on kulutettu, määrä tuntematon. Ei jatketa (katto 60 nollautuisi). Luo laskuri käsin oikealla arvolla: {"kutsuja": N}.`,
    );
  }
  return laskuri;
}
