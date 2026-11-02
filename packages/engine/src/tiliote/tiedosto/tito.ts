import { type Cents, Euro } from '@penni/euro';
import type { IsoDate } from '../../vouchers/types.js';
import type { Tiliote } from '../poimiKuukausitiliote.js';
import type { Tilitapahtuma } from '../poimiTiliote.js';
import { TiliotetiedostoVirhe, vvkkppIsoksi, yhdistaTiliotteet } from './yhteiset.js';

/*
 * TITO (konekielinen tiliote, Finanssialan palvelukuvaus v3.3, §3.4): kiinteämittaisia tietueita,
 * yksi per rivi. Kohdat alla ovat 1-pohjaisia; Kitsasin `mid()`-siirtymät (titotuonti.cpp) ovat
 * 0-pohjaisia ja täsmäävät näihin.
 */

/** Vanha ISO 646 -merkistö: ]=Å [=Ä \=Ö }=å {=ä |=ö (Kitsas titotuonti.cpp:34-39). */
const SEITSEMANBITTINEN: Record<string, string> = {
  ']': 'Å',
  '[': 'Ä',
  '\\': 'Ö',
  '}': 'å',
  '{': 'ä',
  '|': 'ö',
};
/** Mikä tahansa 8-bittinen merkki: tiedosto ei ole 7-bittinen, joten {|} ym. ovat sellaisenaan. */
const EI_ASCII = /[\u0080-\uFFFF]/;
const SEITSEMANBITTISET_MERKIT = /[\][\\{|}]/g;
const RF_VIITE = /^RF\d{2}[0-9A-Z ]+$/i;
/** Rivin tiiviit tyhjät yhdeksi väliksi (Kitsasin `simplified()`). */
const tiivista = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Kohdat `alku`–`loppu` (1-pohjaiset, molemmat mukaan); rivin lopun yli menevät kohdat ovat tyhjiä. */
function kentta(rivi: string, alku: number, loppu: number): string {
  return rivi.slice(alku - 1, loppu);
}

function virhe(viesti: string, rivi: number): TiliotetiedostoVirhe {
  return new TiliotetiedostoVirhe('VAARA_MUOTO', viesti, rivi);
}

function paiva(s: string, rivi: number): IsoDate {
  try {
    return vvkkppIsoksi(s);
  } catch (err) {
    if (err instanceof TiliotetiedostoVirhe) throw virhe(err.message, rivi);
    throw err;
  }
}

/** Etumerkki + 18 numeroa (kaksi implisiittistä desimaalia) → etumerkilliset sentit. */
function summa(merkki: string, numerot: string, rivi: number, kuvaus: string): Cents {
  if (!/^\d{18}$/.test(numerot)) throw virhe(`${kuvaus}: summa ei ole 18 numeroa`, rivi);
  const sentit = Number.parseInt(numerot, 10);
  if (!Number.isSafeInteger(sentit)) throw virhe(`${kuvaus}: summa on liian suuri`, rivi);
  return Euro.fromCents(merkki === '-' ? -sentit : sentit);
}

/** Kappaleen viitenumero: etunollat pois; pelkät nollat = ei viitettä. */
function poistaEtunollat(viite: string): string {
  return viite.replace(/^0+/, '');
}

/** Yksi T10 lisätietueineen ennen tasosääntöä. */
interface Luonnos {
  /** Tasotunnus (T10 kohta 188): 0 = kirjaus, 1… = erittelyrivi. */
  taso: number;
  /** Hylätty tapahtuma (tunnus 9): pysyy jonossa erän jäsenenä, mutta ei tule kirjatuksi eikä summaan. */
  hylatty: boolean;
  tapahtuma: Tilitapahtuma;
  viestiosat: string[];
  /** Onko T11/00 jo nähty (RF-viite tunnistetaan vain ensimmäisestä palasta). */
  nahtyVapaaViesti: boolean;
}

interface Lohko {
  alkaa: IsoDate;
  loppuu: IsoDate;
  alkusaldo?: Cents;
  iban?: string;
  /** Tapahtumat tiedostojärjestyksessä; `null` = muu tietue (T40, T50…), katkaisee erän. */
  jono: (Luonnos | null)[];
  saldot: { pvm: IsoDate; saldo: Cents }[];
}

