import { type Cents, Euro } from '@penni/euro';
import type { IsoDate } from '../vouchers/types.js';
import { onkoPvmValidi } from '../vouchers/types.js';
import type { Kuitti, KuittiAlvEra } from './kuitti.js';

export type JasennysTulos = { ok: true; kuitti: Kuitti } | { ok: false; virhe: string };

/** Poimii JSON-lohkon: poistaa ```-aidat ja ottaa uloimman { … }. */
function poimiJson(teksti: string): string | undefined {
  const puhdas = teksti.replace(/```json/gi, '').replace(/```/g, '');
  const alku = puhdas.indexOf('{');
  const loppu = puhdas.lastIndexOf('}');
  if (alku === -1 || loppu === -1 || loppu < alku) return undefined;
  return puhdas.slice(alku, loppu + 1);
}

/**
 * Korjaa pienten mallien yleisen JSON-virheen: lainausmerkittömät pilkkudesimaalit
 * (esim. "netto": 5,61) kaatavat JSON.parsen. Muunnetaan pilkku pisteeksi vain
 * numeroiden välissä arvopaikassa (kaksoispisteen jälkeen) ja vain arvon päättävän
 * erottimen (, } ]) edellä, jotta merkkijonojen sisältö ja rakenteelliset pilkut
 * säilyvät ennallaan. Lainausmerkeissä olevat pilkkudesimaalit hoitaa jo Euro.fromString.
 */
function korjaaPilkkuDesimaalit(json: string): string {
  return json.replace(/(:\s*\d+),(\d+)(?=\s*[,}\]])/g, '$1.$2');
}

/** Suomalainen päiväys 'D.M.YYYY' → ISO 'YYYY-MM-DD'; muut arvot palautetaan siistittyinä. */
export function normalisoiPvm(s: string): string {
  const t = s.trim();
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (!m) return t;
  const paiva = m[1]?.padStart(2, '0');
  const kuukausi = m[2]?.padStart(2, '0');
  const vuosi = m[3];
  if (!paiva || !kuukausi || !vuosi) return t;
  return `${vuosi}-${kuukausi}-${paiva}`;
}

/** Raha-arvo (luku euroina tai merkkijono) → sentit; undefined jos ei kelpaa. */
function rahaSenteiksi(arvo: unknown): Cents | undefined {
  const s =
    typeof arvo === 'number' && Number.isFinite(arvo)
      ? String(arvo)
      : typeof arvo === 'string' && arvo.trim() !== ''
        ? arvo.trim()
        : undefined;
  if (s === undefined) return undefined;
  try {
    const sentit = Euro.fromString(s);
    return Number.isFinite(sentit) ? sentit : undefined;
  } catch {
    return undefined;
  }
}

/** Muuntaa näkömallin raakatulosteen validoiduksi Kuitti-rakenteeksi. */
export function jasennaKuitti(raakateksti: string): JasennysTulos {
  const json = poimiJson(raakateksti);
  if (json === undefined) return { ok: false, virhe: 'Tulosteesta ei löytynyt JSON-lohkoa.' };
  let obj: unknown;
  try {
    obj = JSON.parse(korjaaPilkkuDesimaalit(json));
  } catch {
    return { ok: false, virhe: 'JSON-jäsennys epäonnistui.' };
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { ok: false, virhe: 'JSON ei ole objekti.' };
  }
  const r = obj as Record<string, unknown>;

  // Malli tuottaa yhden kannan joskus oliona taulukon sijaan — käsitellään molemmat.
  const alvLahde: unknown[] = Array.isArray(r.alv)
    ? r.alv
    : r.alv !== null && typeof r.alv === 'object'
      ? [r.alv]
      : [];
  const alv: KuittiAlvEra[] = [];
  for (const e of alvLahde) {
    if (typeof e !== 'object' || e === null) continue;
    const er = e as Record<string, unknown>;
    const kanta =
      typeof er.kanta === 'number'
        ? er.kanta
        : typeof er.kanta === 'string'
          ? Number.parseFloat(er.kanta)
          : Number.NaN;
    if (!Number.isFinite(kanta)) continue;
    const rivi: KuittiAlvEra = { kanta };
    const netto = rahaSenteiksi(er.netto);
    const vero = rahaSenteiksi(er.vero);
    const brutto = rahaSenteiksi(er.brutto);
    if (netto !== undefined) rivi.netto = netto;
    if (vero !== undefined) rivi.vero = vero;
    if (brutto !== undefined) rivi.brutto = brutto;
    alv.push(rivi);
  }

  const kuitti: Kuitti = {
    valuutta:
      typeof r.valuutta === 'string' && r.valuutta.trim() !== ''
        ? r.valuutta.trim().toUpperCase()
        : 'EUR',
    alv,
  };
  if (typeof r.myyja === 'string' && r.myyja.trim() !== '') kuitti.myyja = r.myyja.trim();
  if (typeof r.ytunnus === 'string' && r.ytunnus.trim() !== '') kuitti.ytunnus = r.ytunnus.trim();
  if (typeof r.pvm === 'string') {
    const pvm = normalisoiPvm(r.pvm);
    if (onkoPvmValidi(pvm)) kuitti.pvm = pvm as IsoDate;
  }
  const brutto = rahaSenteiksi(r.bruttoSumma);
  if (brutto !== undefined) kuitti.bruttoSumma = brutto;
  if (typeof r.luottamus === 'number' && Number.isFinite(r.luottamus))
    kuitti.luottamus = r.luottamus;

  return { ok: true, kuitti };
}
