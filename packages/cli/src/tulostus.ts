import type { Tyokalu } from '@penni/tyokalut';
import {
  kirjoitusTyokalut,
  lueTyokalut,
  muutLueTyokalut,
  tyokalutJsonSchema,
} from '@penni/tyokalut';
import { KOMENNOT, TYOKALU_KOMENNOT } from './komennot.js';
import type { Io } from './suorita.js';

/** The command a human types for a tool, e.g. `tilit_haku` -> `tilit`. Every registered tool is
 * reachable through exactly one KOMENNOT entry, so this always resolves; the `?? t.nimi` fallback
 * only guards against a future tool that isn't wired into a command yet. */
function komentoNimi(t: Tyokalu): string {
  return TYOKALU_KOMENNOT[t.nimi] ?? t.nimi;
}

/** Kuvaukset viittaavat toisiinsa rekisterin työkalunimillä (esim. "hae ensin
 * tilit_haku-työkalulla"); ihmisen ohjeessa nimet käännetään CLI-komennoiksi, jotta ohje ei
 * mainitse nimiä joita ei voi kirjoittaa komentoriville. */
function kuvausKomennoin(kuvaus: string): string {
  return Object.entries(TYOKALU_KOMENNOT).reduce(
    (s, [tyokalu, komento]) => s.replaceAll(tyokalu, komento),
    kuvaus,
  );
}

/** Usage line of the command behind a tool, or undefined if the tool has no command. */
function kaytto(t: Tyokalu): string | undefined {
  return KOMENNOT[komentoNimi(t)]?.kaytto;
}

function ohjeRivit(t: Tyokalu): string[] {
  const k = kaytto(t);
  return [
    `  ${komentoNimi(t)} — ${kuvausKomennoin(t.kuvaus)}`,
    ...(k !== undefined ? [`      käyttö: ${k}`] : []),
  ];
}

/** `penni ohje`: list every registered tool by its invocable command name, grouped by
 * read/write, with its description and CLI usage line. */
export function tulostaOhje(io: Io): void {
  const rivit: string[] = [
    'Käyttö: penni --kirja <polku.penni> <komento> [valinnat]',
    '',
    'Lukukomennot:',
    ...[...lueTyokalut, ...muutLueTyokalut].flatMap(ohjeRivit),
    '',
    'Kirjoittavat komennot (vain uudet luonnokset ja liitteet):',
    ...kirjoitusTyokalut.flatMap(ohjeRivit),
  ];
  io.stdout(`${rivit.join('\n')}\n`);
}

/** `penni ohje --json`: the registry's own schema dump (@penni/tyokalut, CLI-agnostic), with each
 * tool entry enriched with the `komento` field a human/agent actually types on this CLI and its
 * `kaytto` usage line (`syote` is the tool's input schema, which for file/stdin commands is not
 * the CLI's argument list). */
export function ohjeJson(): unknown {
  const dump = tyokalutJsonSchema();
  return {
    ...dump,
    tyokalut: dump.tyokalut.map((t) => ({
      nimi: t.nimi,
      komento: TYOKALU_KOMENNOT[t.nimi] ?? t.nimi,
      kaytto: KOMENNOT[TYOKALU_KOMENNOT[t.nimi] ?? t.nimi]?.kaytto ?? null,
      kuvaus: t.kuvaus,
      kirjoittava: t.kirjoittava,
      syote: t.syote,
    })),
  };
}

function onRahaOlio(arvo: unknown): arvo is { sentit: number; eur: string } {
  return (
    typeof arvo === 'object' &&
    arvo !== null &&
    typeof (arvo as Record<string, unknown>).eur === 'string' &&
    typeof (arvo as Record<string, unknown>).sentit === 'number'
  );
}

/** Dumb value→text: money objects flatten to their euro string, arrays to a comma list, other
 *  objects to `avain=arvo` pairs (empty values skipped), everything else to plain text. */
function arvoTekstina(arvo: unknown): string {
  if (arvo === null || arvo === undefined) return '';
  if (onRahaOlio(arvo)) return arvo.eur;
  if (Array.isArray(arvo))
    return arvo.length === 0 ? '(ei rivejä)' : arvo.map(arvoTekstina).join(', ');
  if (typeof arvo === 'object')
    return Object.entries(arvo as Record<string, unknown>)
      .filter(([, v]) => !onTyhja(v))
      .map(([k, v]) => `${k}=${arvoTekstina(v)}`)
      .join(', ');
  return String(arvo);
}

/** Non-empty array of objects. An empty array is not a table: it prints as an
 *  `avain: (ei rivejä)` line, so e.g. `luonnos`'s empty `varoitukset` doesn't open the output
 *  with a bare "(ei rivejä)" before the voucher id. */