/**
 * T00 tiliotteen perustietue (322 merkkiä). Kausi 27–32 ja 33–38 (Kitsas titotuonti.cpp:129-130),
 * IBAN 293–310 (titotuonti.cpp:131), alkusaldon etumerkki 72 ja summa 73–90, valuutta 97–99.
 */
function lueT00(rivi: string, nro: number): Lohko {
  if (rivi.length < 38) throw virhe('T00-tietue on liian lyhyt', nro);
  const valuutta = kentta(rivi, 97, 99).trim().toUpperCase();
  if (valuutta !== '' && valuutta !== 'EUR')
    throw new TiliotetiedostoVirhe(
      'VALUUTTA',
      `Tilin valuutta on ${valuutta}, vain euromääräisen tilin tiliote voidaan tuoda`,
      nro,
    );
  const lohko: Lohko = {
    alkaa: paiva(kentta(rivi, 27, 32), nro),
    loppuu: paiva(kentta(rivi, 33, 38), nro),
    jono: [],
    saldot: [],
  };
  if (lohko.loppuu < lohko.alkaa) throw virhe('Tiliotteen kausi päättyy ennen alkuaan', nro);
  const alkusaldoNumerot = kentta(rivi, 73, 90);
  if (alkusaldoNumerot.trim() !== '')
    lohko.alkusaldo = summa(kentta(rivi, 72, 72), alkusaldoNumerot, nro, 'Alkusaldo');
  const iban = kentta(rivi, 293, 310).replace(/\s/g, '');
  if (iban !== '') lohko.iban = iban;
  return lohko;
}

/**
 * T10 tapahtuman perustietue (188 merkkiä); tunnus 9 = hylätty.
 * Arkistointitunnus 13–30 (titotuonti.cpp:116), päivä 31–36 (:108), tapahtumatunnus 49,
 * summa: etumerkki 88 ja 89–106 (:110-111), saaja/maksaja 109–143 (:114), viite 160–179 (:115),
 * tasotunnus 188 (:98,117). Kirjausselite 53–87 on nimen varavaihtoehto.
 */
function lueT10(rivi: string, nro: number): Luonnos {
  if (rivi.length < 106) throw virhe('T10-tietue on liian lyhyt', nro);
  const tapahtuma: Tilitapahtuma = {
    pvm: paiva(kentta(rivi, 31, 36), nro),
    nimi: tiivista(kentta(rivi, 109, 143)) || tiivista(kentta(rivi, 53, 87)),
    maara: summa(kentta(rivi, 88, 88), kentta(rivi, 89, 106), nro, 'Tapahtuman summa'),
  };
  const viite = poistaEtunollat(kentta(rivi, 160, 179).trim());
  if (viite !== '') tapahtuma.viite = viite;
  const arkistotunnus = kentta(rivi, 13, 30).trim();
  if (arkistotunnus !== '') tapahtuma.arkistotunnus = arkistotunnus;
  const taso = Number.parseInt(kentta(rivi, 188, 188), 10);
  return {
    taso: Number.isNaN(taso) ? 0 : taso,
    hylatty: kentta(rivi, 49, 49) === '9',
    tapahtuma,
    viestiosat: [],
    nahtyVapaaViesti: false,
  };
}

/**
 * T11 lisätietue (8 + n merkkiä): tyyppi kohdissa 7–8, data kohdasta 9.
 * 00 vapaa viesti (titotuonti.cpp:71-83), 01 kappalemäärä (:86-91), 05 valuuttatieto,
 * 06 toimeksiantajan tieto, 11 SEPA-lisätiedot (:63-69).
 */
