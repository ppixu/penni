import type { Cents } from '@penni/euro';
import { muotoilePvm } from '@penni/euro';
import type { IsoDate } from '../../vouchers/types.js';
import type { Tiliote } from '../poimiKuukausitiliote.js';

/** Mistä tiedostomuodosta tiliote on luettu. */
export type TiliotteenLahde = 'pdf' | 'camt053' | 'camt054' | 'tito' | 'csv';

/** Tallennettavan tiliotetiedoston MIME-tyyppi lähteen mukaan. */
export const TILIOTTEEN_MIME: Record<TiliotteenLahde, string> = {
  pdf: 'application/pdf',
  camt053: 'application/xml',
  camt054: 'application/xml',
  tito: 'text/plain',
  csv: 'text/csv',
};

export type TiliotetiedostoVirheKoodi = 'TUNTEMATON' | 'VAARA_MUOTO' | 'CSV_SARAKKEET' | 'VALUUTTA';

/** Tiliotetiedoston lukuvirhe: viesti on suomeksi käyttäjälle näytettäväksi. */
export class TiliotetiedostoVirhe extends Error {
  readonly koodi: TiliotetiedostoVirheKoodi;
  /** Rivi tiedostossa (1 = ensimmäinen), jos tiedossa. */
  readonly rivi?: number;

  constructor(koodi: TiliotetiedostoVirheKoodi, viesti: string, rivi?: number) {
    super(rivi === undefined ? viesti : `${viesti} (rivi ${rivi})`);
    this.name = 'TiliotetiedostoVirhe';
    this.koodi = koodi;
    if (rivi !== undefined) this.rivi = rivi;
  }
}

/**
 * Tiedoston tavut tekstiksi: UTF-8 (BOM poistetaan), ja jos tavut eivät ole kelvollista
 * UTF-8:aa, windows-1252 (pankkien vanhat viennit).
 */
export function dekoodaa(tavut: Uint8Array): string {
  const alku = tavut[0] === 0xef && tavut[1] === 0xbb && tavut[2] === 0xbf ? 3 : 0;
  const sisalto = alku ? tavut.subarray(alku) : tavut;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(sisalto);
  } catch {
    return new TextDecoder('windows-1252').decode(sisalto);
  }
}

/** Pankkien VVKKPP-päivä ('261031') → ISO-päivä ('2026-10-31'). Vuosi tulkitaan vuosiksi 20VV. */
export function vvkkppIsoksi(s: string): IsoDate {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (m) {
    const vuosi = 2000 + Number(m[1]);
    const kk = Number(m[2]);
    const pv = Number(m[3]);
    const paivia = new Date(Date.UTC(vuosi, kk, 0)).getUTCDate();
    if (kk >= 1 && kk <= 12 && pv >= 1 && pv <= paivia)
      return `${vuosi}-${m[2]}-${m[3]}` as IsoDate;
  }
  throw new TiliotetiedostoVirhe('VAARA_MUOTO', `Virheellinen päivämäärä "${s}" (odotettu VVKKPP)`);
}

/**
 * Yhdistää yhden tiedoston useat tiliotteet (camt Stmt/Ntfctn, toistuvat TITO T00 -lohkot)
 * yhdeksi. Osat, joilla ei ole kautta eikä tapahtumia (tyhjä ilmoitus tai ote), ohitetaan.
 * Ilmoitetut kaudet järjestetään aikajärjestykseen: kunkin alkusaldon on vastattava edellisen
 * loppusaldoa (kun molemmat tunnetaan) ja kaudet eivät saa mennä päällekkäin. Jos jonkin osan
 * kausi on päätelty tapahtumien päivistä (esim. camt.054), kausia ei voi verrata: tapahtumat
 * yhdistetään päiväjärjestykseen ja kausi on niiden ensimmäisestä viimeiseen päivään.
 */
