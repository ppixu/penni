import type { IsoDate } from '@penni/engine';
import { muotoilePvm } from '@penni/euro';
import { escapeHtml } from './polut';
import { htmlSivu } from './sivupohja';

/** Arkiston etusivun ja varmennesivun yhteiset tiedot. */
export interface EtusivunTiedot {
  nimi: string;
  ytunnus?: string;
  kausi: { alkaa: IsoDate; loppuu: IsoDate };
  /** Arkistointihetki, ISO-aikaleima. */
  arkistoitu: string;
  /** Penni-version tunniste. */
  versio: string;
  /** `arkisto.sha256`-tiedoston SHA-256, pieni heksa. */
  juuriTiiviste: string;
  /** Tilinpäätöksen vahvistuspäivä; `null`, kun tilinpäätös on vahvistamatta. */
  vahvistettu: IsoDate | null;
  /** Raportit-osion linkit (arkistossa olevat raportit). */
  raportit: readonly { nimi: string; polku: string }[];
  /** Yksi linkki per alv-ilmoitus. */
  alv: readonly { nimi: string; polku: string }[];
  tositteita: number;
  liitteita: number;
  varoitukset: readonly string[];
}

const e = escapeHtml;

function kausiTeksti(t: EtusivunTiedot): string {
  return `${muotoilePvm(t.kausi.alkaa)} – ${muotoilePvm(t.kausi.loppuu)}`;
}

function kaksi(n: number): string {
  return String(n).padStart(2, '0');
}