function lueT11(rivi: string, nro: number, l: Luonnos): void {
  const tyyppi = kentta(rivi, 7, 8);
  const t = l.tapahtuma;
  if (tyyppi === '00') {
    const ensimmainen = tiivista(kentta(rivi, 9, 43));
    // OP laittaa RF-viitteen vapaaseen viestiin eikä 11-tyypin tietueeseen (Kitsas: sama kierto).
    if (!l.nahtyVapaaViesti && RF_VIITE.test(ensimmainen)) t.viite = ensimmainen.replace(/\s/g, '');
    else {
      const teksti = tiivista(rivi.slice(8));
      if (teksti !== '') l.viestiosat.push(teksti);
    }
    l.nahtyVapaaViesti = true;
  } else if (tyyppi === '01') {
    const kpl = Number.parseInt(kentta(rivi, 9, 16), 10);
    if (!Number.isNaN(kpl)) l.viestiosat.push(`VIITEMAKSUJA ${kpl} kpl`);
  } else if (tyyppi === '05') {
    // Tyhjä summa tai valuuttakoodi: tietue ohitetaan (ei kaadeta koko tiedostoa).
    const koodi = kentta(rivi, 29, 31).trim().toUpperCase();
    const numerot = kentta(rivi, 10, 27);
    if (koodi !== '' && numerot.trim() !== '') {
      const maara = summa(kentta(rivi, 9, 9), numerot, nro, 'Alkuperäinen summa');
      t.alkuperainen = { valuutta: koodi, maara: Euro.abs(maara) };
    }
  } else if (tyyppi === '06') {
    const teksti = tiivista(rivi.slice(8));
    if (teksti !== '') l.viestiosat.push(teksti);
  } else if (tyyppi === '11') {
    // Kitsas kirjoittaa tämän IBANin tiliotteen IBANiksi (titotuonti.cpp:65) ja korvaa omansa
    // vastapuolen tilillä; tässä se kuuluu tapahtumalle.
    const viite = tiivista(kentta(rivi, 9, 43));
    if (viite.startsWith('RF')) t.viite = viite.replace(/\s/g, '');
    const iban = kentta(rivi, 44, 78).replace(/\s/g, '');
    if (iban !== '') t.iban = iban;
    const tunnus = kentta(rivi, 289, 323).trim();
    if (tunnus !== '') t.arkistotunnus = tunnus;
  }
}

/** T40 saldotietue (50 merkkiä): päivä 7–12, etumerkki 13, saldo 14–31. */
function lueT40(rivi: string, nro: number): { pvm: IsoDate; saldo: Cents } {
  if (rivi.length < 31) throw virhe('T40-tietue on liian lyhyt', nro);
  return {
    pvm: paiva(kentta(rivi, 7, 12), nro),
    saldo: summa(kentta(rivi, 13, 13), kentta(rivi, 14, 31), nro, 'Saldo'),
  };
}

function valmis(l: Luonnos): Tilitapahtuma {
  const t = { ...l.tapahtuma };
  if (l.viestiosat.length > 0) t.viesti = l.viestiosat.join(' ');
  return t;
}

/**
 * Tasosääntö (Kitsas titotuonti.cpp:94-104): T10 otetaan sellaisenaan vain, jos seuraavan
 * tietueen taso on enintään sama; muuten se on kokoomarivi, jonka erittelyrivit (taso suurempi)
 * tulevat sen tilalle. Jos erittelyrivien summa ei täsmää kokoomariviin, kokoomarivi jää ja
 * erittelyt pudotetaan, jotta saldo täsmää.
 */
function sovellaTasot(jono: readonly (Luonnos | null)[]): Tilitapahtuma[] {
  const tulos: Tilitapahtuma[] = [];
  let i = 0;
  while (i < jono.length) {
    const l = jono[i];
    if (!l) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < jono.length) {
      const seuraava = jono[j];
      if (!seuraava || seuraava.taso <= l.taso) break;
      j++;
    }
    const erittelyt = j > i + 1 ? sovellaTasot(jono.slice(i + 1, j)) : [];
    const erittelyjenSumma = erittelyt.reduce((s, t) => Euro.add(s, t.maara), Euro.fromCents(0));
    // Hylätty rivi (tunnus 9) ei ole kirjaus: ei se eikä sen erittelyrivit.
    if (!l.hylatty) {
      if (erittelyt.length > 0 && erittelyjenSumma === l.tapahtuma.maara) tulos.push(...erittelyt);
      else tulos.push(valmis(l));
    }
    i = j;
  }
  return tulos;
}

