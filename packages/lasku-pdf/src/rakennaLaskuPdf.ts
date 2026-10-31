import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import { type Fontit, lataaFontit } from './fontit.js';
import type { LaskuMalli, MalliRivi } from './laskuMalli.js';
import { piirraMaksuosa } from './maksuosa.js';
import {
  A4_KORKEUS,
  A4_LEVEYS,
  ALATUNNISTE_YLA_MM,
  INFO,
  MAKSUOSA_KORKEUS_MM,
  OSTAJA,
  SARAKE,
  SISALTO_ALA_MM,
  SISALTO_LEVEYS_MM,
  SISALTO_OIKEA_MM,
  SISALTO_VASEN_MM,
  mm,
  yPt,
} from './mitat.js';
import { HIMMEA, TAUSTA, TEKSTI, VIIVA, teksti, tekstiOikealle, viiva } from './piirto.js';

const RIVI_KOKO = 9;
const RIVI_VALI_MM = 4.2;
const RIVI_PAD_MM = 1.5;
const OTSIKKORIVI_MM = 5.5;
const INFO_RIVI_MM = 4.4;
const SUMMA_RIVI_MM = 5.2;
const ALATUNNISTE_RIVI_MM = 3.2;
/** Jatkosivun taulukon otsikkorivin yläreuna (mm). */
const JATKO_TAULUKKO_YLA_MM = 30;
/** Ilmaa maksuosan ja sen yläpuolisen sisällön välillä. */
const MAKSUOSA_ILMA_MM = 4;

// ---------- piirtoapurit (kaikki mitat mm, y ylhäältä) ----------

/** Rivittää tekstin annettuun leveyteen; rikkoo tarvittaessa yksittäisen liian pitkän sanan. */
function rivita(s: string, font: PDFFont, koko: number, leveysMm: number): string[] {
  const max = mm(leveysMm);
  const mahtuu = (t: string) => font.widthOfTextAtSize(t, koko) <= max;
  const tulos: string[] = [];
  for (const kappale of s.split(/\r?\n/)) {
    let nyt = '';
    for (const sana of kappale.split(/\s+/).filter((w) => w !== '')) {
      if (nyt !== '' && mahtuu(`${nyt} ${sana}`)) {
        nyt = `${nyt} ${sana}`;
        continue;
      }
      if (nyt !== '') tulos.push(nyt);
      let jaljella = Array.from(sana);
      while (jaljella.length > 1 && !mahtuu(jaljella.join(''))) {
        let n = jaljella.length - 1;
        while (n > 1 && !mahtuu(jaljella.slice(0, n).join(''))) n--;
        tulos.push(jaljella.slice(0, n).join(''));
        jaljella = jaljella.slice(n);
      }
      nyt = jaljella.join('');
    }
    tulos.push(nyt);
  }
  return tulos;
}

// ---------- sivusuunnitelma ----------

interface RiviSuunnitelma {
  rivi: MalliRivi;
  selite: string[];
  korkeus: number;
}
interface SivuSuunnitelma {
  /** Taulukon otsikkorivin yläreuna (mm), tai null jos sivulla ei ole rivejä. */
  otsikkoY: number | null;
  rivit: RiviSuunnitelma[];
  /** Rivien jälkeinen y (mm). */
  loppuY: number;
}
interface Suunnitelma {
  sivut: SivuSuunnitelma[];
  aiheRivit: string[];
  /** Ensimmäisen sivun aiherivin ensimmäisen perusviivan y (mm). */
  aiheY: number;
}

const summatKorkeus = (malli: LaskuMalli) => 5 + malli.summat.length * SUMMA_RIVI_MM + 2;
/** Maksuosan varaus viimeisen sivun alalaidassa; 0 jos maksuosaa ei ole. */
const maksuosaVaraus = (malli: LaskuMalli) =>
  malli.maksu !== null ? MAKSUOSA_KORKEUS_MM + MAKSUOSA_ILMA_MM : 0;

