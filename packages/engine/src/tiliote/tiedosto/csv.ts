import { type Cents, Euro } from '@penni/euro';
import type { IsoDate } from '../../vouchers/types.js';
import type { Tiliote } from '../poimiKuukausitiliote.js';
import type { Tilitapahtuma } from '../poimiTiliote.js';
import { TiliotetiedostoVirhe } from './yhteiset.js';

/** CSV-tiedoston päivämäärän muoto. */
export type PvmMuoto = 'd.m.yyyy' | 'yyyy-mm-dd' | 'yyyy/mm/dd' | 'd/m/yyyy';

/**
 * Mitä kukin CSV:n sarake (indeksi 0:sta) tarkoittaa. Rahamäärä on joko `maara` tai pari
 * `debet` (raha ulos) + `kredit` (raha sisään), ei molempia.
 */
export interface CsvSarakkeet {
  pvm: number;
  pvmMuoto: PvmMuoto;
  maara?: number;
  debet?: number;
  kredit?: number;
  /** Nimisarakkeet: ensimmäinen ei-tyhjä voittaa. */
  nimi: number[];
  /** Etumerkin mukainen nimi: plus-tapahtumalla maksaja, miinus-tapahtumalla saaja; sitten `nimi`. */
  maksaja?: number;
  saaja?: number;
  /** Viestisarakkeet: ei-tyhjät yhdistetään välilyönnillä. */
  viesti: number[];
  viite?: number;
  arkistotunnus?: number;
  iban?: number;
  saldo?: number;
  /** Valuuttasarake: ei-tyhjän arvon on oltava EUR. */
  valuutta?: number;
}

/** Jaettu CSV: otsikkorivi ja sen alapuolen datarivit (tyhjät rivit pois). */
export interface CsvTaulukko {
  otsikot: string[];
  rivit: string[][];
  /** Otsikkorivin rivinumero tiedostossa (1 = ensimmäinen). */
  otsikkorivi: number;
}

type Erotin = ';' | ',' | '\t';

interface Rivi {
  solut: string[];
  /** Rivinumero tiedostossa (1 = ensimmäinen). */
  rivi: number;
}

interface Jaettu {
  otsikot: string[];
  otsikkorivi: number;
  rivit: Rivi[];
}

/** Erottimien `;` `,` ja sarkainten määrät rivillä lainausmerkkien ulkopuolelta. */
function erotinMaarat(rivi: string): Record<Erotin, number> {
  const maarat: Record<Erotin, number> = { ';': 0, ',': 0, '\t': 0 };
  let lainattu = false;
  for (const m of rivi) {
    if (m === '"') lainattu = !lainattu;
    if (lainattu) continue;
    if (m === ';' || m === ',' || m === '\t') maarat[m]++;
  }
  return maarat;
}

/**
 * Erottimen haistelu. Kitsas (`CsvTuonti::haistaErotin`, csvtuonti.cpp:418-448) laskee
 * erottimet ensimmäiseltä riviltä, mutta johdantorivin pilkku ('Tili FI.., Testi Oy') johtaisi
 * harhaan. Siksi katsotaan enintään 20 ensimmäistä ei-tyhjää riviä: kullekin erottimelle sen
 * tavallisin nollasta poikkeava määrä rivillä ja montako riviä siihen osuu. Eniten rivejä
 * yhtenäisesti jakava erotin voittaa; tasapelissä ratkaisee Kitsaksen sääntö noilla määrillä
 * (puolipiste voittaa tasatilanteen).
 */
