import type { Tulos } from './pisteytys.js';

interface Yhteenveto {
  yhteensa: number;
  ok: number;
  tyokalutOk: number;
  keskiKestoMs: number;
  syyLaskuri: Map<string, number>;
}

function yhteenveda(tulokset: readonly Tulos[]): Yhteenveto {
  const syyLaskuri = new Map<string, number>();
  let ok = 0;
  let tyokalutOk = 0;
  let kestoYht = 0;
  for (const t of tulokset) {
    if (t.ok) ok += 1;
    if (t.tyokalutOk) tyokalutOk += 1;
    kestoYht += t.kestoMs;
    if (!t.ok) syyLaskuri.set(t.syy, (syyLaskuri.get(t.syy) ?? 0) + 1);
  }
  return {
    yhteensa: tulokset.length,
    ok,
    tyokalutOk,
    keskiKestoMs: tulokset.length === 0 ? 0 : kestoYht / tulokset.length,
    syyLaskuri,
  };
}

/** Prosentti YHDESSÄ nimittäjän kanssa — pelkkä % ilman (ok/yhteensä) hukkaisi otoskoon. */
function pros(osa: number, yhteensa: number): string {
  return yhteensa === 0 ? '—' : `${Math.round((100 * osa) / yhteensa)}% (${osa}/${yhteensa})`;
}

function syyRivit(y: Yhteenveto): string[] {
  return [...y.syyLaskuri.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([syy, maara]) => `${maara}x  ${syy}`);
}

function renderKonsoli(y: Yhteenveto): string {
  const rivit: string[] = [
    `Kysy-validointi: oikein ${pros(y.ok, y.yhteensa)}, työkalu osui ${pros(y.tyokalutOk, y.yhteensa)}, keskikesto ${Math.round(y.keskiKestoMs)} ms`,
  ];
  if (y.syyLaskuri.size > 0) {
    rivit.push('', 'Epäonnistumissyyt:', ...syyRivit(y).map((r) => `  ${r}`));
  }
  return rivit.join('\n');
}

function renderMd(tulokset: readonly Tulos[], y: Yhteenveto): string {
  const rivit: string[] = ['# Kysy-validoinnin tulokset', ''];
  rivit.push(`- Oikein: ${pros(y.ok, y.yhteensa)}`);
  rivit.push(`- Työkalu osui odotettuun perheeseen: ${pros(y.tyokalutOk, y.yhteensa)}`);
  rivit.push(`- Keskikesto: ${Math.round(y.keskiKestoMs)} ms`, '');
  rivit.push('## Kysymyskohtaiset tulokset', '');
  rivit.push('| id | ok | syy | kierrokset | kesto (ms) | työkalu osui |');
  rivit.push('| --- | --- | --- | --- | --- | --- |');
  for (const t of tulokset) {
    rivit.push(
      `| ${t.id} | ${t.ok ? '✓' : '✗'} | ${t.syy} | ${t.kierrokset} | ${Math.round(t.kestoMs)} | ${t.tyokalutOk ? '✓' : '✗'} |`,
    );
  }
  if (y.syyLaskuri.size > 0) {
    rivit.push('', '## Epäonnistumissyyt', '', ...syyRivit(y).map((r) => `- ${r}`));
  }
  return rivit.join('\n');
}

/** Console summary + report.md + report.json from one run's per-question `Tulos` list. */
export function muodostaRaportti(tulokset: readonly Tulos[]): {
  konsoli: string;
  md: string;
  json: unknown;
} {
  const y = yhteenveda(tulokset);
  return {
    konsoli: renderKonsoli(y),
    md: renderMd(tulokset, y),
    json: {
      yhteenveto: {
        yhteensa: y.yhteensa,
        ok: y.ok,
        tyokalutOk: y.tyokalutOk,
        keskiKestoMs: y.keskiKestoMs,
        syyt: Object.fromEntries(y.syyLaskuri),
      },
      tulokset,
    },
  };
}