export function yhdistaTiliotteet(osat: readonly Tiliote[]): Tiliote {
  const [ensimmainen] = osat;
  if (!ensimmainen) throw new TiliotetiedostoVirhe('VAARA_MUOTO', 'Tiedostossa ei ole tiliotteita');
  if (osat.length === 1) return ensimmainen;

  const kaytetyt = osat
    .map((osa, i) => ({ osa, nro: i + 1 }))
    .filter(({ osa }) => osa.kausi !== undefined || osa.tapahtumat.length > 0);
  const [ainoa] = kaytetyt;
  if (!ainoa) return ensimmainen;
  if (kaytetyt.length === 1) return ainoa.osa;

  if (kaytetyt.some(({ osa }) => osa.kausiPaatelty))
    return yhdistaPaatellyt(kaytetyt.map((k) => k.osa));

  const jarjestetty = kaytetyt.map(({ osa: o, nro }) => {
    if (!o.kausi)
      throw new TiliotetiedostoVirhe('VAARA_MUOTO', `Tiedoston ${nro}. tiliotteelta puuttuu kausi`);
    return { osa: o, kausi: o.kausi };
  });
  jarjestetty.sort((a, b) =>
    a.kausi.alkaa < b.kausi.alkaa ? -1 : a.kausi.alkaa > b.kausi.alkaa ? 1 : 0,
  );

  for (let i = 1; i < jarjestetty.length; i++) {
    const edellinen = jarjestetty[i - 1];
    const seuraava = jarjestetty[i];
    if (!edellinen || !seuraava) continue;
    const eLoppu = muotoilePvm(edellinen.kausi.loppuu);
    const sAlku = muotoilePvm(seuraava.kausi.alkaa);
    if (seuraava.kausi.alkaa <= edellinen.kausi.loppuu)
      throw new TiliotetiedostoVirhe(
        'VAARA_MUOTO',
        `Tiliotteen kaudet menevät päällekkäin (${eLoppu} ja ${sAlku})`,
      );
    const loppu: Cents | undefined = edellinen.osa.loppusaldo;
    const alku: Cents | undefined = seuraava.osa.alkusaldo;
    if (loppu !== undefined && alku !== undefined && loppu !== alku)
      throw new TiliotetiedostoVirhe(
        'VAARA_MUOTO',
        `Tiliotteen saldot eivät täsmää: ${eLoppu} loppusaldo ei vastaa ${sAlku} alkusaldoa, välistä puuttuu todennäköisesti päivä`,
      );
  }

  const eka = jarjestetty[0];
  const vika = jarjestetty[jarjestetty.length - 1];
  if (!eka || !vika) return ensimmainen;
  const tulos: Tiliote = {
    muoto: jarjestetty.every((j) => j.osa.muoto === 'kuukausitiliote')
      ? 'kuukausitiliote'
      : 'tapahtumat',
    kausi: { alkaa: eka.kausi.alkaa, loppuu: vika.kausi.loppuu },
    tapahtumat: jarjestetty.flatMap((j) => j.osa.tapahtumat),
  };
  if (eka.osa.alkusaldo !== undefined) tulos.alkusaldo = eka.osa.alkusaldo;
  if (vika.osa.loppusaldo !== undefined) tulos.loppusaldo = vika.osa.loppusaldo;
  if (eka.osa.lahde) tulos.lahde = eka.osa.lahde;
  if (eka.osa.iban) tulos.iban = eka.osa.iban;
  return tulos;
}

/**
 * Osat, joista ainakin yhden kausi on päätelty: tapahtumat peräkkäin ja vakaasti päivän mukaan
 * järjestettyinä, kausi kaikkien kausien ja päivien ensimmäisestä viimeiseen. Saldoja ei voi
 * ketjuttaa, joten tulos on tapahtumaluettelo ilman saldoja.
 */
function yhdistaPaatellyt(osat: readonly Tiliote[]): Tiliote {
  const tapahtumat = osat
    .flatMap((o) => o.tapahtumat)
    .sort((a, b) => (a.pvm < b.pvm ? -1 : a.pvm > b.pvm ? 1 : 0));
  const paivat = osat
    .flatMap((o) => (o.kausi ? [o.kausi.alkaa, o.kausi.loppuu] : o.tapahtumat.map((t) => t.pvm)))
    .sort();
  const tulos: Tiliote = { muoto: 'tapahtumat', tapahtumat, kausiPaatelty: true };
  const alkaa = paivat[0];
  const loppuu = paivat[paivat.length - 1];
  if (alkaa && loppuu) tulos.kausi = { alkaa, loppuu };
  const lahde = osat.find((o) => o.lahde)?.lahde;
  if (lahde) tulos.lahde = lahde;
  const iban = osat.find((o) => o.iban)?.iban;
  if (iban) tulos.iban = iban;
  return tulos;
}