function onRivit(arvo: unknown): arvo is Record<string, unknown>[] {
  return (
    Array.isArray(arvo) &&
    arvo.length > 0 &&
    arvo.every((r) => typeof r === 'object' && r !== null && !Array.isArray(r))
  );
}

/** Numeric columns and the 'eur'/'sentit' money columns are right-aligned; everything else left. */
function onOikeaSarake(rivit: Record<string, unknown>[], avain: string): boolean {
  if (avain === 'eur' || avain === 'sentit') return true;
  return rivit.every((r) => typeof r[avain] === 'number');
}

function tulostaTaulukko(rivit: Record<string, unknown>[], io: Io): void {
  if (rivit.length === 0) {
    io.stdout('(ei rivejä)\n');
    return;
  }
  const sarakkeet = Object.keys(rivit[0] as Record<string, unknown>);
  const solut = rivit.map((rivi) => sarakkeet.map((s) => arvoTekstina(rivi[s])));
  const leveydet = sarakkeet.map((s, i) =>
    Math.max(s.length, ...solut.map((rivi) => (rivi[i] ?? '').length)),
  );
  const oikeat = sarakkeet.map((s) => onOikeaSarake(rivit, s));

  const muotoileRivi = (solut: string[]): string =>
    solut
      .map((s, i) => {
        const leveys = leveydet[i] ?? 0;
        return oikeat[i] ? s.padStart(leveys) : s.padEnd(leveys);
      })
      .join('  ')
      .trimEnd();

  io.stdout(`${muotoileRivi(sarakkeet)}\n`);
  for (const rivi of solut) io.stdout(`${muotoileRivi(rivi)}\n`);
}

/** Tyhjä arvo (null, puuttuva tai tyhjä merkkijono) jätetään tekstitulosteesta pois: tyhjä
 *  `alkupvm:`-rivi näyttää lukijasta virheeltä eikä kerro mitään. JSON-tuloste pitää kentät. */
function onTyhja(arvo: unknown): boolean {
  return arvo === null || arvo === undefined || arvo === '';
}

function tulostaAvainArvo(olio: Record<string, unknown>, io: Io): void {
  for (const [avain, arvo] of Object.entries(olio)) {
    if (onTyhja(arvo)) continue;
    io.stdout(`${avain}: ${arvoTekstina(arvo)}\n`);
  }
}

/**
 * Generic human rendering for a tool's JSON result: whenever exactly one property's value is an
 * array of objects, that array renders as an aligned column table and any remaining scalar
 * properties print as trailing `avain: arvo` lines (e.g. `tilit_haku`'s `{ tilit, rajattu }`).
 * With several such array properties (e.g. `tosite`'s `viennit` + `liitteet`) the scalar
 * properties print first as `avain: arvo` lines, then each array as its own table under an
 * `avain:` heading. With none, everything renders as `avain: arvo` lines. `{sentit, eur}` money
 * objects flatten to their euro string; empty values (null, undefined, '') are omitted from
 * `avain: arvo` lines. No table library, no per-tool formatting — deliberately dumb.
 */
export function tulostaIhmiselle(_nimi: string, tulos: unknown, io: Io): void {
  if (tulos !== null && typeof tulos === 'object' && !Array.isArray(tulos)) {
    const olio = tulos as Record<string, unknown>;
    const avaimet = Object.keys(olio);
    const taulukkoAvaimet = avaimet.filter((a) => onRivit(olio[a]));
    if (taulukkoAvaimet.length === 1) {
      const taulukkoAvain = taulukkoAvaimet[0] as string;
      tulostaTaulukko(olio[taulukkoAvain] as Record<string, unknown>[], io);
      const loput = avaimet.filter((a) => a !== taulukkoAvain);
      if (loput.length > 0) {
        tulostaAvainArvo(Object.fromEntries(loput.map((a) => [a, olio[a]])), io);
      }
      return;
    }
    if (taulukkoAvaimet.length > 1) {
      const skalaarit = avaimet.filter((a) => !taulukkoAvaimet.includes(a));
      tulostaAvainArvo(Object.fromEntries(skalaarit.map((a) => [a, olio[a]])), io);
      for (const avain of taulukkoAvaimet) {
        io.stdout(`\n${avain}:\n`);
        tulostaTaulukko(olio[avain] as Record<string, unknown>[], io);
      }
      return;
    }
    tulostaAvainArvo(olio, io);
    return;
  }
  io.stdout(`${JSON.stringify(tulos)}\n`);
}