function haistaErotin(rivit: readonly string[]): Erotin {
  const otos = rivit
    .filter((r) => r.trim() !== '')
    .slice(0, 20)
    .map(erotinMaarat);
  const tulos = ([';', ',', '\t'] as const).map((erotin) => {
    const kerrat = new Map<number, number>();
    for (const m of otos)
      if (m[erotin] > 0) kerrat.set(m[erotin], (kerrat.get(m[erotin]) ?? 0) + 1);
    let maara = 0;
    let riveja = 0;
    for (const [n, k] of kerrat)
      if (k > riveja || (k === riveja && n > maara)) {
        maara = n;
        riveja = k;
      }
    return { erotin, maara, riveja };
  });
  const paras = Math.max(...tulos.map((t) => t.riveja));
  const maara = (e: Erotin): number => {
    const t = tulos.find((x) => x.erotin === e);
    return t && t.riveja === paras ? t.maara : 0;
  };
  const puolipisteet = maara(';');
  const pilkut = maara(',');
  const sarkaimet = maara('\t');
  if (puolipisteet >= pilkut && puolipisteet > sarkaimet) return ';';
  if (sarkaimet > pilkut && sarkaimet > puolipisteet) return '\t';
  return ',';
}

/**
 * Yhden rivin jako soluiksi kuten Kitsas `CsvTuonti::csvListana` (csvtuonti.cpp:450-500):
 * lainausmerkit suojaavat erottimen, lainauksen sisällä `""` on kirjaimellinen lainausmerkki.
 */
function jaaRivi(rivi: string, erotin: Erotin): string[] {
  const solut: string[] = [];
  let sana = '';
  let lainattu = false;
  for (let i = 0; i < rivi.length; i++) {
    const m = rivi[i];
    if (m === '"') {
      if (lainattu && rivi[i + 1] === '"') {
        sana += '"';
        i++;
      } else lainattu = !lainattu;
    } else if (!lainattu && m === erotin) {
      solut.push(sana.trim());
      sana = '';
    } else sana += m;
  }
  solut.push(sana.trim());
  return solut;
}

/** Tiedoston ei-tyhjät rivit soluiksi jaettuina, rivinumeroineen. */
function jaaRivit(teksti: string): Rivi[] {
  const rivit = teksti.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const erotin = haistaErotin(rivit);
  const tulos: Rivi[] = [];
  rivit.forEach((r, i) => {
    if (r.trim() !== '') tulos.push({ solut: jaaRivi(r, erotin), rivi: i + 1 });
  });
  return tulos;
}

/**
 * Otsikkorivin paikka: ensimmäinen rivi, jonka sarakemäärä on tiedoston tavallisin (johdanto
 * ohitetaan). OP:n otsikko päättyy erottimeen, joten tavallisinta yhtä pidempi rivi, jonka
 * viimeinen solu on tyhjä, kelpaa myös (vrt. csvtuonti.cpp:599-603).
 */
function otsikonIndeksi(rivit: readonly Rivi[]): number {
  const maarat = new Map<number, number>();
  for (const r of rivit) maarat.set(r.solut.length, (maarat.get(r.solut.length) ?? 0) + 1);
  let tavallisin = 0;
  let kerrat = 0;
  for (const [maara, n] of maarat)
    if (n > kerrat || (n === kerrat && maara > tavallisin)) {
      tavallisin = maara;
      kerrat = n;
    }
  return rivit.findIndex(
    (r) =>
      r.solut.length === tavallisin ||
      (r.solut.length === tavallisin + 1 && r.solut[r.solut.length - 1] === ''),
  );
}

const normalisoiOtsikko =
  (pienaakkosin: boolean) =>
  (s: string): string => {
    const t = s.replace(/^\uFEFF/, '').trim();
    return pienaakkosin ? t.toLowerCase() : t;
  };

function jaa(teksti: string): Jaettu {
  const rivit = jaaRivit(teksti);
  const indeksi = otsikonIndeksi(rivit);
  const otsikko = rivit[indeksi];
  if (!otsikko) throw new TiliotetiedostoVirhe('VAARA_MUOTO', 'CSV-tiedosto on tyhjä');
  const otsikot = otsikko.solut.map(normalisoiOtsikko(false));
  while (otsikot.length > 1 && otsikot[otsikot.length - 1] === '') otsikot.pop();
  return { otsikot, otsikkorivi: otsikko.rivi, rivit: rivit.slice(indeksi + 1) };
}