/** `dd.mm.yyyy` paikallisessa ajassa. */
function paivays(iso: string): string {
  const d = new Date(iso);
  return `${kaksi(d.getDate())}.${kaksi(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** `dd.mm.yyyy hh.mm.ss` paikallisessa ajassa (arkistoija.cpp:244). */
function paivaysJaKello(iso: string): string {
  const d = new Date(iso);
  return `${paivays(iso)} ${kaksi(d.getHours())}.${kaksi(d.getMinutes())}.${kaksi(d.getSeconds())}`;
}

/** Lukumäärä oikeassa luvussa: "1 tosite", "3 tositetta". */
function maara(n: number, yksikko: string, monikko: string): string {
  return `${n} ${n === 1 ? yksikko : monikko}`;
}

function linkkiLista(rivit: readonly { nimi: string; polku: string }[]): string {
  return `<ul>${rivit.map((r) => `<li><a href="${e(r.polku)}">${e(r.nimi)}</a></li>`).join('')}</ul>`;
}

function sivunTunnisteet(t: EtusivunTiedot) {
  return {
    navi: { kotiTeksti: `${t.nimi} · ${t.kausi.alkaa.slice(0, 4)}` },
    alatunniste: `Arkistoitu ${paivays(t.arkistoitu)} Penni-versiolla ${t.versio}`,
  };
}

/** Arkiston etusivu (arkistoija.cpp:422-491). Palauttaa kokonaisen dokumentin. */
export function etusivuHtml(t: EtusivunTiedot): string {
  const osat: string[] = [];
  osat.push(`<h1 class="etusivu">${e(t.nimi)}</h1>`);
  if (t.ytunnus) osat.push(`<p class="ytunnus">Y-tunnus ${e(t.ytunnus)}</p>`);
  osat.push(`<h2 class="etusivu">Kirjanpitoarkisto<br>${e(kausiTeksti(t))}</h2>`);
  if (t.vahvistettu === null) osat.push('<p class="varoitus">Tilinpäätös vahvistamatta</p>');

  osat.push(
    '<h3>Tilinpäätös</h3>',
    linkkiLista([
      { nimi: 'Tilinpäätös', polku: 'raportit/tilinpaatos.html' },
      { nimi: 'Tase-erittely', polku: 'raportit/taseerittely.html' },
    ]),
    '<h3>Kirjanpito</h3>',
    linkkiLista([
      { nimi: 'Pääkirja', polku: 'raportit/paakirja.html' },
      { nimi: 'Päiväkirja', polku: 'raportit/paivakirja.html' },
      { nimi: 'Tositeluettelo', polku: 'raportit/tositeluettelo.html' },
      { nimi: 'Tililuettelo', polku: 'raportit/tililuettelo.html' },
    ]),
  );
  if (t.raportit.length > 0) osat.push('<h3>Raportit</h3>', linkkiLista(t.raportit));
  if (t.alv.length > 0) osat.push('<h3>Arvonlisävero</h3>', linkkiLista(t.alv));

  osat.push(
    '<h3>Tositteet</h3>',
    `<p>${maara(t.tositteita, 'tosite', 'tositetta')}, ${maara(t.liitteita, 'liite', 'liitettä')}. <a href="raportit/tositeluettelo.html">Tositeluettelo</a></p>`,
  );

  if (t.varoitukset.length > 0) {
    osat.push(
      '<h3>Varoitukset</h3>',
      `<ul class="varoitukset">${t.varoitukset.map((v) => `<li>${e(v)}</li>`).join('')}</ul>`,
    );
  }

  osat.push(
    `<p class="info">Tämä kirjanpidon sähköinen arkisto on luotu ${e(paivays(t.arkistoitu))} Penni-ohjelman versiolla ${e(t.versio)}.<br>Arkiston muuttumattomuus voidaan valvoa sha256-tiivisteellä <code>${e(t.juuriTiiviste)}</code> (<a href="arkistovarmenne.html">arkistovarmenne</a>).</p>`,
  );

  return htmlSivu({
    otsikko: `${t.nimi} arkisto`,
    runko: `<div class="arkistoteksti">${osat.join('')}</div>`,
    syvyys: 0,
    ...sivunTunnisteet(t),
  });
}

/** Arkistovarmenne (arkistoija.cpp:217-270, vain suomeksi). Palauttaa kokonaisen dokumentin. */
export function varmenneHtml(t: EtusivunTiedot): string {
  const rivi = (otsikko: string, arvo: string) =>
    `<tr><th scope="row">${e(otsikko)}</th><td>${arvo}</td></tr>`;
  const runko = [
    '<div class="arkistoteksti">',
    '<h1>Arkistovarmenne</h1>',
    `<h2>${e(t.nimi)}</h2>`,
    '<table class="varmenne">',
    rivi('Tilikausi', e(kausiTeksti(t))),
    rivi('Arkistoitu', e(paivaysJaKello(t.arkistoitu))),
    rivi('SHA256-tiiviste', `<code>${e(t.juuriTiiviste)}</code>`),
    '</table>',
    '<p>Sähköisen arkiston muuttumattomuus voidaan varmentaa tällä sivulla olevalla ' +
      'sha256-tiivisteellä. Menettely edellyttää, että tämä sivu voidaan säilyttää luotettavasti ' +
      'esimerkiksi siten, että sivu allekirjoitetaan tai muuten varmennetaan niin, ettei ' +
      'muutosten tekeminen ole mahdollista.</p>',
    '<h3>Näin arkisto varmennetaan</h3>',
    '<ol>',
    '<li>Pura arkiston zip-tiedosto omaan kansioonsa.</li>',
    '<li>Aja kansiossa komento <code>sha256sum -c arkisto.sha256</code> ' +
      '(macOS: <code>shasum -a 256 -c arkisto.sha256</code>). ' +
      'Jokaisen tiedoston pitää olla merkitty OK.</li>',
    '<li>Laske tiedoston tiiviste komennolla <code>sha256sum arkisto.sha256</code> ' +
      '(macOS: <code>shasum -a 256 arkisto.sha256</code>, Windows PowerShell: ' +
      '<code>Get-FileHash arkisto.sha256 -Algorithm SHA256</code>, joka näyttää tiivisteen ' +
      'isoin kirjaimin) ja vertaa tulosta tällä sivulla olevaan SHA256-tiivisteeseen. ' +
      'Niiden pitää olla samat.</li>',
    '</ol>',
    '<p><a href="index.html">Takaisin etusivulle</a></p>',
    '</div>',
  ].join('');
  return htmlSivu({
    otsikko: `Arkistovarmenne – ${t.nimi}`,
    runko,
    syvyys: 0,
    ...sivunTunnisteet(t),
  });
}
