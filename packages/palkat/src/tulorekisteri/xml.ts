import type { Cents } from '@penni/euro';
import { muotoileYtunnus, tarkistaYtunnus } from '@penni/validator';
import { PalkatVirhe } from '../taulukot.js';
import type { PalkatAsetukset } from '../tyontekija.js';

/**
 * Tulorekisterin XML-ilmoitusten yhteiset apurit. Ilmoitukset ladataan käsin Tulorekisterin
 * lataus- ja tallennuspalvelussa: ei varmennetta eikä `Signature`-elementtiä (schema 2026 §2.1:
 * "The element is not allowed with records submitted through the upload/download service").
 * Lähteet: "Data delivery – Schemas – Earnings payment reports 2026" (jäljempänä schema 2026) ja
 * "– Employer's separate reports 2026", https://www.vero.fi/en/incomes-register/software-developers/documentation/.
 * Tuotettua XML:ää ei koskaan lokiteta: se sisältää henkilötunnuksia.
 */

/** Ilmoituksen maksaja (kirjan Y-tunnus ja yhteyshenkilö). */
export interface Maksaja {
  ytunnus: string;
  nimi: string;
  yhteyshenkilo: { nimi: string; puhelin: string };
}

/** Lähdeohjelmisto (`Source`, irct:String30). */
export const LAHDE = 'Penni';

/** Codes: IdType (Codes 2026). */
export const TUNNISTE = { ytunnus: 1, hetu: 2 } as const;

/**
 * FaultyControl 2 = "Entire record is rejected". Yksi tiedosto on yksi palkka-ajo (tai yksi kuukausi),
 * ja tositteelle tallennetaan yksi DeliveryId ja tiiviste; osittain hyväksytty tietue jättäisi ajon
 * puoliksi ilmoitetuksi, ja hyväksyttyjen raporttien ReportId:t estäisivät korjatun tiedoston
 * uudelleenlähetyksen uusina raportteina. Koko tietueen hylkäys pitää ajon kaikki-tai-ei-mitään.
 */
export const VIRHEKASITTELY = 2;

/** Codes: ActionCode 1 = uusi ilmoitus. */
export const UUSI_ILMOITUS = 1;

// --- Merkkijonot ---------------------------------------------------------------------------

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Schema 2026 §1.2: "--", "/*" ja "&#" eivät saa esiintyä tiedostossa. XML 1.0 ei salli C0-ohjausmerkkejä. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: tarkoituksella ohjausmerkkien tunnistus
const KIELLETYT = /--|\/\*|&#|[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

/**
 * Tekstikentän arvo: trimmattu, ei tyhjä (schema 2026 §1.1: tyhjiä elementtejä ei sallita),
 * enintään `max` merkkiä. Virheviestissä vain kentän nimi, ei arvoa.
 */
export function teksti(arvo: string | undefined, kentta: string, max: number): string {
  const s = (arvo ?? '').trim();
  if (s === '') throw new PalkatVirhe('SYOTE', `${kentta} puuttuu.`);
  if ([...s].length > max) {
    throw new PalkatVirhe('SYOTE', `${kentta} on liian pitkä (enintään ${max} merkkiä).`);
  }
  if (KIELLETYT.test(s)) {
    throw new PalkatVirhe(
      'SYOTE',
      `${kentta} sisältää merkkejä, joita Tulorekisteri ei hyväksy (esim. "--" tai "/*").`,
    );
  }
  return s;
}

/**
 * Viitetunnus (DeliveryId, ReportId): schema 2026 §1.2 sallii vain 0-9, a-z, A-Z, "_" ja "-";
 * irct:String40. Kaksoisviiva on kielletty koko tiedostossa.
 */
export function viite(arvo: string, kentta: string): string {
  if (!/^[0-9A-Za-z_-]{1,40}$/.test(arvo) || arvo.includes('--')) {
    throw new PalkatVirhe(
      'SYOTE',
      `${kentta} ei kelpaa Tulorekisteriin (sallitut merkit 0-9, a-z, A-Z, _ ja -, enintään 40).`,
    );
  }
  return arvo;
}

/** Y-tunnus muodossa NNNNNNN-T (mod-11-tarkiste). */
export function ytunnus(arvo: string, kentta: string): string {
  const s = arvo.trim();
  if (!tarkistaYtunnus(s)) throw new PalkatVirhe('SYOTE', `${kentta} ei ole kelvollinen Y-tunnus.`);
  return muotoileYtunnus(s);
}

/** xs:dateTime aikavyöhykkeen kanssa (schema 2026 §1.3: ajanhetkissä on oltava aikavyöhyke). */
export function aikaleima(arvo: string, kentta: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(arvo)) {
    throw new PalkatVirhe('SYOTE', `${kentta} ei ole ISO-aikaleima aikavyöhykkeen kanssa.`);
  }
  return arvo;
}

/** irct:decimal2 senteistä ilman liukulukuja: 220366 -> "2203.66". */
export function euroa(sentit: Cents): string {
  if (!Number.isSafeInteger(sentit) || Math.abs(sentit) > 999_999_999_999_999) {
    throw new PalkatVirhe('SYOTE', 'Rahamäärä ei ole kelvollinen senttimäärä.');
  }
  const itseis = Math.abs(sentit);
  const eurot = Math.trunc(itseis / 100);
  const sentit2 = String(itseis % 100).padStart(2, '0');
  return `${sentit < 0 ? '-' : ''}${eurot}.${sentit2}`;
}

// --- Elementtipuu --------------------------------------------------------------------------

export interface Elementti {
  nimi: string;
  teksti?: string;
  lapset?: Elementti[];
}