/**
 * Onko teksti uskottava CSV (Kitsas `CsvTuonti::onkoCsv`, csvtuonti.cpp:577-608): ei paljon
 * ohjausmerkkejä, otsikon jälkeen vähintään yksi rivi, ja rivien sarakemäärät yhtenevät —
 * OP:n otsikon perässä oleva erotin sallitaan, samoin poikkeava viimeinen rivi (Kitsas ei
 * tarkista sitä, koska 4096 merkin ikkuna voi katkaista sen). Erona Kitsasiin otsikkoa
 * edeltävä johdanto sallitaan, ja ohjausmerkeiksi ei lasketa sarkainta eikä rivinvaihtoa
 * (teksti on jo dekoodattu, joten Kitsasin tavuvertailu ei sellaisenaan päde).
 */
export function onkoCsv(teksti: string): boolean {
  const alku = teksti.slice(0, 1024);
  let ohjaus = 0;
  for (const m of alku) {
    const koodi = m.charCodeAt(0);
    if (koodi < 10 && m !== '\t') ohjaus++;
  }
  if (ohjaus > alku.length / 3) return false;

  const rivit = jaaRivit(teksti.slice(0, 4096));
  const indeksi = otsikonIndeksi(rivit);
  const lista = rivit.slice(Math.max(indeksi, 0)).map((r) => r.solut);
  const [otsikko] = lista;
  if (lista.length < 2 || !otsikko || otsikko.length < 2) return false;
  for (let i = 1; i < lista.length - 1; i++) {
    const edellinen = lista[i - 1] ?? [];
    const tama = lista[i] ?? [];
    const seuraava = lista[i + 1] ?? [];
    if (tama.length < 2 || tama.length !== edellinen.length)
      if (
        !(edellinen[edellinen.length - 1] === '' && edellinen.length === tama.length + 1) &&
        !(tama[tama.length - 1] === '' && tama.length === seuraava.length)
      )
        return false;
  }
  return true;
}

/** Jakaa CSV-tekstin otsikoiksi ja datariveiksi (erotin haistellaan, johdanto ohitetaan). */
export function jaaCsv(teksti: string): CsvTaulukko {
  const { otsikot, otsikkorivi, rivit } = jaa(teksti);
  return { otsikot, rivit: rivit.map((r) => r.solut), otsikkorivi };
}

/** Otsikkorivin vertailuavain: pienaakkosin, trimmattu, ilman BOM:ia, `|` välissä. */
export function otsikkoAvain(otsikot: readonly string[]): string {
  return otsikot.map(normalisoiOtsikko(true)).join('|');
}

/**
 * CSV:n rahamäärä sentteinä: välit sekä `€` ja `EUR` pois (muu valuutta on virhe), etumerkki
 * edessä tai perässä (`-12,50`, `12,50-`), desimaalierotin on viimeinen `.` tai `,`, jota seuraa
 * lopussa 1–2 numeroa; muut pisteet ja pilkut ovat tuhaterottimia.
 */
export function lueCsvSumma(s: string): Cents {
  let t = s.replace(/\s/g, '').replace(/€|EUR/gi, '');
  let etumerkki = '';
  const alussa = /^[+-]/.exec(t);
  if (alussa) {
    etumerkki = alussa[0];
    t = t.slice(1);
  } else if (/[+-]$/.test(t)) {
    etumerkki = t.slice(-1);
    t = t.slice(0, -1);
  }
  const m = /^(\d[\d.,]*?)(?:[.,](\d{1,2}))?$/.exec(t);
  const kokonaiset = m?.[1]?.replace(/[.,]/g, '');
  if (!m || !kokonaiset || !/^\d+$/.test(kokonaiset))
    throw new TiliotetiedostoVirhe('VAARA_MUOTO', `Virheellinen summa "${s.trim()}"`);
  const desimaalit = m[2] ?? '';
  return Euro.fromString(`${etumerkki === '-' ? '-' : ''}${kokonaiset}.${desimaalit}`);
}