function suunnitteleSivut(malli: LaskuMalli, fontit: Fontit): Suunnitelma {
  const infoLoppu = INFO.yla + malli.info.length * INFO_RIVI_MM + 5;
  const ylaosaLoppu = Math.max(OSTAJA.yla + OSTAJA.korkeus, malli.info.length > 0 ? infoLoppu : 0);
  const aiheRivit =
    malli.aihe !== null ? rivita(malli.aihe, fontit.lihava, 10, SISALTO_LEVEYS_MM) : [];
  const aiheY = ylaosaLoppu + 9;
  const otsikkoY1 = aiheRivit.length > 0 ? aiheY + (aiheRivit.length - 1) * 5 + 4 : ylaosaLoppu + 8;

  const suunnitellut: RiviSuunnitelma[] = malli.rivit.map((rivi) => {
    const selite = rivita(
      rivi.selite,
      fontit.normaali,
      RIVI_KOKO,
      SARAKE.seliteOikea - SARAKE.seliteVasen,
    );
    return { rivi, selite, korkeus: 2 * RIVI_PAD_MM + selite.length * RIVI_VALI_MM };
  });

  const sivut: SivuSuunnitelma[] = [];
  let nyt: SivuSuunnitelma = { otsikkoY: otsikkoY1, rivit: [], loppuY: otsikkoY1 + OTSIKKORIVI_MM };
  for (const r of suunnitellut) {
    if (nyt.rivit.length > 0 && nyt.loppuY + r.korkeus > SISALTO_ALA_MM) {
      sivut.push(nyt);
      nyt = {
        otsikkoY: JATKO_TAULUKKO_YLA_MM,
        rivit: [],
        loppuY: JATKO_TAULUKKO_YLA_MM + OTSIKKORIVI_MM,
      };
    }
    nyt.rivit.push(r);
    nyt.loppuY += r.korkeus;
  }
  sivut.push(nyt);

  // Summat ja maksuosa viimeiselle sivulle; jos eivät mahdu, viimeinen rivi siirtyy mukaan
  // uudelle sivulle (summia ei jätetä yksin); jos sekään ei auta, summat saavat rivittömän sivun.
  const tarvitaan = summatKorkeus(malli) + maksuosaVaraus(malli);
  const mahtuu = (s: SivuSuunnitelma) => s.loppuY + tarvitaan <= SISALTO_ALA_MM;
  const viimeinen = sivut[sivut.length - 1];
  if (viimeinen !== undefined && !mahtuu(viimeinen)) {
    const siirrettava = viimeinen.rivit.length > 1 ? viimeinen.rivit.at(-1) : undefined;
    const uusi: SivuSuunnitelma = {
      otsikkoY: siirrettava !== undefined ? JATKO_TAULUKKO_YLA_MM : null,
      rivit: siirrettava !== undefined ? [siirrettava] : [],
      loppuY:
        siirrettava !== undefined
          ? JATKO_TAULUKKO_YLA_MM + OTSIKKORIVI_MM + siirrettava.korkeus
          : JATKO_TAULUKKO_YLA_MM,
    };
    if (siirrettava === undefined || mahtuu(uusi)) {
      if (siirrettava !== undefined) {
        viimeinen.rivit.pop();
        viimeinen.loppuY -= siirrettava.korkeus;
      }
      sivut.push(uusi);
    } else {
      sivut.push({ otsikkoY: null, rivit: [], loppuY: JATKO_TAULUKKO_YLA_MM });
    }
  }
  return { sivut, aiheRivit, aiheY };
}

// ---------- sivun osat ----------

function piirraAlatunniste(sivu: PDFPage, malli: LaskuMalli, fontit: Fontit): void {
  viiva(sivu, SISALTO_VASEN_MM, SISALTO_OIKEA_MM, ALATUNNISTE_YLA_MM, VIIVA);
  const n = malli.alatunniste.length;
  if (n === 0) return;
  const sarakeLeveys = SISALTO_LEVEYS_MM / n;
  malli.alatunniste.forEach((sarake, i) => {
    const x = SISALTO_VASEN_MM + i * sarakeLeveys;
    const rivit = sarake
      .flatMap((r) => rivita(r, fontit.normaali, 7.5, sarakeLeveys - 3))
      .slice(0, 5);
    rivit.forEach((r, k) =>
      teksti(
        sivu,
        r,
        x,
        ALATUNNISTE_YLA_MM + 3.5 + k * ALATUNNISTE_RIVI_MM,
        fontit.normaali,
        7.5,
        HIMMEA,
      ),
    );
  });
}

