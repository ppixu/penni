import { type Cents, Euro, muotoileEuro } from '@penni/euro';
import type { IsoDate } from '../../vouchers/types.js';
import type { Tiliote } from '../poimiKuukausitiliote.js';
import type { AlkuperainenSumma, Tilitapahtuma } from '../poimiTiliote.js';
import { type XmlElementti, lapset, lapsi, lueXml, teksti } from './xml.js';
import { TiliotetiedostoVirhe, yhdistaTiliotteet } from './yhteiset.js';

type Suunta = 'CRDT' | 'DBIT';

function virhe(viesti: string): TiliotetiedostoVirhe {
  return new TiliotetiedostoVirhe('VAARA_MUOTO', viesti);
}

function tiivista(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Tekstin arvo, tai undefined kun elementtiä ei ole tai se on tyhjä. */
function eiTyhja(s: string | undefined): string | undefined {
  const t = s === undefined ? undefined : tiivista(s);
  return t === '' ? undefined : t;
}

/** Elementin Ccy-attribuutti on EUR (tai puuttuu); muu valuutta → VALUUTTA-virhe. */
function tarkistaEuro(e: XmlElementti, missa: string): void {
  const valuutta = e.attr.Ccy;
  if (valuutta !== undefined && valuutta !== 'EUR')
    throw new TiliotetiedostoVirhe(
      'VALUUTTA',
      `Tiedosto sisältää muuta kuin euromääräisiä tietoja (${missa}: ${valuutta}); vain euromääräiset tiliotteet voidaan lukea`,
    );
}

/** camt-summa ('1234.5', '0.10', '1000'): positiivinen, pisteellä ja enintään kahdella desimaalilla. */
function lueSumma(s: string | undefined, missa: string): Cents {
  if (s === undefined || !/^\d+(?:\.\d{1,2})?$/.test(s))
    throw virhe(`Virheellinen summa "${s ?? ''}" (${missa})`);
  return Euro.fromString(s);
}

function lueEuroSumma(e: XmlElementti, missa: string): Cents {
  tarkistaEuro(e, missa);
  return lueSumma(e.teksti, missa);
}

function suunta(e: XmlElementti | undefined, missa: string): Suunta {
  const s = teksti(e, 'CdtDbtInd');
  if (s === 'CRDT' || s === 'DBIT') return s;
  throw virhe(`Virheellinen tai puuttuva CdtDbtInd (${missa})`);
}

function etumerkilla(maara: Cents, ind: Suunta): Cents {
  return ind === 'DBIT' ? Euro.neg(maara) : maara;
}

/** 'YYYY-MM-DD' tai 'YYYY-MM-DDThh:mm…' → ISO-päivä; muuten undefined. */
function isoPaiva(s: string | undefined): IsoDate | undefined {
  const m = s === undefined ? null : /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(s.trim());
  if (!m) return undefined;
  const paiva = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${paiva}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(paiva)
    ? (paiva as IsoDate)
    : undefined;
}

/**
 * Kauden loppu ToDtTm-kentästä. Tasan keskiyöhön (T00:00:00, mikä tahansa aikavyöhyke)
 * päättyvä kausi on poissulkeva: viimeinen päivä on edellinen päivä. Aikavyöhykkeitä ei muuten
 * muunneta.
 */
function kaudenLoppu(s: string | undefined, alkaa: IsoDate | undefined): IsoDate | undefined {
  const paiva = isoPaiva(s);
  if (!paiva || !/T00:00:00(?:\.0+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(s?.trim() ?? '')) return paiva;
  const d = new Date(`${paiva}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const edellinen = d.toISOString().slice(0, 10) as IsoDate;
  return alkaa && edellinen < alkaa ? paiva : edellinen;
}

/** Päivä-elementti: 'Dt' (pelkkä päivä) tai 'DtTm' (päivä ja kellonaika). */
function paivaElementista(e: XmlElementti | undefined): IsoDate | undefined {
  return isoPaiva(teksti(e, 'Dt')) ?? isoPaiva(teksti(e, 'DtTm'));
}

function normalisoiIban(s: string | undefined): string | undefined {
  const t = s?.replace(/\s+/g, '').toUpperCase();
  return t ? t : undefined;
}

interface Saldo {
  maara: Cents;
  pvm?: IsoDate;
}

function haeSaldo(stmt: XmlElementti, ...koodit: string[]): Saldo | undefined {
  for (const koodi of koodit) {
    const bal = lapset(stmt, 'Bal').find((b) => teksti(b, 'Tp', 'CdOrPrtry', 'Cd') === koodi);
    if (!bal) continue;
    const amt = lapsi(bal, 'Amt');
    if (!amt) throw virhe(`Saldolta ${koodi} puuttuu summa`);
    const maara = etumerkilla(lueEuroSumma(amt, `saldo ${koodi}`), suunta(bal, `saldo ${koodi}`));
    const pvm = paivaElementista(lapsi(bal, 'Dt'));
    return pvm ? { maara, pvm } : { maara };
  }
  return undefined;
}

/** Erän (Btch) maksujen lukumäärä, jos tiedosto ilmoittaa sen. */
function eranLukumaara(ntry: XmlElementti): number | undefined {
  for (const d of lapset(ntry, 'NtryDtls')) {
    const n = teksti(d, 'Btch', 'NbOfTxs');
    if (n !== undefined && /^\d+$/.test(n)) return Number.parseInt(n, 10);
  }
  return undefined;
}

/** Maksun oma summa (Amt tai AmtDtls/TxAmt/Amt), jos TxDtls ilmoittaa sellaisen. */
function maksunSumma(tx: XmlElementti): XmlElementti | undefined {
  const amt = lapsi(tx, 'Amt') ?? lapsi(tx, 'AmtDtls', 'TxAmt', 'Amt');
  return amt && amt.teksti !== '' ? amt : undefined;
}

/** Ostovaluutan alkuperäinen summa (AmtDtls/InstdAmt), kun se on muu kuin euro. */
function alkuperainenSumma(osa: XmlElementti | undefined): AlkuperainenSumma | undefined {
  const amt = lapsi(osa, 'AmtDtls', 'InstdAmt', 'Amt');
  const valuutta = amt?.attr.Ccy;
  if (!amt || !valuutta || valuutta === 'EUR') return undefined;
  if (!/^\d+(?:\.\d+)?$/.test(amt.teksti))
    throw virhe(`Virheellinen summa "${amt.teksti}" (alkuperäinen summa)`);
  return { valuutta, maara: Euro.fromString(amt.teksti) };
}

interface RiviLahde {
  ntry: XmlElementti;
  /** Maksukohtaiset tiedot (TxDtls), jos käytössä. */
  tx: XmlElementti | undefined;
  /** Rivi on yksi erän maksuista: erätason tiedot (esim. alkuperäinen summa) koskevat koko erää. */
  jaettu?: boolean;
}

function vastapuolenNimi(tx: XmlElementti | undefined, ind: Suunta): string | undefined {
  const osapuoli = lapsi(tx, 'RltdPties', ind === 'CRDT' ? 'Dbtr' : 'Cdtr');
  return eiTyhja(teksti(osapuoli, 'Nm')) ?? eiTyhja(teksti(osapuoli, 'Pty', 'Nm'));
}

function vastapuolenIban(tx: XmlElementti | undefined, ind: Suunta): string | undefined {
  return normalisoiIban(
    teksti(tx, 'RltdPties', ind === 'CRDT' ? 'DbtrAcct' : 'CdtrAcct', 'Id', 'IBAN'),
  );
}

function viiteJaViesti(tx: XmlElementti | undefined): { viite?: string; viesti?: string } {
  const rmt = lapsi(tx, 'RmtInf');
  const tulos: { viite?: string; viesti?: string } = {};
  for (const strd of lapset(rmt, 'Strd')) {
    const viite = teksti(strd, 'CdtrRefInf', 'Ref')?.replace(/\s+/g, '');
    if (viite) {
      tulos.viite = viite;
      break;
    }
  }
  const viesti = eiTyhja(
    lapset(rmt, 'Ustrd')
      .map((u) => u.teksti)
      .join(' '),
  );
  if (viesti) tulos.viesti = viesti;
  return tulos;
}

function muodostaRivi(
  pvm: IsoDate,
  maara: Cents,
  ind: Suunta,
  { ntry, tx, jaettu }: RiviLahde,
  arkistotunnus: string | undefined,
  nimiOverride?: string,
): Tilitapahtuma {
  const nimi =
    nimiOverride ??
    vastapuolenNimi(tx, ind) ??
    eiTyhja(teksti(ntry, 'AddtlNtryInf')) ??
    eiTyhja(teksti(tx, 'AddtlTxInf')) ??
    eiTyhja(teksti(ntry, 'BkTxCd', 'Prtry', 'Cd')) ??
    'Tilitapahtuma';
  const rivi: Tilitapahtuma = { pvm, nimi, maara };
  const { viite, viesti } = viiteJaViesti(tx);
  if (viite) rivi.viite = viite;
  if (viesti) rivi.viesti = viesti;
  const alkuperainen = alkuperainenSumma(tx) ?? (jaettu ? undefined : alkuperainenSumma(ntry));
  if (alkuperainen) rivi.alkuperainen = alkuperainen;
  if (arkistotunnus) rivi.arkistotunnus = arkistotunnus;
  const iban = vastapuolenIban(tx, ind);
  if (iban) rivi.iban = iban;
  return rivi;
}

function onKirjattu(ntry: XmlElementti): boolean {
  const sts = lapsi(ntry, 'Sts');
  if (!sts) return true;
  return (sts.teksti || teksti(sts, 'Cd')) === 'BOOK';
}

/** Yksi kirjattu Ntry → yksi rivi, tai erän tapauksessa rivi per maksu. */
function lueNtry(ntry: XmlElementti): Tilitapahtuma[] {
  const pvm = paivaElementista(lapsi(ntry, 'BookgDt')) ?? paivaElementista(lapsi(ntry, 'ValDt'));
  if (!pvm) throw virhe('Tapahtumalta puuttuu kirjauspäivä (BookgDt)');
  const amt = lapsi(ntry, 'Amt');
  if (!amt) throw virhe('Tapahtumalta puuttuu summa (Amt)');
  const ind = suunta(ntry, 'tapahtuma');
  const maara = etumerkilla(lueEuroSumma(amt, 'tapahtuma'), ind);
  const ntryRef = eiTyhja(teksti(ntry, 'AcctSvcrRef'));

  const txt = lapset(ntry, 'NtryDtls').flatMap((d) => lapset(d, 'TxDtls'));
  const summat = txt.map(maksunSumma);

  if (txt.length > 1 && summat.every((s) => s !== undefined)) {
    const rivit = txt.map((tx, i): { rivi: Tilitapahtuma; summa: Cents } => {
      const txAmt = summat[i] as XmlElementti;
      const txInd = lapsi(tx, 'CdtDbtInd') ? suunta(tx, 'maksu') : ind;
      const summa = etumerkilla(lueEuroSumma(txAmt, 'maksu'), txInd);
      const arkisto = eiTyhja(teksti(tx, 'Refs', 'AcctSvcrRef')) ?? ntryRef;
      return { rivi: muodostaRivi(pvm, summa, txInd, { ntry, tx, jaettu: true }, arkisto), summa };
    });
    const yhteensa = rivit.reduce((s, r) => Euro.add(s, r.summa), 0 as Cents);
    if (yhteensa !== maara)
      throw virhe(
        `Erän maksujen summa ${muotoileEuro(yhteensa)} ei vastaa tapahtuman summaa ${muotoileEuro(maara)} (${pvm})`,
      );
    return rivit.map((r) => r.rivi);
  }

  const lkm = eranLukumaara(ntry) ?? txt.length;
  const era = lkm > 1;
  // Erässä, jonka maksuilla ei ole omia summia, yksittäisen maksun tiedot eivät kuvaa koko riviä.
  const tx = era ? undefined : txt[0];
  const arkisto = ntryRef ?? eiTyhja(teksti(tx, 'Refs', 'AcctSvcrRef'));
  return [muodostaRivi(pvm, maara, ind, { ntry, tx }, arkisto, era ? `${lkm} maksua` : undefined)];
}

function lueOte(ote: XmlElementti, lahde: 'camt053' | 'camt054'): Tiliote {
  const valuutta = eiTyhja(teksti(ote, 'Acct', 'Ccy'));
  if (valuutta && valuutta !== 'EUR')
    throw new TiliotetiedostoVirhe(
      'VALUUTTA',
      `Tili on muuta kuin euromääräinen (${valuutta}); vain euromääräiset tiliotteet voidaan lukea`,
    );

  const tapahtumat = lapset(ote, 'Ntry')
    .filter(onKirjattu)
    .flatMap((n) => lueNtry(n));

  const alku = haeSaldo(ote, 'OPBD', 'PRCD');
  const loppu = haeSaldo(ote, 'CLBD');

  // camt.054 on ilmoitus, ei jaksotiliote: sen kausi päätellään aina tapahtumien päivistä.
  const ilmoitettu = lahde === 'camt053';
  const alkaa = ilmoitettu ? (isoPaiva(teksti(ote, 'FrToDt', 'FrDtTm')) ?? alku?.pvm) : undefined;
  const loppuu = ilmoitettu
    ? (kaudenLoppu(teksti(ote, 'FrToDt', 'ToDtTm'), alkaa) ?? loppu?.pvm)
    : undefined;

  const tulos: Tiliote = { muoto: 'tapahtumat', tapahtumat, lahde };
  const iban = normalisoiIban(teksti(ote, 'Acct', 'Id', 'IBAN'));
  if (iban) tulos.iban = iban;
  if (alku) tulos.alkusaldo = alku.maara;
  if (loppu) tulos.loppusaldo = loppu.maara;

  if (alkaa && loppuu) {
    tulos.kausi = { alkaa, loppuu };
    if (alku && loppu) tulos.muoto = 'kuukausitiliote';
  } else if (tapahtumat.length > 0) {
    const paivat = tapahtumat.map((t) => t.pvm).sort();
    tulos.kausi = {
      alkaa: paivat[0] as IsoDate,
      loppuu: paivat[paivat.length - 1] as IsoDate,
    };
    tulos.kausiPaatelty = true;
  }
  return tulos;
}

/**
 * Lukee camt.053 (tiliote) tai camt.054 (viitemaksuilmoitus) -tiedoston. Tiedoston useat
 * tiliotteet yhdistetään yhdeksi; kaikkien on oltava samalta tililtä. Vain euromääräiset
 * tilit ja kirjatut (BOOK) tapahtumat luetaan; erät puretaan maksuiksi, kun maksuilla on omat
 * summat.
 */
export function poimiCamt(xml: string): Tiliote {
  const juuri = lueXml(xml);
  const kontti =
    juuri.nimi === 'BkToCstmrStmt' || juuri.nimi === 'BkToCstmrDbtCdtNtfctn'
      ? juuri
      : (lapsi(juuri, 'BkToCstmrStmt') ?? lapsi(juuri, 'BkToCstmrDbtCdtNtfctn'));
  if (!kontti)
    throw virhe('Tiedosto ei ole camt.053- tai camt.054-tiliote (BkToCstmrStmt puuttuu)');
  const lahde = kontti.nimi === 'BkToCstmrStmt' ? 'camt053' : 'camt054';
  const otteet = lapset(kontti, lahde === 'camt053' ? 'Stmt' : 'Ntfctn');
  if (otteet.length === 0) throw virhe('Tiedostossa ei ole tiliotteita');

  const osat = otteet.map((o) => lueOte(o, lahde));
  const ibanit = new Set(osat.map((o) => o.iban).filter((i) => i !== undefined));
  if (ibanit.size > 1)
    throw virhe(`Tiedostossa on usean eri tilin tiliotteita (${[...ibanit].join(', ')})`);
  return yhdistaTiliotteet(osat);
}