/** Tuetut päivämäärämuodot. */
export const PVM_MUODOT: readonly PvmMuoto[] = ['d.m.yyyy', 'yyyy-mm-dd', 'yyyy/mm/dd', 'd/m/yyyy'];

const PVM: Record<PvmMuoto, { re: RegExp; v: number; k: number; p: number }> = {
  'd.m.yyyy': { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, v: 3, k: 2, p: 1 },
  'yyyy-mm-dd': { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, v: 1, k: 2, p: 3 },
  'yyyy/mm/dd': { re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, v: 1, k: 2, p: 3 },
  'd/m/yyyy': { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, v: 3, k: 2, p: 1 },
};

/** Päivämäärä annetussa muodossa → ISO-päivä, tai `undefined` jos ei kelpaa. */
export function lueCsvPvm(s: string, muoto: PvmMuoto): IsoDate | undefined {
  const { re, v, k, p } = PVM[muoto];
  const m = re.exec(s.trim());
  if (!m) return undefined;
  const vuosi = Number(m[v]);
  const kk = Number(m[k]);
  const pv = Number(m[p]);
  const paivia = new Date(Date.UTC(vuosi, kk, 0)).getUTCDate();
  if (kk < 1 || kk > 12 || pv < 1 || pv > paivia) return undefined;
  return `${vuosi}-${String(kk).padStart(2, '0')}-${String(pv).padStart(2, '0')}` as IsoDate;
}

/** Summa tai `undefined`, jos teksti ei ole rahamäärä. */
function summaTaiTyhja(s: string): Cents | undefined {
  try {
    return lueCsvSumma(s);
  } catch {
    return undefined;
  }
}

interface Luettu {
  rivi: number;
  solut: string[];
  pvm?: IsoDate;
  maara?: Cents;
}

/**
 * Poimii CSV-tiliotteen annetulla sarakejaolla. Tyhjät rivit ja viimeisen tapahtuman jälkeiset
 * alatunnisteet (päivä ja summa molemmat kelvottomia, esim. `Yhteensä;;;`) ohitetaan; muu
 * kelvoton rivi on virhe rivinumeroineen. Uusin ensin -tiedosto käännetään, rivit lajitellaan
 * vakaasti päivän mukaan, ja saldosarakkeen ketju tarkistetaan.
 */