type Lapsi = Elementti | null | undefined | false;

/** Ryhmäelementti; puuttuvat (null/false) lapset jätetään pois. */
export function e(nimi: string, lapset: readonly Lapsi[]): Elementti {
  return { nimi, lapset: lapset.filter((l): l is Elementti => Boolean(l)) };
}

/** Arvoelementti. Merkkijonot on tarkistettu (`teksti`, `viite`, …) ennen tätä. */
export function t(nimi: string, arvo: string | number | boolean): Elementti {
  return { nimi, teksti: String(arvo) };
}

function kirjoita(el: Elementti, sisennys: string, rivit: string[], juuriAttr = ''): void {
  const nimi = el.nimi;
  if (el.teksti !== undefined) {
    rivit.push(`${sisennys}<${nimi}${juuriAttr}>${escapeXml(el.teksti)}</${nimi}>`);
    return;
  }
  rivit.push(`${sisennys}<${nimi}${juuriAttr}>`);
  for (const l of el.lapset ?? []) kirjoita(l, `${sisennys}  `, rivit);
  rivit.push(`${sisennys}</${nimi}>`);
}

/**
 * XML-dokumentti: UTF-8 ilman BOM:ia (schema 2026 §1.2). Juurielementti on skeeman
 * kohdenimiavaruudessa etuliitteellä; paikalliset elementit ovat nimiavaruudettomia, koska
 * XSD:issä ei ole `elementFormDefault`-määrettä (oletus "unqualified").
 */
export function dokumentti(etuliite: string, nimiavaruus: string, juuri: Elementti): string {
  const rivit = ['<?xml version="1.0" encoding="UTF-8"?>'];
  kirjoita(
    { ...juuri, nimi: `${etuliite}:${juuri.nimi}` },
    '',
    rivit,
    ` xmlns:${etuliite}="${nimiavaruus}"`,
  );
  return `${rivit.join('\n')}\n`;
}

// --- Yhteiset tietoryhmät ------------------------------------------------------------------

/** Tunniste (wrtirt:Id / psrtirt:Id) Y-tunnukselle. */
export function ytunnusId(nimi: string, tunnus: string): Elementti {
  return e(nimi, [t('Type', TUNNISTE.ytunnus), t('Code', tunnus)]);
}

/**
 * Tietueen omistaja, muodostaja ja lähettäjä: maksaja itse (schema 2026 §2.1, "The payer has a
 * customer ID and the payer reports the data": Y-tunnus kaikissa kolmessa).
 */
export function tietueenOsapuolet(tunnus: string): Elementti[] {
  return [
    ytunnusId('DeliveryDataOwner', tunnus),
    ytunnusId('DeliveryDataCreator', tunnus),
    ytunnusId('DeliveryDataSender', tunnus),
  ];
}

/** ContactPersons (schema 2026 §2.3: Name String200 ja Telephone String40 pakollisia). */
export function yhteyshenkilot(m: Maksaja): Elementti {
  const y = m.yhteyshenkilo as Maksaja['yhteyshenkilo'] | undefined;
  return e('ContactPersons', [
    e('ContactPerson', [
      t('Name', teksti(y?.nimi, 'Yhteyshenkilön nimi', 200)),
      t('Telephone', teksti(y?.puhelin, 'Yhteyshenkilön puhelinnumero', 40)),
    ]),
  ]);
}

/**
 * Kirjan TyEL-vakuutus asetuksista tai null, jos kumpaakaan kenttää ei ole annettu. Schema 2026
 * §2.22 (ja erillisilmoituksen schema 2026 §2.9): eläkelaitoksen tunnus (PensionProvIdCode, 2 tai 5
 * numeroa) on vakuutusnumeron alku, vakuutusnumero on irct:PensionPolicyNo (1-11 merkkiä).
 */
export function tyelTiedot(
  a: PalkatAsetukset | undefined,
): { yhtio: string; sopimus: string } | null {
  const yhtio = (a?.tyelYhtio ?? '').trim();
  const sopimus = (a?.tyelSopimus ?? '').trim();
  if (yhtio === '' && sopimus === '') return null;
  if (!/^(\d{2}|\d{5})$/.test(yhtio) || !sopimus.startsWith(yhtio)) {
    throw new PalkatVirhe(
      'SYOTE',
      'TyEL-vakuutusnumeron on alettava eläkelaitoksen tunnuksella (2 tai 5 numeroa).',
    );
  }
  return { yhtio, sopimus: teksti(sopimus, 'TyEL-vakuutusnumero', 11) };
}

/** Aikaleiman numerot viitetunnukseen: "2026-10-28T09:15:30.123Z" -> "20261028091530123". */
export const numerot = (s: string) => s.replace(/\D/g, '');

// --- Tiiviste ------------------------------------------------------------------------------

// Web Crypto on Node 22:ssa ja selaimissa; paketti ei tuo DOM/node-tyyppejä, joten kuvataan
// tarvittava pinta (sama tapa kuin storage-sqlite-core/liitevarasto.ts).
declare const crypto: {
  subtle: { digest(algoritmi: string, data: Uint8Array): Promise<ArrayBuffer> };
};
declare const TextEncoder: { new (): { encode(s: string): Uint8Array } };

/** SHA-256 tekstin UTF-8-tavuista heksana (ladatun tiedoston tunniste tositteella). */
export async function sha256Hex(teksti: string): Promise<string> {
  const tiiviste = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(teksti)),
  );
  let s = '';
  for (const b of tiiviste) s += b.toString(16).padStart(2, '0');
  return s;
}
