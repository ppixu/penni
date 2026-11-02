import type { CsvSarakkeet, PvmMuoto } from './csv.js';

/** Tunnistettu pankki ja sen viennin sarakejako tämän tiedoston otsikkoriviin paikannettuna. */
export interface CsvPankki {
  pankki: string;
  sarakkeet: CsvSarakkeet;
}

/** Pankkiprofiili: otsikon tunnistetiedot ja roolit sarakkeiden nimillä. */
interface Profiili {
  pankki: string;
  /** Otsikkorivi sellaisenaan; kaikkien sen (ei-tyhjien) nimien on löydyttävä tiedostosta. */
  otsikko: string;
  erotin: ';' | ',' | '\t';
  pvmMuoto: PvmMuoto;
  pvm: string;
  maara: string;
  maksaja?: string;
  saaja?: string;
  nimi: string[];
  viesti: string[];
  viite?: string;
  arkistotunnus?: string;
  iban?: string;
  saldo?: string;
  valuutta?: string;
}

/**
 * Pankkien CSV-viennit. **Varmistamatta:** otsikot on kirjoitettu pankkien julkisista kuvauksista,
 * ei oikeista tiedostoista; jos oikea vienti poikkeaa, korjaus on yksi rivi tässä taulukossa.
 * Ensimmäinen profiili, jonka kaikki otsikot löytyvät, voittaa.
 */
const PROFIILIT: readonly Profiili[] = [
  {
    pankki: 'Nordea',
    otsikko: 'Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta',
    erotin: ';',
    pvmMuoto: 'yyyy/mm/dd',
    pvm: 'Kirjauspäivä',
    maara: 'Määrä',
    maksaja: 'Maksaja',
    saaja: 'Maksunsaaja',
    nimi: ['Nimi'],
    viesti: ['Otsikko'],
    viite: 'Viitenumero',
    valuutta: 'Valuutta',
  },
  {
    pankki: 'Nordea (vanha)',
    otsikko:
      'Kirjauspäivä\tArvopäivä\tMaksupäivä\tMäärä\tSaaja/Maksaja\tTilinumero\tBIC\tTapahtuma\tViite\tMaksajan viite\tViesti\tKortinnumero\tKuitti',
    erotin: '\t',
    pvmMuoto: 'd.m.yyyy',
    pvm: 'Kirjauspäivä',
    maara: 'Määrä',
    nimi: ['Saaja/Maksaja'],
    iban: 'Tilinumero',
    viite: 'Viite',
    viesti: ['Viesti', 'Tapahtuma'],
  },
  {
    pankki: 'OP',
    otsikko:
      'Kirjauspäivä;Arvopäivä;Määrä EUROA;Laji;Selitys;Saaja/Maksaja;Saajan tilinumero;Saajan pankin BIC;Viite;Viesti;Arkistointitunnus;',
    erotin: ';',
    pvmMuoto: 'd.m.yyyy',
    pvm: 'Kirjauspäivä',
    maara: 'Määrä EUROA',
    nimi: ['Saaja/Maksaja'],
    iban: 'Saajan tilinumero',
    viite: 'Viite',
    viesti: ['Viesti', 'Selitys'],
    arkistotunnus: 'Arkistointitunnus',
  },
  {
    pankki: 'S-Pankki',
    otsikko:
      'Kirjauspäivä;Maksupäivä;Summa;Tapahtumalaji;Maksaja;Saajan nimi;Saajan tilinumero;Saajan BIC-tunnus;Viitenumero;Viesti;Arkistointitunnus',
    erotin: ';',
    pvmMuoto: 'd.m.yyyy',
    pvm: 'Kirjauspäivä',
    maara: 'Summa',
    maksaja: 'Maksaja',
    saaja: 'Saajan nimi',
    nimi: [],
    iban: 'Saajan tilinumero',
    viite: 'Viitenumero',
    viesti: ['Viesti', 'Tapahtumalaji'],
    arkistotunnus: 'Arkistointitunnus',
  },
  {
    pankki: 'Danske Bank',
    otsikko: 'Pvm;Saaja/Maksaja;Määrä;Saldo;Tila;Tarkastus',
    erotin: ';',
    pvmMuoto: 'd.m.yyyy',
    pvm: 'Pvm',
    maara: 'Määrä',
    nimi: ['Saaja/Maksaja'],
    viesti: [],
    saldo: 'Saldo',
  },
  {
    pankki: 'Holvi',
    otsikko:
      'Payment date,Date,Amount,Currency,Counterparty,Description,Reference,Message,Filing ID',
    erotin: ',',
    pvmMuoto: 'yyyy-mm-dd',
    pvm: 'Payment date',
    maara: 'Amount',
    nimi: ['Counterparty'],
    viesti: ['Message', 'Description'],
    viite: 'Reference',
    arkistotunnus: 'Filing ID',
    valuutta: 'Currency',
  },
];

const normalisoi = (s: string): string =>
  s
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();

/**
 * Tunnistaa pankin CSV-viennin otsikkorivistä: profiilin kaikkien otsikoiden on löydyttävä
 * (normalisoituina), lisäsarakkeet sallitaan. Sarakkeet paikannetaan nimen, ei järjestyksen
 * mukaan.
 */
export function tunnistaCsvPankki(otsikot: readonly string[]): CsvPankki | undefined {
  const nimet = otsikot.map(normalisoi);
  for (const p of PROFIILIT) {
    const vaaditut = p.otsikko
      .split(p.erotin)
      .map(normalisoi)
      .filter((s) => s !== '');
    if (!vaaditut.every((v) => nimet.includes(v))) continue;
    const i = (nimi: string): number => nimet.indexOf(normalisoi(nimi));
    const sarakkeet: CsvSarakkeet = {
      pvm: i(p.pvm),
      pvmMuoto: p.pvmMuoto,
      maara: i(p.maara),
      nimi: p.nimi.map(i),
      viesti: p.viesti.map(i),
    };
    if (p.maksaja !== undefined) sarakkeet.maksaja = i(p.maksaja);
    if (p.saaja !== undefined) sarakkeet.saaja = i(p.saaja);
    if (p.viite !== undefined) sarakkeet.viite = i(p.viite);
    if (p.arkistotunnus !== undefined) sarakkeet.arkistotunnus = i(p.arkistotunnus);
    if (p.iban !== undefined) sarakkeet.iban = i(p.iban);
    if (p.saldo !== undefined) sarakkeet.saldo = i(p.saldo);
    if (p.valuutta !== undefined) sarakkeet.valuutta = i(p.valuutta);
    return { pankki: p.pankki, sarakkeet };
  }
  return undefined;
}
