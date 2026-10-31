// SPIKE: Q3-tiliotteiden luku pdf.js:llä vs. kirjan pankkitilin 1910 viennit.
import { lueTiliotePdf } from '@penni/luku';
import Database from 'better-sqlite3';
import { vaadi } from './vaadi.js';
const db = new Database(vaadi(process.argv[2]), { readonly: true });
const liitteet = db
  .prepare(
    "SELECT l.nimi, l.data FROM liite l JOIN tosite t ON t.id=l.tosite WHERE t.tyyppi=400 AND t.pvm BETWEEN '2026-07-01' AND '2026-09-30' ORDER BY t.pvm",
  )
  .all() as { nimi: string; data: Buffer }[];
const kirja = db
  .prepare(
    'SELECT v.pvm, v.debetsnt - v.kreditsnt AS m FROM vienti v JOIN tosite t ON t.id=v.tosite WHERE v.tili=1910 AND t.tila>=100 AND v.pvm BETWEEN ? AND ?',
  )
  .all.bind(
    db.prepare(
      'SELECT v.pvm, v.debetsnt - v.kreditsnt AS m FROM vienti v JOIN tosite t ON t.id=v.tosite WHERE v.tili=1910 AND t.tila>=100 AND v.pvm BETWEEN ? AND ?',
    ),
  );
for (const l of liitteet) {
  const t = await lueTiliotePdf(new Uint8Array(l.data));
  const pvms = t.tapahtumat.map((x) => x.pvm).sort();
  const rivit = kirja(pvms[0], pvms.at(-1)) as { pvm: string; m: number }[];
  const summa = t.tapahtumat.reduce((s, x) => s + x.maara, 0);
  const kirjaSumma = rivit.reduce((s, x) => s + x.m, 0);
  const pankki = [...t.tapahtumat.map((x) => `${x.pvm}:${x.maara}`)].sort();
  const kirjaan = [...rivit.map((x) => `${x.pvm}:${x.m}`)].sort();
  const puuttuu = pankki.filter((x) => !kirjaan.includes(x));
  console.log(
    `${l.nimi}: ${t.tapahtumat.length} tapahtumaa (kirjassa ${rivit.length}), liike ${summa / 100} € (kirja ${kirjaSumma / 100} €), alku ${(t.alkusaldo ?? Number.NaN) / 100} + liike = ${((t.alkusaldo ?? 0) + summa) / 100} vs loppu ${(t.loppusaldo ?? Number.NaN) / 100}; ei kirjassa samalla pvm+summalla: ${puuttuu.join(', ') || '–'}`,
  );
}
