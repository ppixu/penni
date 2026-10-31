/** Yhteinen kenttäskeema + säännöt (jaettu kuva- ja tekstipolun kesken). */
const SKEEMA_OHJE = [
  'Tehtävä: poimi suomalaisen kuitin tai laskun tiedot ja palauta VAIN yksi JSON-objekti.',
  'Älä kirjoita selityksiä, muuta tekstiä tai koodiaitoja.',
  'ÄLÄ kopioi alla olevia kenttäkuvauksia — käytä ainoastaan dokumentista löytyviä oikeita arvoja.',
  'Kentät:',
  '- myyja: myyjän tai laskuttajan nimi (merkkijono)',
  '- ytunnus: Y-tunnus muodossa NNNNNNN-N, jos näkyvissä',
  '- pvm: päiväys muodossa YYYY-MM-DD',
  '- valuutta: valuuttakoodi, esimerkiksi EUR',
  '- bruttoSumma: koko verollinen loppusumma euroina YHTENÄ lukuna (ei olio, ei erittely)',
  '- alv: taulukko verokannoittain; kukin alkio { "kanta": ALV-prosentti lukuna, "netto": veroton euroina, "vero": veron määrä euroina, "brutto": verollinen euroina }',
  'Käytä pistettä desimaalierottimena. Jätä kenttä pois, jos tietoa ei löydy. Älä keksi arvoja.',
].join('\n');

/** Yksi esimerkki (few-shot) ohjaa pientä mallia oikeaan muotoon ja päivämuunnokseen. */
const ESIMERKKI = [
  'Esimerkki toisesta dokumentista.',
  'Dokumentti: "Ravintola Aada Oy  Y-tunnus 1234567-8  12.03.2026  Alv% 14 Netto 20,00 Vero 2,80 Brutto 22,80  Yhteensä EUR 22,80"',
  'JSON: {"myyja":"Ravintola Aada Oy","ytunnus":"1234567-8","pvm":"2026-03-12","valuutta":"EUR","bruttoSumma":22.80,"alv":[{"kanta":14,"netto":20.00,"vero":2.80,"brutto":22.80}]}',
].join('\n');

/** Kuvapohjainen kehote: kuitti on oheisessa kuvassa; malli poimii kentät JSONiksi. */
export function rakennaKuittiKehote(): string {
  return `${SKEEMA_OHJE}\n\nKuitti on oheisessa kuvassa. Palauta VAIN JSON.`;
}

/**
 * Tekstipohjainen kehote: sama kenttäskeema + yksi esimerkki + pdf.js:n poimima tarkka
 * dokumenttiteksti. Esimerkki vähentää pienen mallin taipumusta kopioida kenttäkuvauksia.
 */
export function rakennaTekstiKehote(dokumenttiTeksti: string): string {
  return [
    SKEEMA_OHJE,
    '',
    ESIMERKKI,
    '',
    'Poimi nyt seuraava dokumentti ja palauta VAIN JSON.',
    `Dokumentti: "${dokumenttiTeksti}"`,
    'JSON:',
  ].join('\n');
}

/**
 * Litterointikehote näkömallille. Rivinvaihdot on pyydettävä erikseen: `poimiKuittiTekstista`
 * lukee rivi kerrallaan, ja yhteen riviin tiivistetty litteraatti päätyy kokonaan `myyja`-kenttään.
 * Kehote kieltää myös laskemisen ja täydentämisen — litteroija ei saa keksiä puuttuvaa arvoa.
 */
export const OCR_KEHOTE = [
  'Transcribe every line of text in this receipt image verbatim, in reading order from top to bottom.',
  'Preserve the line structure: write each printed line on its own line and keep the original line breaks. Never join several lines into one.',
  'Text that sits on the same visual row, such as a label and its amount or date, belongs on one line, separated by spaces.',
  'Copy numbers, dates, currency symbols and percent signs exactly as printed. Do not calculate, correct, translate or add anything; if a value is not printed (blank field, no price), do not write one.',
  'Output plain text only — no commentary, no JSON, no code fences.',
].join('\n');
