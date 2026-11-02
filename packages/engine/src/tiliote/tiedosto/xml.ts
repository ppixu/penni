import { TiliotetiedostoVirhe } from './yhteiset.js';

/** XML-elementti, josta nimiavaruuden etuliite on riisuttu. */
export interface XmlElementti {
  /** Paikallinen nimi ilman etuliitettä ('ns2:Ntry' → 'Ntry'). */
  nimi: string;
  attr: Record<string, string>;
  lapset: XmlElementti[];
  /** Elementin oma teksti (tekstisolmut ja CDATA yhdistettynä), reunoilta trimmattuna. */
  teksti: string;
}

const NIMEN_ALKU = /[^\s/>=<"']/;
const ENTITEETIT: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function paikallinenNimi(nimi: string): string {
  const i = nimi.indexOf(':');
  return i < 0 ? nimi : nimi.slice(i + 1);
}

/**
 * Lukee XML-tekstin elementtipuuksi ja palauttaa juurielementin. Tukee elementtejä, attribuutteja,
 * tekstiä, CDATAa, kommentteja, käsittelyohjeita sekä viittä esimääriteltyä entiteettiä ja
 * numeerisia merkkiviittauksia. DTD:tä ei tulkita (se ohitetaan). Virheellinen XML → VAARA_MUOTO.
 */
export function lueXml(teksti: string): XmlElementti {
  let i = teksti.charCodeAt(0) === 0xfeff ? 1 : 0;
  const pituus = teksti.length;

  const virhe = (viesti: string, kohta: number = i): TiliotetiedostoVirhe => {
    let rivi = 1;
    const loppu = Math.min(kohta, pituus);
    for (let k = teksti.indexOf('\n'); k >= 0 && k < loppu; k = teksti.indexOf('\n', k + 1)) rivi++;
    return new TiliotetiedostoVirhe('VAARA_MUOTO', `Virheellinen XML: ${viesti}`, rivi);
  };

  const pura = (s: string, kohta: number): string =>
    s.indexOf('&') < 0
      ? s
      : s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (kokonainen, nimi: string) => {
          if (nimi.startsWith('#')) {
            const koodi =
              nimi[1] === 'x'
                ? Number.parseInt(nimi.slice(2), 16)
                : Number.parseInt(nimi.slice(1), 10);
            if (!Number.isInteger(koodi) || koodi < 0 || koodi > 0x10ffff)
              throw virhe(`virheellinen merkkiviittaus ${kokonainen}`, kohta);
            return String.fromCodePoint(koodi);
          }
          const arvo = ENTITEETIT[nimi];
          if (arvo === undefined) throw virhe(`tuntematon entiteetti ${kokonainen}`, kohta);
          return arvo;
        });

  const ohitaValit = () => {
    while (i < pituus && /\s/.test(teksti.charAt(i))) i++;
  };

  const lueNimi = (): string => {
    const alku = i;
    while (i < pituus && NIMEN_ALKU.test(teksti.charAt(i))) i++;
    if (i === alku) throw virhe('odotettiin nimeä');
    return teksti.slice(alku, i);
  };

  interface Kesken {
    elementti: XmlElementti;
    nimi: string;
    palat: string[];
  }
  const pino: Kesken[] = [];
  let juuri: XmlElementti | undefined;

  const sulje = (k: Kesken) => {
    k.elementti.teksti = k.palat.join('').trim();
  };

  while (i < pituus) {
    const lt = teksti.indexOf('<', i);
    const ylin = pino[pino.length - 1];
    const loppu = lt < 0 ? pituus : lt;
    if (loppu > i) {
      const palat = teksti.slice(i, loppu);
      if (ylin) ylin.palat.push(pura(palat, i));
      else if (palat.trim() !== '') throw virhe('tekstiä juurielementin ulkopuolella');
      i = loppu;
    }
    if (lt < 0) break;

    if (teksti.startsWith('<!--', i)) {
      const p = teksti.indexOf('-->', i + 4);
      if (p < 0) throw virhe('kommentti on päättämättä');
      i = p + 3;
    } else if (teksti.startsWith('<![CDATA[', i)) {
      const p = teksti.indexOf(']]>', i + 9);
      if (p < 0) throw virhe('CDATA on päättämättä');
      if (!ylin) throw virhe('CDATA juurielementin ulkopuolella');
      ylin.palat.push(teksti.slice(i + 9, p));
      i = p + 3;
    } else if (teksti.startsWith('<?', i)) {
      const p = teksti.indexOf('?>', i + 2);
      if (p < 0) throw virhe('käsittelyohje on päättämättä');
      i = p + 2;
    } else if (teksti.startsWith('<!', i)) {
      // DOCTYPE: ohitetaan sisäkkäiset hakasulkeet huomioiden.
      let syvyys = 0;
      let p = i + 2;
      for (; p < pituus; p++) {
        const m = teksti.charAt(p);
        if (m === '[') syvyys++;
        else if (m === ']') syvyys--;
        else if (m === '>' && syvyys <= 0) break;
      }
      if (p >= pituus) throw virhe('DOCTYPE on päättämättä');
      i = p + 1;
    } else if (teksti.startsWith('</', i)) {
      i += 2;
      const nimi = lueNimi();
      ohitaValit();
      if (teksti.charAt(i) !== '>') throw virhe('päättötagi on virheellinen');
      i++;
      const k = pino.pop();
      if (!k) throw virhe(`odottamaton päättötagi </${nimi}>`);
      if (k.nimi !== nimi) throw virhe(`päättötagi </${nimi}> ei vastaa tagia <${k.nimi}>`);
      sulje(k);
    } else {
      const tagiAlku = i;
      i++;
      const kokoNimi = lueNimi();
      const attr: Record<string, string> = {};
      let tyhja = false;
      for (;;) {
        ohitaValit();
        if (i >= pituus) throw virhe(`tagi <${kokoNimi}> on päättämättä`, tagiAlku);
        const m = teksti.charAt(i);
        if (m === '>') {
          i++;
          break;
        }
        if (m === '/' && teksti.charAt(i + 1) === '>') {
          i += 2;
          tyhja = true;
          break;
        }
        const attrNimi = lueNimi();
        ohitaValit();
        if (teksti.charAt(i) !== '=') throw virhe(`attribuutilta ${attrNimi} puuttuu arvo`);
        i++;
        ohitaValit();
        const lainaus = teksti.charAt(i);
        if (lainaus !== '"' && lainaus !== "'") throw virhe(`attribuutin ${attrNimi} arvo puuttuu`);
        const p = teksti.indexOf(lainaus, i + 1);
        if (p < 0) throw virhe(`attribuutin ${attrNimi} arvo on päättämättä`);
        attr[attrNimi] = pura(teksti.slice(i + 1, p), i);
        i = p + 1;
      }
      const elementti: XmlElementti = {
        nimi: paikallinenNimi(kokoNimi),
        attr,
        lapset: [],
        teksti: '',
      };
      if (ylin) ylin.elementti.lapset.push(elementti);
      else if (juuri) throw virhe('useampi juurielementti', tagiAlku);
      else juuri = elementti;
      if (!tyhja) pino.push({ elementti, nimi: kokoNimi, palat: [] });
    }
  }

  const kesken = pino[pino.length - 1];
  if (kesken) throw virhe(`tagi <${kesken.nimi}> on päättämättä`, pituus);
  if (!juuri) throw virhe('tiedostossa ei ole elementtejä');
  return juuri;
}

/** Ensimmäinen lapsi annettua polkua pitkin (paikallisilla nimillä). */
export function lapsi(e: XmlElementti | undefined, ...polku: string[]): XmlElementti | undefined {
  let nykyinen = e;
  for (const nimi of polku) {
    if (!nykyinen) return undefined;
    nykyinen = nykyinen.lapset.find((l) => l.nimi === nimi);
  }
  return nykyinen;
}

/** Kaikki suorat lapset annetulla nimellä. */
export function lapset(e: XmlElementti | undefined, nimi: string): XmlElementti[] {
  return e ? e.lapset.filter((l) => l.nimi === nimi) : [];
}

/** Polun päässä olevan elementin teksti; undefined kun elementtiä ei ole. */
export function teksti(e: XmlElementti | undefined, ...polku: string[]): string | undefined {
  return lapsi(e, ...polku)?.teksti;
}
