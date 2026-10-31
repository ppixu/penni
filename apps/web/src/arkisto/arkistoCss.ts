/**
 * Arkiston oma tyylitiedosto sovelluksen CSS:n perään: sivun reunukset, navigointipalkki,
 * alatunniste, käsin kirjoitetun sisällön (`.arkistoteksti`) perustyylit ja tulostus. Vaalea teema pakotetaan, jotta arkisto näyttää samalta
 * katselijan asetuksista riippumatta. Fontit putoavat offline-tilassa järjestelmäfonttiin.
 */
export const ARKISTO_CSS = `
:root { color-scheme: light; }
/* Sovelluksen väritunnukset vaaleisiin arvoihinsa (index.css :root), jotta kerätyn
   sovellus-CSS:n mahdolliset tumman teeman ohitukset eivät muuta arkiston värejä. */
body.arkisto {
  --bg-app: #ffffff;
  --bg-subtle: #fafafa;
  --surface: #ffffff;
  --border: #ececf0;
  --border-strong: #e4e4e7;
  --border-faint: #f4f4f5;
  --track: #f4f4f5;
  --text: #18181b;
  --text-muted: #6b7280;
  --text-subtle: #9ca3af;
  --accent: #4f46e5;
  --accent-soft: #eef2ff;
  --accent-fg: #ffffff;
  --positive: #16a34a;
  --positive-soft: #f0fdf4;
  --positive-border: #bbf7d0;
  --warning: #d97706;
  --danger: #dc2626;
  --danger-soft: #fef2f2;
  --focus-ring: rgba(79, 70, 229, 0.15);
  color-scheme: light;
  margin: 0 auto;
  max-width: 1100px;
  padding: 0 24px 48px;
  background: #ffffff;
  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.45;
}
body.arkisto > nav {
  display: flex;
  gap: 20px;
  align-items: baseline;
  padding: 14px 0;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--border-strong);
}
body.arkisto > nav a { color: var(--accent); text-decoration: none; }
body.arkisto > nav a:first-child { font-weight: 600; margin-right: auto; }
body.arkisto > nav a:hover { text-decoration: underline; }
/* Käsin kirjoitettu sisältö (etusivu, varmenne, raporttisivun otsikko): kerätyn sovellus-CSS:n
   Tailwind-preflight nollaa otsikot, listat, marginaalit ja linkit, joten ne palautetaan tässä.
   Kerrostamattomina säännöt voittavat preflightin; .arkistoteksti-rajaus pitää ne erossa
   uudelleenkäytettyjen komponenttien omista (utilities-kerroksen) luokista. */
body.arkisto .arkistoteksti h1 { font-size: 22px; font-weight: 600; line-height: 1.25; margin: 0 0 6px; }
body.arkisto .arkistoteksti h2 { font-size: 17px; font-weight: 600; line-height: 1.3; margin: 18px 0 10px; }
body.arkisto .arkistoteksti h3 { font-size: 14.5px; font-weight: 600; margin: 24px 0 6px; }
body.arkisto .arkistoteksti p,
body.arkisto .arkistoteksti ul,
body.arkisto .arkistoteksti ol { margin: 0 0 10px; }
body.arkisto .arkistoteksti ul { list-style: disc; padding-left: 22px; }
body.arkisto .arkistoteksti ol { list-style: decimal; padding-left: 22px; }
body.arkisto .arkistoteksti li { margin: 2px 0; }
body.arkisto .arkistoteksti a { color: var(--accent); text-decoration: underline; }
body.arkisto .arkistoteksti .jakso { color: var(--text-muted); margin-bottom: 18px; }
body.arkisto .arkistoteksti .ytunnus { color: var(--text-muted); }
body.arkisto .arkistoteksti .info { margin-top: 32px; color: var(--text-muted); font-size: 12.5px; }
body.arkisto .arkistoteksti .varoitus {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--danger-soft);
  color: var(--danger);
  font-weight: 600;
}
body.arkisto .arkistoteksti .varoitukset { color: var(--danger); }
body.arkisto .arkistoteksti table.varmenne { border-collapse: collapse; margin: 12px 0 18px; }
body.arkisto .arkistoteksti table.varmenne th,
body.arkisto .arkistoteksti table.varmenne td {
  padding: 6px 18px 6px 0;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
body.arkisto .arkistoteksti table.varmenne th { font-weight: 600; color: var(--text-muted); }
body.arkisto .arkistoteksti code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  word-break: break-all;
}
body.arkisto > footer {
  margin-top: 40px;
  padding-top: 12px;
  border-top: 1px solid var(--border-strong);
  color: var(--text-muted);
  font-size: 12px;
}
@media print {
  body.arkisto { max-width: none; padding: 0; }
  body.arkisto > nav { display: none; }
  body.arkisto .arkistoteksti a { color: inherit; text-decoration: none; }
}
`;

/**
 * Sovelluksen käännetty CSS sellaisena kuin selain sen latasi (Tailwind-luokat ja `--text-muted`
 * ym. tunnukset). Arkki, jonka sääntöjä ei saa lukea (esim. toisen alkuperän tyylitiedosto),
 * ohitetaan. `@font-face`-säännöt jätetään pois: niiden `url(/assets/…)` on sovelluksen
 * absoluuttinen osoite, jota arkistossa ei ole, joten fontti putoaa tarkoituksella
 * järjestelmäfonttiin.
 */
export function kokoaSovelluksenCss(doc: Document = document): string {
  const osat: string[] = [];
  for (const arkki of Array.from(doc.styleSheets)) {
    let saannot: CSSRuleList;
    try {
      saannot = arkki.cssRules;
    } catch {
      continue;
    }
    for (const saanto of Array.from(saannot)) {
      if (saanto.type === CSSRule.FONT_FACE_RULE) continue;
      osat.push(saanto.cssText);
    }
  }
  return osat.join('\n');
}