export function poimiCsv(teksti: string, sarakkeet: CsvSarakkeet): Tiliote {
  const { otsikot, rivit } = jaa(teksti);
  const { maara, debet, kredit } = sarakkeet;
  const pari = debet !== undefined && kredit !== undefined;
  if ((maara === undefined) === !pari)
    throw new TiliotetiedostoVirhe(
      'CSV_SARAKKEET',
      'Valitse joko summasarake tai sekä debet- että kredit-sarake',
    );
  if (!Object.hasOwn(PVM, sarakkeet.pvmMuoto))
    throw new TiliotetiedostoVirhe('CSV_SARAKKEET', 'Tuntematon päivämäärän muoto');
  for (const i of [sarakkeet.pvm, maara, debet, kredit])
    if (i !== undefined && (i < 0 || i >= otsikot.length))
      throw new TiliotetiedostoVirhe('CSV_SARAKKEET', 'Sarakejako ei sovi tiedoston otsikkoon');

  const solu = (solut: readonly string[], i: number | undefined): string =>
    i === undefined ? '' : (solut[i] ?? '');
  const summanSolut = (solut: readonly string[]): string[] =>
    pari ? [solu(solut, debet), solu(solut, kredit)] : [solu(solut, maara)];
  const lueSumma = (solut: readonly string[]): Cents | undefined => {
    if (!pari) return summaTaiTyhja(solu(solut, maara));
    const d = solu(solut, debet);
    const k = solu(solut, kredit);
    if (d === '' && k === '') return undefined;
    const ds = d === '' ? (0 as Cents) : summaTaiTyhja(d);
    const ks = k === '' ? (0 as Cents) : summaTaiTyhja(k);
    if (ds === undefined || ks === undefined) return undefined;
    return Euro.sub(ks, Euro.abs(ds));
  };

  const luetut: Luettu[] = [];
  for (const { solut, rivi } of rivit) {
    if (solu(solut, sarakkeet.pvm) === '' && summanSolut(solut).every((s) => s === '')) continue;
    const l: Luettu = { rivi, solut };
    const pvm = lueCsvPvm(solu(solut, sarakkeet.pvm), sarakkeet.pvmMuoto);
    const summa = lueSumma(solut);
    if (pvm) l.pvm = pvm;
    if (summa !== undefined) l.maara = summa;
    luetut.push(l);
  }
  let viimeinen = -1;
  luetut.forEach((l, i) => {
    if (l.pvm && l.maara !== undefined) viimeinen = i;
  });

  const kelvot: Kelpo[] = [];
  luetut.forEach((l, i) => {
    const { pvm, maara: summa } = l;
    if (pvm && summa !== undefined) {
      kelvot.push({ ...l, pvm, maara: summa });
      return;
    }
    if (i > viimeinen && !pvm && summa === undefined) return; // alatunniste
    if (!pvm) {
      const s = solu(l.solut, sarakkeet.pvm);
      throw new TiliotetiedostoVirhe(
        'VAARA_MUOTO',
        s === '' ? 'Päivämäärä puuttuu' : `Virheellinen päivämäärä "${s}"`,
        l.rivi,
      );
    }
    const s = summanSolut(l.solut).filter((x) => x !== '');
    throw new TiliotetiedostoVirhe(
      'VAARA_MUOTO',
      s.length === 0 ? 'Summa puuttuu' : `Virheellinen summa "${s.join(' / ')}"`,
      l.rivi,
    );
  });

  const ensin = kelvot[0];
  const lopuksi = kelvot[kelvot.length - 1];
  if (!ensin || !lopuksi)
    throw new TiliotetiedostoVirhe('VAARA_MUOTO', 'CSV-tiedostossa ei ole tapahtumia');
  for (const l of kelvot) {
    const valuutta = solu(l.solut, sarakkeet.valuutta);
    if (valuutta !== '' && valuutta.toUpperCase() !== 'EUR')
      throw new TiliotetiedostoVirhe(
        'VALUUTTA',
        `Tiliotteen valuutta on ${valuutta}; vain euromääräisen tiliotteen voi tuoda`,
        l.rivi,
      );
  }

  // Uusin ensin -tiedosto (päivät eivät kasva missään kohdassa) käännetään ennen vakaata
  // lajittelua, jotta saman päivän rivit pysyvät todellisessa järjestyksessään.
  const laskeva =
    ensin.pvm > lopuksi.pvm && kelvot.every((l, i) => i === 0 || l.pvm <= (kelvot[i - 1] ?? l).pvm);
  let jarjestys = jarjesta(kelvot, laskeva);
  let saldot: Saldot | undefined;
  if (sarakkeet.saldo !== undefined) {
    // Saldoketju ratkaisee suunnan, kun päivät eivät sitä kerro (esim. kaikki rivit samalta
    // päivältä): jos päivien mukainen järjestys ei täsmää, kokeillaan käännettyä. Virhe
    // raportoidaan päivien mukaisesta järjestyksestä.
    const ketju = saldoketju(jarjestys, sarakkeet.saldo);
    if (ketju instanceof TiliotetiedostoVirhe) {
      const toinen = jarjesta(kelvot, !laskeva);
      const toisenKetju = saldoketju(toinen, sarakkeet.saldo);
      if (toisenKetju instanceof TiliotetiedostoVirhe) throw ketju;
      jarjestys = toinen;
      saldot = toisenKetju;
    } else saldot = ketju;
  }

  const tulos: Tiliote = {
    muoto: 'tapahtumat',
    kausi: { alkaa: (jarjestys[0] ?? ensin).pvm, loppuu: (jarjestys.at(-1) ?? lopuksi).pvm },
    tapahtumat: jarjestys.map((l) => tapahtuma(l.solut, l.pvm, l.maara, sarakkeet)),
    lahde: 'csv',
    kausiPaatelty: true,
  };
  if (saldot) {
    tulos.muoto = 'kuukausitiliote';
    tulos.alkusaldo = saldot.alkusaldo;
    tulos.loppusaldo = saldot.loppusaldo;
  }
  return tulos;
}

