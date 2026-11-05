import { readFileSync } from 'node:fs';
import { validateXML } from 'xmllint-wasm';

/*
 * Testiapu: XML:n validointi Tulorekisterin XSD-paketteja vastaan (xmllint-wasm, ei järjestelmän
 * binääriä). XSD:t ovat testiaineistoa hakemistossa `packages/palkat/xsd/<paketin vuosi>/`.
 * Tätä tiedostoa ei käännetä pakettiin (ks. tsconfig `exclude`).
 */

const TIEDOSTOT = [
  'WageReportsToIR.xsd',
  'WageReportsToIRTypes.xsd',
  'PayerSummaryReportsToIR.xsd',
  'PayerSummaryReportsToIRTypes.xsd',
  'IRCommonTypes.xsd',
  'xmldsig-core-schema.xsd',
] as const;

export type XsdVuosi = '2025' | '2027';
type Juuri = 'WageReportsToIR.xsd' | 'PayerSummaryReportsToIR.xsd';

function lue(vuosi: XsdVuosi, nimi: string) {
  return {
    fileName: nimi,
    contents: new Uint8Array(readFileSync(new URL(`../../xsd/${vuosi}/${nimi}`, import.meta.url))),
  };
}

/** Palauttaa virheviestit (tyhjä lista = validi). Kaikki kuusi skeemaa ladataan muistiin. */
export async function xsdVirheet(xml: string, vuosi: XsdVuosi, juuri: Juuri): Promise<string[]> {
  const tulos = await validateXML({
    xml: { fileName: 'ilmoitus.xml', contents: xml },
    schema: lue(vuosi, juuri),
    preload: TIEDOSTOT.filter((t) => t !== juuri).map((t) => lue(vuosi, t)),
  });
  return tulos.valid ? [] : tulos.errors.map((e) => e.message);
}
