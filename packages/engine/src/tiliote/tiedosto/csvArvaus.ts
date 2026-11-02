import { tarkistaIban, tarkistaRfViite, tarkistaViite } from '@penni/validator';
import {
  type CsvSarakkeet,
  type CsvTaulukko,
  PVM_MUODOT,
  type PvmMuoto,
  lueCsvPvm,
  lueCsvSumma,
} from './csv.js';

type Muoto = PvmMuoto | 'iban' | 'viite' | 'raha' | 'teksti' | 'tyhja';

/** Yhden solun muoto (järjestys kuten Kitsas, csvtuonti.cpp:745-773). */
function solunMuoto(teksti: string): Muoto {
  const valeitta = teksti.replace(/\s/g, '');
  if (valeitta === '') return 'tyhja';
  const pvm = PVM_MUODOT.find((m) => lueCsvPvm(teksti, m) !== undefined);
  if (pvm) return pvm;
  if (!valeitta.toUpperCase().startsWith('RF') && tarkistaIban(valeitta)) return 'iban';
  if (tarkistaViite(valeitta) || tarkistaRfViite(valeitta)) return 'viite';
  try {
    lueCsvSumma(teksti);
    return 'raha';
  } catch {
    return 'teksti';
  }
}

/**
 * Sarakkeen muoto: kaikkien ei-tyhjien solujen yhteinen muoto. Viitteeltä näyttävä luku
 * rahasarakkeessa ei tee siitä tekstiä (Kitsas: RAHA + VIITE → RAHA, csvtuonti.cpp:785-786);
 * muu ristiriita → teksti.
 */
function sarakkeenMuoto(rivit: readonly string[][], i: number): Muoto {
  let muoto: Muoto = 'tyhja';
  for (const rivi of rivit) {
    const m = solunMuoto(rivi[i] ?? '');
    if (m === 'tyhja' || m === muoto) continue;
    if (muoto === 'tyhja') muoto = m;
    else if ((muoto === 'raha' && m === 'viite') || (muoto === 'viite' && m === 'raha'))
      muoto = 'raha';
    else return 'teksti';
  }
  return muoto;
}

const onPvm = (m: Muoto): m is PvmMuoto => (PVM_MUODOT as readonly string[]).includes(m);

/**
 * Ehdottaa tuntemattoman CSV:n sarakejakoa sarakkeiden arvojen ja otsikoiden perusteella Kitsasin
 * tiliotetilan säännöin (`CsvTuonti::paivitaOletukset`, csvtuonti.cpp:657-703): ensimmäinen
 * päiväsarake → pvm, ensimmäinen rahasarake → määrä (tai debet/kredit-nimetty pari), IBAN →
 * iban, viite → viite, "arkisto" → arkistotunnus, saaja/maksaja/vastapuoli (ei "tili") → nimi,
 * selite/viesti/kuvaus → viesti. Penni lisää: rahasarake, jonka otsikossa on "saldo" → saldo,
 * ja "valuutta"/"currency" → valuutta.
 * Ilman päiväsaraketta ehdotus on sarake 0 (käyttäjä korjaa sen sarakejaossa).
 */
export function ehdotaCsvSarakkeet(taulukko: CsvTaulukko): CsvSarakkeet {
  const otsikot = taulukko.otsikot.map((o) => o.toLowerCase());
  const muodot = otsikot.map((_, i) => sarakkeenMuoto(taulukko.rivit, i));
  const pari =
    muodot.some((m, i) => m === 'raha' && otsikot[i]?.includes('debet')) &&
    muodot.some((m, i) => m === 'raha' && otsikot[i]?.includes('kredit'));

  const s: Partial<CsvSarakkeet> & Pick<CsvSarakkeet, 'nimi' | 'viesti'> = { nimi: [], viesti: [] };
  otsikot.forEach((otsikko, i) => {
    const muoto = muodot[i] ?? 'teksti';
    const raha = muoto === 'raha';
    if (onPvm(muoto) && s.pvm === undefined) {
      s.pvm = i;
      s.pvmMuoto = muoto;
    } else if (raha && otsikko.includes('saldo') && s.saldo === undefined) s.saldo = i;
    else if (raha && pari && otsikko.includes('debet') && s.debet === undefined) s.debet = i;
    else if (raha && pari && otsikko.includes('kredit') && s.kredit === undefined) s.kredit = i;
    else if (raha && !pari && s.maara === undefined) s.maara = i;
    else if (muoto === 'iban' && s.iban === undefined) s.iban = i;
    else if ((muoto === 'viite' || otsikko.includes('viite')) && s.viite === undefined) s.viite = i;
    else if (otsikko.includes('arkisto') && s.arkistotunnus === undefined) s.arkistotunnus = i;
    else if (/valuutta|currency/.test(otsikko) && s.valuutta === undefined) s.valuutta = i;
    else if (/saaja|maksaja|vastapuoli/.test(otsikko) && !otsikko.includes('tili')) s.nimi.push(i);
    else if (/selite|viesti|kuvaus/.test(otsikko)) s.viesti.push(i);
  });
  return { ...s, pvm: s.pvm ?? 0, pvmMuoto: s.pvmMuoto ?? 'd.m.yyyy' };
}