function piirraEnsimmainenYlaosa(
  sivu: PDFPage,
  malli: LaskuMalli,
  fontit: Fontit,
  sivuNro: number,
  sivuja: number,
): void {
  // Myyjä vasemmalla ylhäällä.
  malli.myyja.slice(0, 5).forEach((r, i) => {
    if (i === 0) teksti(sivu, r, SISALTO_VASEN_MM, 21, fontit.lihava, 12);
    else teksti(sivu, r, SISALTO_VASEN_MM, 26.5 + (i - 1) * 4.4, fontit.normaali, 9, HIMMEA);
  });
  // Otsikkolohko oikealla.
  tekstiOikealle(sivu, malli.otsikko, SISALTO_OIKEA_MM, 22, fontit.lihava, 20);
  tekstiOikealle(
    sivu,
    `Sivu ${sivuNro}/${sivuja}`,
    SISALTO_OIKEA_MM,
    28,
    fontit.normaali,
    9,
    HIMMEA,
  );
  // Ostajan osoite ikkunakuoren kohdalla.
  malli.ostaja
    .slice(0, Math.floor(OSTAJA.korkeus / 4.8))
    .forEach((r, i) =>
      teksti(sivu, r, OSTAJA.vasen, OSTAJA.yla + 4 + i * 4.8, fontit.normaali, 10),
    );
  // Tietolaatikko.
  if (malli.info.length > 0) {
    const korkeus = malli.info.length * INFO_RIVI_MM + 5;
    sivu.drawRectangle({
      x: mm(INFO.vasen),
      y: yPt(INFO.yla + korkeus),
      width: mm(INFO.oikea - INFO.vasen),
      height: mm(korkeus),
      color: TAUSTA,
    });
    malli.info.forEach((r, i) => {
      const y = INFO.yla + 4.7 + i * INFO_RIVI_MM;
      teksti(sivu, r.nimike, INFO.vasen + 2.5, y, fontit.normaali, 8, HIMMEA);
      teksti(sivu, r.arvo, INFO.arvoVasen, y, fontit.normaali, 8.5);
    });
  }
}

function piirraJatkoYlaosa(
  sivu: PDFPage,
  malli: LaskuMalli,
  fontit: Fontit,
  sivuNro: number,
  sivuja: number,
): void {
  teksti(sivu, malli.myyja[0] ?? '', SISALTO_VASEN_MM, 20, fontit.lihava, 10);
  const otsikko = malli.numero !== null ? `${malli.otsikko} ${malli.numero}` : malli.otsikko;
  tekstiOikealle(sivu, otsikko, SISALTO_OIKEA_MM, 20, fontit.lihava, 12);
  tekstiOikealle(
    sivu,
    `Sivu ${sivuNro}/${sivuja}`,
    SISALTO_OIKEA_MM,
    25,
    fontit.normaali,
    9,
    HIMMEA,
  );
}

function piirraOtsikkorivi(sivu: PDFPage, fontit: Fontit, yla: number): void {
  const y = yla + 3.6;
  teksti(sivu, 'Selite', SARAKE.seliteVasen, y, fontit.lihava, 8.5, HIMMEA);
  tekstiOikealle(sivu, 'Määrä', SARAKE.maaraOikea, y, fontit.lihava, 8.5, HIMMEA);
  tekstiOikealle(sivu, 'À-hinta', SARAKE.aHintaOikea, y, fontit.lihava, 8.5, HIMMEA);
  tekstiOikealle(sivu, 'Alv %', SARAKE.alvOikea, y, fontit.lihava, 8.5, HIMMEA);
  tekstiOikealle(sivu, 'Yhteensä', SARAKE.yhteensaOikea, y, fontit.lihava, 8.5, HIMMEA);
  viiva(sivu, SISALTO_VASEN_MM, SISALTO_OIKEA_MM, yla + 5, HIMMEA);
}