type Kelpo = Luettu & { pvm: IsoDate; maara: Cents };

/** Rivit tiedoston järjestyksessä tai käännettynä, sitten vakaasti päivän mukaan. */
function jarjesta(rivit: readonly Kelpo[], kaanna: boolean): Kelpo[] {
  const tulos = kaanna ? [...rivit].reverse() : [...rivit];
  return tulos.sort((a, b) => (a.pvm < b.pvm ? -1 : a.pvm > b.pvm ? 1 : 0));
}

interface Saldot {
  alkusaldo: Cents;
  loppusaldo: Cents;
}

/**
 * Saldoketju `saldo[i] = saldo[i-1] + maara[i]` annetussa järjestyksessä; tyhjä saldosolu
 * ohitetaan. Palauttaa saldot (`undefined`, jos yhtään saldoa ei ole) tai ketjun katkon
 * virheenä. Kelvoton saldo heitetään suoraan, koska se ei riipu järjestyksestä.
 */
function saldoketju(
  rivit: readonly Kelpo[],
  sarake: number,
): Saldot | TiliotetiedostoVirhe | undefined {
  let juokseva: Cents | undefined;
  let summaa = 0 as Cents;
  let alkusaldo: Cents | undefined;
  for (const l of rivit) {
    summaa = Euro.add(summaa, l.maara);
    if (juokseva !== undefined) juokseva = Euro.add(juokseva, l.maara);
    const s = (l.solut[sarake] ?? '').trim();
    if (s === '') continue;
    const saldo = summaTaiTyhja(s);
    if (saldo === undefined)
      throw new TiliotetiedostoVirhe('VAARA_MUOTO', `Virheellinen saldo "${s}"`, l.rivi);
    if (juokseva !== undefined && juokseva !== saldo)
      return new TiliotetiedostoVirhe(
        'VAARA_MUOTO',
        `Saldo "${s}" ei täsmää edellisen rivin saldoon ja tapahtuman summaan`,
        l.rivi,
      );
    if (alkusaldo === undefined) alkusaldo = Euro.sub(saldo, summaa);
    juokseva = saldo;
  }
  return alkusaldo !== undefined && juokseva !== undefined
    ? { alkusaldo, loppusaldo: juokseva }
    : undefined;
}

function tapahtuma(
  solut: readonly string[],
  pvm: IsoDate,
  maara: Cents,
  sarakkeet: CsvSarakkeet,
): Tilitapahtuma {
  const solu = (i: number | undefined): string => (i === undefined ? '' : (solut[i] ?? ''));
  const etumerkinNimi = maara > 0 ? sarakkeet.maksaja : maara < 0 ? sarakkeet.saaja : undefined;
  const nimi = [etumerkinNimi, ...sarakkeet.nimi].map(solu).find((s) => s !== '') ?? '';
  const t: Tilitapahtuma = { pvm, nimi, maara };
  const viesti = sarakkeet.viesti
    .map(solu)
    .filter((s) => s !== '')
    .join(' ');
  if (viesti) t.viesti = viesti;
  const viite = solu(sarakkeet.viite).replace(/\s/g, '');
  if (viite) t.viite = viite;
  const arkistotunnus = solu(sarakkeet.arkistotunnus);
  if (arkistotunnus) t.arkistotunnus = arkistotunnus;
  const iban = solu(sarakkeet.iban).replace(/\s/g, '').toUpperCase();
  if (iban) t.iban = iban;
  return t;
}
