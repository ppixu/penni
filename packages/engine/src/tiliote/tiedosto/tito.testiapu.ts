/**
 * Testiapu: TITO-tietueiden rakentaja. Kiinteänmittaiset tietueet ovat käsin lukukelvottomia,
 * joten testit kokoavat ne tästä. Kentät sijoitetaan Finanssialan palvelukuvauksen (v3.3, §3.4)
 * mukaisiin 1-pohjaisiin kohtiin; tässä käytettyjä kohtia ovat vain ne, jotka lukija lukee,
 * muut täytetään välilyönnein (ja järjestysnumero-kentät nollin). Vain testikäyttöön.
 */
import type { Cents } from '@penni/euro';

/** Asettaa tekstin 1-pohjaisesta kohdasta alkaen (vasen tasaus, ylitys katkaistaan kentän pituuteen). */
function aseta(rivi: string[], alku: number, teksti: string, pituus?: number): void {
  const t = pituus === undefined ? teksti : teksti.slice(0, pituus);
  for (let i = 0; i < t.length; i++) rivi[alku - 1 + i] = t[i] ?? ' ';
}

/** Tyhjä tietue annetun pituuden mukaan, kentät sijoitetaan `kentat`-funktiolla. */
function tietue(
  pituus: number,
  kentat: (a: (alku: number, teksti: string, pit?: number) => void) => void,
): string {
  const rivi = new Array<string>(pituus).fill(' ');
  kentat((alku, teksti, pit) => aseta(rivi, alku, teksti, pit));
  return rivi.join('');
}

/** Etumerkillinen 18-numeroinen summa: etumerkki + 18 numeroa (kaksi implisiittistä desimaalia). */
export function titoSumma(sentit: Cents): string {
  return (sentit < 0 ? '-' : '+') + String(Math.abs(sentit)).padStart(18, '0');
}

/** Tiliotteen perustietue T00 (322 merkkiä). Päivät VVKKPP. */
export function t00(p: {
  alku: string;
  loppu: string;
  alkusaldoPvm?: string;
  alkusaldo?: Cents;
  valuutta?: string;
  iban?: string;
}): string {
  return tietue(322, (a) => {
    a(1, 'T00');
    a(4, '322100'); // tietueen pituus ja versio (kuten oikeissa tiedostoissa: T00322100)
    a(27, p.alku, 6);
    a(33, p.loppu, 6);
    if (p.alkusaldo !== undefined) {
      a(66, p.alkusaldoPvm ?? p.alku, 6);
      a(72, titoSumma(p.alkusaldo));
    }
    a(97, p.valuutta ?? 'EUR', 3);
    if (p.iban !== undefined) a(293, p.iban, 18);
  });
}

/** Tapahtuman perustietue T10 (188 merkkiä). `tunnus`: 1 pano, 2 otto, 3/4 korjaus, 9 hylätty. */
export function t10(p: {
  nro?: number;
  arkisto?: string;
  pvm: string;
  tunnus?: string;
  koodi?: string;
  selite?: string;
  maara: Cents;
  nimi?: string;
  viite?: string;
  taso?: number;
}): string {
  return tietue(188, (a) => {
    a(1, 'T10');
    a(4, String(p.nro ?? 1).padStart(3, '0'), 3);
    a(13, p.arkisto ?? '', 18);
    a(31, p.pvm, 6);
    a(49, p.tunnus ?? (p.maara < 0 ? '2' : '1'), 1);
    a(50, p.koodi ?? '700', 3);
    a(53, p.selite ?? '', 35);
    a(88, titoSumma(p.maara));
    a(109, p.nimi ?? '', 35);
    a(160, p.viite ?? '', 20);
    a(188, String(p.taso ?? 0), 1);
  });
}

/** Lisätietue T11: tyyppi kohdissa 7–8, `data` kohdasta 9 alkaen sellaisenaan. */
export function t11(tyyppi: string, data: string): string {
  return `T11000${tyyppi}${data}`;
}

/** T11/11 (SEPA-lisätiedot): maksajan viite 9–43, vastapuolen IBAN 44–78, täysi arkistotunnus 289–323. */
export function t11Sepa(p: {
  maksajanViite?: string;
  iban?: string;
  arkistotunnus?: string;
}): string {
  const data = new Array<string>(315).fill(' ');
  aseta(data, 1, p.maksajanViite ?? '', 35);
  aseta(data, 36, p.iban ?? '', 35);
  aseta(data, 281, p.arkistotunnus ?? '', 35);
  return t11('11', data.join(''));
}

/** T11/05 (valuuttatieto): etumerkki 9, summa 10–27, valuuttakoodi 29–31. */
export function t11Valuutta(maara: Cents, valuutta: string): string {
  return t11('05', `${titoSumma(maara)} ${valuutta}`);
}

/** Saldotietue T40 (50 merkkiä): päivä 7–12, etumerkki 13, saldo 14–31. */
export function t40(p: { pvm: string; saldo: Cents }): string {
  return tietue(50, (a) => {
    a(1, 'T40');
    a(4, '000');
    a(7, p.pvm, 6);
    a(13, titoSumma(p.saldo));
  });
}

/** Tietueet tiedostoksi (CRLF-rivinvaihto, kuten pankit toimittavat). */
export function titoTiedosto(tietueet: readonly string[]): string {
  return `${tietueet.join('\r\n')}\r\n`;
}
