import type { VertailuTulos } from './vertaa.js';

export interface Ajo {
  nimi: string;
  tulokset: VertailuTulos[];
}

export interface Kattavuus {
  tekstiPdf: number;
  ocr: number;
  eiKuitti: number;
  monimutkainen: number;
  /** Malli vastasi vain thinking-kenttään, content jäi tyhjäksi (num_predict loppui). */
  visioBudjetti: number;
  /** Malli palautti tyhjän vastauksen ilman ajattelua. */
  visioTyhja: number;
  /** Kutsu (HTTP/verkko/aikakatkaisu) epäonnistui. */
  visioVirhe: number;
  /** Malli vastasi, mutta vastaus ei jäsentynyt JSON:ksi edes korjausyrityksen jälkeen. */
  visioJasennys: number;
  /** Malli vastasi kelvollisella JSON:lla joka jäsentyi, mutta josta puuttui käyttökelpoinen
   *  summa (esim. `{}` tai `bruttoSumma` puuttuu) — onnistunut kutsu, epäonnistunut luku.
   *  Näkymätön ilman tätä laskuria: se ei osu mihinkään muuhun visio-luokkaan. */
  visioVajaa: number;
}

/** Tiliote-täsmäytyksen diagnostiikka: luokkajakauma + täsmäytystarkkuus. */
export interface TilioteDiagnostiikka {
  tasmays: number;
  nimitasmays: number;
  kuittiPuuttuu: number;
  omaPaaoma: number;
  tasmaysOikein: number;
  tasmaysVaarin: number;
  eiTasmatty: number;
  eiKohdetta: number;
}

interface KenttaYhteenveto {
  ok: number;
  yhteensa: number;
}

interface AjoYhteenveto {
  nimi: string;
  kentat: Record<string, KenttaYhteenveto>;
  taysin: number;
  /** Tositteita joiden luku onnistui (ei päätynyt `lisaaLuenta`:n yhden `luku`-kentän
   *  virherivinä) — eri sarakkeilla eri nimittäjä per-kenttä-%:lle, joten tämä tekee sen
   *  näkyväksi sen sijaan että se hukkuisi. */
  luettu: number;
  yhteensa: number;
}

/** `lisaaLuenta` (index.ts) ja `epaonnistunutTulos` (vertaa.ts) merkitsevät epäonnistuneen
 *  luvun/vertailun yhden `luku`-nimisellä kentällä — todellinen `Kuitti`-kenttä ei koskaan
 *  ole tämän niminen (ks. `vertaa.ts`: pvm/myyja/brutto/alv/menotili *). */
const onLukuvirhe = (t: VertailuTulos): boolean =>
  t.kentat.length === 1 && t.kentat[0]?.nimi === 'luku';

function yhteenvedaAjo(ajo: Ajo): AjoYhteenveto {
  const kentat: Record<string, KenttaYhteenveto> = {};
  let luettu = 0;
  for (const tulos of ajo.tulokset) {
    if (!onLukuvirhe(tulos)) luettu += 1;
    for (const k of tulos.kentat) {
      if (!kentat[k.nimi]) {
        kentat[k.nimi] = { ok: 0, yhteensa: 0 };
      }
      const s = kentat[k.nimi];
      if (s) {
        s.yhteensa += 1;
        if (k.ok) s.ok += 1;
      }
    }
  }
  return {
    nimi: ajo.nimi,
    kentat,
    taysin: ajo.tulokset.filter((t) => t.taysinTasmaa).length,
    luettu,
    yhteensa: ajo.tulokset.length,
  };
}

/** Prosentti YHDESSÄ nimittäjän kanssa — eri sarakkeilla on eri nimittäjä (vain rivit joilta
 *  kenttä luettiin), joten pelkkä % ilman (ok/yhteensä)-lukua peittäisi juuri sen sarakkeen
 *  joka epäonnistui useimmin lukemaan (ks. loppukatselmus finding #1). */
const pros = (s: KenttaYhteenveto): string =>
  s.yhteensa === 0 ? '—' : `${Math.round((100 * s.ok) / s.yhteensa)}% (${s.ok}/${s.yhteensa})`;

function renderKonsoli(ajot: AjoYhteenveto[], kattavuus: Kattavuus): string {
  const kentat = [...new Set(ajot.flatMap((a) => Object.keys(a.kentat)))];
  const rivit: string[] = [];
  rivit.push(
    `Kattavuus: teksti-pdf ${kattavuus.tekstiPdf}, ocr ${kattavuus.ocr}, ei-kuitti ${kattavuus.eiKuitti}, monimutkainen ${kattavuus.monimutkainen}, visio-budjetti ${kattavuus.visioBudjetti}, visio-tyhjä ${kattavuus.visioTyhja}, visio-jäsennys ${kattavuus.visioJasennys}, visio-vajaa ${kattavuus.visioVajaa}, visio-virhe ${kattavuus.visioVirhe}`,
  );
  rivit.push('');
  const otsikko = ['kenttä', ...ajot.map((a) => a.nimi)].join('\t');
  rivit.push(otsikko);
  rivit.push(['luettu', ...ajot.map((a) => `${a.luettu}/${a.yhteensa}`)].join('\t'));
  for (const kentta of kentat) {
    rivit.push(
      [kentta, ...ajot.map((a) => pros(a.kentat[kentta] ?? { ok: 0, yhteensa: 0 }))].join('\t'),
    );
  }
  rivit.push(['täysin täsmää', ...ajot.map((a) => `${a.taysin}/${a.yhteensa}`)].join('\t'));
  return rivit.join('\n');
}