function piirraRivit(sivu: PDFPage, fontit: Fontit, s: SivuSuunnitelma): void {
  if (s.otsikkoY === null) return;
  let y = s.otsikkoY + OTSIKKORIVI_MM;
  for (const { rivi, selite, korkeus } of s.rivit) {
    const perusviiva = y + RIVI_PAD_MM + 3.1;
    selite.forEach((r, i) =>
      teksti(
        sivu,
        r,
        SARAKE.seliteVasen,
        perusviiva + i * RIVI_VALI_MM,
        fontit.normaali,
        RIVI_KOKO,
      ),
    );
    const f = fontit.normaali;
    tekstiOikealle(sivu, rivi.maara, SARAKE.maaraOikea, perusviiva, f, RIVI_KOKO, TEKSTI, 14);
    tekstiOikealle(sivu, rivi.aHinta, SARAKE.aHintaOikea, perusviiva, f, RIVI_KOKO, TEKSTI, 27);
    tekstiOikealle(sivu, rivi.alv, SARAKE.alvOikea, perusviiva, f, RIVI_KOKO, TEKSTI, 15);
    tekstiOikealle(sivu, rivi.yhteensa, SARAKE.yhteensaOikea, perusviiva, f, RIVI_KOKO, TEKSTI, 30);
    y += korkeus;
    viiva(sivu, SISALTO_VASEN_MM, SISALTO_OIKEA_MM, y, VIIVA);
  }
}

function piirraSummat(sivu: PDFPage, malli: LaskuMalli, fontit: Fontit, alkuY: number): void {
  const vasen = 125;
  viiva(sivu, vasen, SISALTO_OIKEA_MM, alkuY + 3, HIMMEA);
  malli.summat.forEach((r, i) => {
    const y = alkuY + 7.5 + i * SUMMA_RIVI_MM;
    const font = r.vahva ? fontit.lihava : fontit.normaali;
    const koko = r.vahva ? 10.5 : 9.5;
    teksti(sivu, r.nimike, vasen, y, font, koko);
    tekstiOikealle(sivu, r.arvo, SISALTO_OIKEA_MM, y, font, koko, TEKSTI, 40);
  });
}

// ---------- julkinen API ----------

function asetaMetatiedot(doc: PDFDocument, malli: LaskuMalli): void {
  // Kiinteät metatiedot (ei "nyt"-aikaa): sama lasku antaa aina samat tavut.
  const pvm = new Date(`${malli.laskupvmIso}T00:00:00Z`);
  doc.setTitle(malli.numero !== null ? `${malli.otsikko} ${malli.numero}` : malli.otsikko);
  doc.setAuthor(malli.myyja[0] ?? '');
  doc.setProducer('Penni');
  doc.setCreator('Penni');
  doc.setLanguage('fi-FI');
  doc.setCreationDate(pvm);
  doc.setModificationDate(pvm);
}

/**
 * Piirtää laskun A4-PDF:ksi näkymämallista. Tulos on tavu tavulta deterministinen: sama
 * malli antaa aina samat tavut (kiinteät metatiedot, ei satunnaisia fonttitunnisteita).
 */
export async function rakennaLaskuPdf(malli: LaskuMalli): Promise<Uint8Array> {
  // updateMetadata: false — pdf-lib ei kirjoita oletuksena "nyt"-aikaa ja tuotenimeä.
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fontit = await lataaFontit(doc);
  asetaMetatiedot(doc, malli);

  const { sivut, aiheRivit, aiheY } = suunnitteleSivut(malli, fontit);
  sivut.forEach((s, i) => {
    const sivu = doc.addPage([A4_LEVEYS, A4_KORKEUS]);
    const nro = i + 1;
    if (i === 0) {
      piirraEnsimmainenYlaosa(sivu, malli, fontit, nro, sivut.length);
      aiheRivit.forEach((r, k) =>
        teksti(sivu, r, SISALTO_VASEN_MM, aiheY + k * 5, fontit.lihava, 10),
      );
    } else {
      piirraJatkoYlaosa(sivu, malli, fontit, nro, sivut.length);
    }
    if (s.otsikkoY !== null) piirraOtsikkorivi(sivu, fontit, s.otsikkoY);
    piirraRivit(sivu, fontit, s);
    piirraAlatunniste(sivu, malli, fontit);

    if (i === sivut.length - 1) {
      piirraSummat(sivu, malli, fontit, s.loppuY);
      // Maksuosa piirretään suunnitteluvaiheessa varatulle alueelle (maksuosaVaraus).
      if (malli.maksu !== null) {
        piirraMaksuosa(sivu, malli.maksu, SISALTO_ALA_MM - MAKSUOSA_KORKEUS_MM, fontit);
      }
    }
  });
  // Ilman objektivirtoja PDF:n sanakirjat ovat pakkaamatonta tekstiä: tavut pysyvät
  // helposti tarkastettavina (testi lukee fonttinimet) ja vanhat lukijat pärjäävät.
  return doc.save({ useObjectStreams: false });
}