function lohkonTiliote(lohko: Lohko): Tiliote {
  // Viimeinen kauden loppuun mennessä päivätty T40 (tasapelissä tiedostossa myöhempi).
  let loppusaldo: Cents | undefined;
  let loppuPvm = '';
  for (const s of lohko.saldot) {
    if (s.pvm <= lohko.loppuu && s.pvm >= loppuPvm) {
      loppusaldo = s.saldo;
      loppuPvm = s.pvm;
    }
  }
  const tiliote: Tiliote = {
    muoto:
      lohko.alkusaldo !== undefined && loppusaldo !== undefined ? 'kuukausitiliote' : 'tapahtumat',
    kausi: { alkaa: lohko.alkaa, loppuu: lohko.loppuu },
    tapahtumat: sovellaTasot(lohko.jono),
    lahde: 'tito',
  };
  if (lohko.alkusaldo !== undefined) tiliote.alkusaldo = lohko.alkusaldo;
  if (loppusaldo !== undefined) tiliote.loppusaldo = loppusaldo;
  if (lohko.iban) tiliote.iban = lohko.iban;
  return tiliote;
}

/**
 * Lukee TITO-tiliotteen (konekielinen tiliote). Yksi tiedosto voi sisältää useita T00-lohkoja
 * (päiväkohtaiset tiliotteet), jotka yhdistetään yhdeksi tiliotteeksi. Käsittelee myös
 * LF- ja pelkät CR-rivinvaihdot, editorien karsimat rivinlopun välilyönnit ja tiedoston lopun SUB-merkin;
 * 7-bittisen merkistön ({|} = äöå) tiedostot, joissa ei ole yhtään 8-bittistä merkkiä, muunnetaan.
 */
export function poimiTito(teksti: string): Tiliote {
  let t = teksti.replace(/^﻿/, '').replaceAll('\u001A', '');
  if (!EI_ASCII.test(t)) t = t.replace(SEITSEMANBITTISET_MERKIT, (m) => SEITSEMANBITTINEN[m] ?? m);

  const lohkot: Lohko[] = [];
  let lohko: Lohko | undefined;
  let nykyinen: Luonnos | undefined;
  const rivit = t.split(/\r\n|\r|\n/);
  for (let i = 0; i < rivit.length; i++) {
    const rivi = (rivit[i] ?? '').trimEnd();
    if (rivi === '') continue;
    const nro = i + 1;
    const tunnus = rivi.slice(0, 3);

    if (tunnus === 'T00') {
      lohko = lueT00(rivi, nro);
      lohkot.push(lohko);
      nykyinen = undefined;
      continue;
    }
    if (!lohko) throw virhe('Tiedosto ei ole TITO-tiliote: T00-tietue puuttuu alusta', nro);

    if (tunnus === 'T11') {
      if (nykyinen) lueT11(rivi, nro, nykyinen);
      continue;
    }
    nykyinen = undefined;
    if (tunnus === 'T10') {
      const luonnos = lueT10(rivi, nro);
      lohko.jono.push(luonnos);
      // Hylätyn tapahtuman lisätietueet jätetään lukematta.
      nykyinen = luonnos.hylatty ? undefined : luonnos;
    } else {
      if (tunnus === 'T40') lohko.saldot.push(lueT40(rivi, nro));
      // T50, T60/T70, T80/T81 ym. ohitetaan, mutta ne katkaisevat erän.
      lohko.jono.push(null);
    }
  }

  if (lohkot.length === 0) throw virhe('Tiedosto ei ole TITO-tiliote: T00-tietue puuttuu', 1);
  const ibanit = new Set(lohkot.flatMap((l) => (l.iban ? [l.iban] : [])));
  if (ibanit.size > 1)
    throw new TiliotetiedostoVirhe(
      'VAARA_MUOTO',
      `Tiedostossa on usean tilin tiliotteita (${[...ibanit].join(', ')}), tuo ne erikseen`,
    );
  return yhdistaTiliotteet(lohkot.map(lohkonTiliote));
}