function renderMd(ajot: AjoYhteenveto[], kattavuus: Kattavuus): string {
  const kentat = [...new Set(ajot.flatMap((a) => Object.keys(a.kentat)))];
  const rivit: string[] = ['# Kuitti-validoinnin tulokset', ''];
  rivit.push('## Kattavuus', '');
  rivit.push(`- teksti-pdf: ${kattavuus.tekstiPdf}`);
  rivit.push(`- ocr: ${kattavuus.ocr}`);
  rivit.push(`- ei-kuitti (poissuljettu): ${kattavuus.eiKuitti}`);
  rivit.push(`- monimutkainen (poissuljettu): ${kattavuus.monimutkainen}`);
  rivit.push(`- visio-budjetti (malli katkesi ajatteluun): ${kattavuus.visioBudjetti}`);
  rivit.push(`- visio-tyhjä: ${kattavuus.visioTyhja}`);
  rivit.push(
    `- visio-jäsennys (vastaus ei jäsentynyt JSON:ksi korjausyrityksenkään jälkeen): ${kattavuus.visioJasennys}`,
  );
  rivit.push(
    `- visio-vajaa (malli vastasi ja JSON jäsentyi, mutta summa puuttui): ${kattavuus.visioVajaa}`,
  );
  rivit.push(`- visio-virhe (kutsu epäonnistui): ${kattavuus.visioVirhe}`, '');
  rivit.push('## Kenttäkohtainen osuus', '');
  rivit.push(['| kenttä', ...ajot.map((a) => a.nimi), '|'].join(' | '));
  rivit.push(['| ---', ...ajot.map(() => '---'), '|'].join(' | '));
  rivit.push(['|', 'luettu', ...ajot.map((a) => `${a.luettu}/${a.yhteensa}`), '|'].join(' | '));
  for (const kentta of kentat) {
    rivit.push(
      ['|', kentta, ...ajot.map((a) => pros(a.kentat[kentta] ?? { ok: 0, yhteensa: 0 })), '|'].join(
        ' | ',
      ),
    );
  }
  rivit.push(
    ['|', 'täysin täsmää', ...ajot.map((a) => `${a.taysin}/${a.yhteensa}`), '|'].join(' | '),
  );
  return rivit.join('\n');
}

function renderDiagnostiikka(d: TilioteDiagnostiikka): string {
  const osui = d.tasmaysOikein + d.tasmaysVaarin + d.eiTasmatty;
  const tarkkuus = osui === 0 ? '—' : `${Math.round((100 * d.tasmaysOikein) / osui)}%`;
  return [
    '',
    '## Täsmäytysdiagnostiikka (polku B)',
    '',
    `- tasmays: ${d.tasmays}`,
    `- nimitasmays: ${d.nimitasmays}`,
    `- kuittiPuuttuu: ${d.kuittiPuuttuu}`,
    `- omaPaaoma: ${d.omaPaaoma}`,
    `- täsmäytystarkkuus (oikein/[oikein+väärin+ei-täsmätty]): ${d.tasmaysOikein}/${osui} = ${tarkkuus}`,
    `- eiTasmatty (oikea tapahtuma olemassa, matcher ei parittanut): ${d.eiTasmatty}`,
    `- eiKohdetta (kuitin pankkitapahtumaa ei tiliotteella): ${d.eiKohdetta}`,
    '- HUOM: B-sarakkeet kattavat vain täsmätyt parit; ei-täsmätyt kuitit puuttuvat B:stä (sarakekohtainen N näkyy "täysin täsmää" -rivillä).',
  ].join('\n');
}

/** Aggregate runs into console text, markdown, and JSON; optional path-B täsmäytysdiagnostiikka. */
export function muodostaRaportti(
  ajot: readonly Ajo[],
  kattavuus: Kattavuus,
  diagnostiikka?: TilioteDiagnostiikka,
): { konsoli: string; md: string; json: unknown } {
  const yhteenvedot = ajot.map(yhteenvedaAjo);
  const md = diagnostiikka
    ? `${renderMd(yhteenvedot, kattavuus)}\n${renderDiagnostiikka(diagnostiikka)}`
    : renderMd(yhteenvedot, kattavuus);
  const konsoli = diagnostiikka
    ? `${renderKonsoli(yhteenvedot, kattavuus)}\n\nTäsmäytys: tasmays ${diagnostiikka.tasmays}, nimitasmays ${diagnostiikka.nimitasmays}, kuittiPuuttuu ${diagnostiikka.kuittiPuuttuu}, omaPaaoma ${diagnostiikka.omaPaaoma}, eiTasmatty ${diagnostiikka.eiTasmatty}, tarkkuus ${diagnostiikka.tasmaysOikein}/${diagnostiikka.tasmaysOikein + diagnostiikka.tasmaysVaarin + diagnostiikka.eiTasmatty}`
    : renderKonsoli(yhteenvedot, kattavuus);
  const json: Record<string, unknown> = {
    kattavuus,
    ajot: yhteenvedot,
    tositteet: ajot.map((a) => ({ nimi: a.nimi, tulokset: a.tulokset })),
  };
  if (diagnostiikka) json.diagnostiikka = diagnostiikka;
  return { konsoli, md, json };
}
