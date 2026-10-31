import { type Tili, nimi } from '@penni/engine';
import kartanSelitteet from './selitteet.json';

/**
 * Tilikartan ohjetekstit hiiren alle: mitä tilille tai ryhmään kirjataan ja mitä ei. Tilien ja
 * otsikoiden selitteet on kirjoitettu Kitsaksen yritystilikarttaan (selitteet.json:
 * [numero, nimi, selite]); selite näytetään vain, kun tilin nimi on yhä kartan alkuperäinen,
 * koska uudelleennimetty tili (4010 "Ostot 2" → "Ohjelmistot") on käyttäjän oma.
 */
const SELITTEET = new Map(
  (kartanSelitteet as [number, string, string][]).map(([numero, n, selite]) => [
    `${numero} ${n}`,
    selite,
  ]),
);

/** Kartan tilin tai otsikon oma selite, jos nimi on kartan alkuperäinen. */
export function omaSelite(tili: Tili): string | undefined {
  return SELITTEET.get(`${tili.numero} ${nimi(tili)}`);
}

/**
 * Tilin selite; uudelleennimetylle tai omalle tilille lähimmän otsikon selite, jotta jokaisella
 * rivillä on jotain: "Ostot tilikauden aikana: …".
 */
export function tilinSelite(tili: Tili, otsikko: Tili | undefined): string | undefined {
  const oma = omaSelite(tili);
  if (oma !== undefined) return oma;
  const ylempi = otsikko && omaSelite(otsikko);
  return ylempi && `${nimi(otsikko)}: ${ylempi}`;
}

/** Ryhmärivin vihje: otsikon selite ja ryhmän sisältö. */
export function ryhmanVihje(otsikko: Tili | undefined, sisalto: readonly string[]): string {
  const osat = [otsikko && omaSelite(otsikko)];
  if (sisalto.length > 0) osat.push(`Sisältää: ${sisalto.join(' · ')}`);
  return osat.filter(Boolean).join('\n\n');
}

/** Tilityyppien selitteet (luonne.ts:n TYYPIT). */
const TYYPIT: Record<string, string> = {
  A: 'Taseen varatili: jotain, mitä yritys omistaa tai mitä sille ollaan velkaa. Saldo siirtyy tilikaudelta seuraavalle.',
  APM: 'Käyttöomaisuus (esim. koneet, kalusto, auto), jonka hankintameno kirjataan kuluksi vähitellen poistoina. Menojäännöspoistossa poistetaan vuosittain sama prosentti (esim. 25 %) jäljellä olevasta arvosta.',
  APT: 'Käyttöomaisuus (esim. rakennus, ohjelmistolisenssi, pitkävaikutteinen meno), jonka hankintameno kirjataan kuluksi yhtä suurina vuosierinä, esim. 5 vuodessa 20 % vuodessa.',
  AS: 'Rahasaaminen, esim. lainasaaminen tai muu saatava.',
  AO: 'Asiakkaiden maksamattomat laskut. Myyntilasku kasvattaa saatavaa ja asiakkaan maksu kuittaa sen.',
  AJ: 'Tilinpäätöksen jaksotus: tälle kaudelle kuuluvat tulot, joita ei ole vielä saatu, tai etukäteen maksetut seuraavan kauden kulut.',
  AL: 'Ostojen vähennettävä arvonlisävero kertyy tänne. ALV-ilmoituksen tilitys nollaa sen. Ei kirjata käsin.',
  ALM: 'Maksuperusteisessa ALV:ssa ostolaskun vero odottaa tässä, kunnes lasku maksetaan; silloin se siirtyy vähennettäväksi.',
  AV: 'Verottajalta saatavat, esim. palautettava arvonlisävero tai liikaa maksetut verot.',
  ARK: 'Käteinen kassa. Saldo kertoo, paljonko käteistä pitäisi olla kassassa.',
  ARP: 'Yrityksen pankkitili. Saldon pitäisi täsmätä tiliotteen saldoon.',
  B: 'Taseen pääoma- tai velkatili: mistä yrityksen varat on rahoitettu (oma pääoma, varaukset, velat). Saldo siirtyy tilikaudelta seuraavalle.',
  BE: 'Aiempien tilikausien kertyneet voitot ja tappiot. Kauden tulos siirtyy tänne tilinpäätöksessä automaattisesti; ei kirjata käsin.',
  T: 'Kuluvan kauden voitto tai tappio, joka lasketaan tuloslaskelman tileistä. Tälle tilille ei kirjata.',
  BS: 'Velka jollekulle, esim. laina tai muu velka.',
  BSP: 'Luottokortti tai muu luottotili: ostot kasvattavat velkaa ja maksut vähentävät sitä.',
  BO: 'Maksamattomat ostolaskut. Ostolasku kasvattaa velkaa ja maksu kuittaa sen.',
  BJ: 'Tilinpäätöksen jaksotus: tälle kaudelle kuuluvat kulut, joita ei ole vielä maksettu (esim. lomapalkat), tai etukäteen saadut tulot.',
  BL: 'Myynnin arvonlisävero kertyy tänne. ALV-ilmoituksen tilitys nollaa sen. Ei kirjata käsin.',
  BLM: 'Maksuperusteisessa ALV:ssa myyntilaskun vero odottaa tässä, kunnes asiakas maksaa.',
  BV: 'Verottajalle maksettavat verot (esim. tilitettävä ALV, ennakonpidätykset), kunnes ne maksetaan OmaVerossa.',
  BY: 'Toiminimen yrittäjän yksityisotot ja -sijoitukset. Eivät ole yrityksen kuluja eivätkä tuloja.',
  C: 'Tuloslaskelman tulo, joka ei ole myyntiä (esim. avustukset, vuokra- tai korkotulot). Kasvattaa tulosta.',
  CL: 'Myyntitulo, joka lasketaan liikevaihtoon. Kasvattaa tulosta.',
  CZ: 'Tulo, joka ei ole tuloverotuksessa veronalaista. Kasvattaa kirjanpidon tulosta mutta ei verotettavaa tuloa.',
  CLZ: 'Myyntitulo, joka ei ole tuloverotuksessa veronalaista.',
  D: 'Tuloslaskelman kulu, joka pienentää tulosta ja on verotuksessa vähennyskelpoinen.',
  DP: 'Käyttöomaisuuden poisto: hankintamenosta tälle vuodelle kuluksi kirjattava osa. Kirjataan tilinpäätöksessä, ei ostoista.',
  DZ: 'Kulu, joka pienentää kirjanpidon tulosta mutta ei verotettavaa tuloa (esim. sakot, veronlisäykset, verojen viivästyskorot).',
  DH: 'Kulu, josta verotuksessa vähennetään vain puolet: käytännössä edustuskulut.',
  DPZ: 'Poisto, jota ei vähennetä verotuksessa.',
  DVE: 'Yrityksen maksamat tuloveron ennakot. Ne hyvitetään lopullisesta verosta, joten ne eivät ole tavallinen kulu.',
};

/** Tilityypin selite; tuntemattomalle tyypille ei mitään. */
export function tyypinSelite(koodi: string): string | undefined {
  return TYYPIT[koodi];
}
