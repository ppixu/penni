import { type Cents, Euro } from '@penni/euro';
import type { IsoDate } from '../vouchers/types.js';
import type { AlkuperainenSumma, Tilitapahtuma } from './poimiTiliote.js';

/** Tiliotteen kattama jakso. */
export interface TiliotteenKausi {
  alkaa: IsoDate;
  loppuu: IsoDate;
}

/** Yhden tiliotteen poiminnan tulos. */
export interface Tiliote {
  /** 'kuukausitiliote' = pankin kuukausittainen tiliote (saldoineen); 'tapahtumat' = tapahtumaluettelo. */
  muoto: 'kuukausitiliote' | 'tapahtumat';
  kausi?: TiliotteenKausi;
  /** Alkusaldo (kauden alkua edeltävän päivän saldo). */
  alkusaldo?: Cents;
  /** Loppusaldo (kauden viimeisen päivän saldo). */
  loppusaldo?: Cents;
  tapahtumat: Tilitapahtuma[];
}

/**
 * EU-muotoinen rahamäärä: valinnainen etumerkki edessä (+/-), tuhaterottimena väli tai piste,
 * pilkkudesimaali ja valinnainen perässä oleva miinus (vanhojen tiliotteiden '18,00-').
 */
const SUMMA = String.raw`[+-]?\d{1,3}(?:[ .]\d{3})*,\d{2}-?`;
const SUMMA_KOKO = new RegExp(`^${SUMMA}$`);
const KAUSI = /Kausi\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i;
const SALDO = new RegExp(
  String.raw`^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+Saldo\s*:?\s+(${SUMMA})$`,
  'i',
);
/** Päivätty saldo-rivi, jonka määrä on vasta myöhemmällä rivillä (pdf.js-poiminta, loppusaldo). */
const SALDO_ILMAN_SUMMAA = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+Saldo\s*:?$/i;
/** Lohkomuodon tapahtuman aloittava rivi: pelkät kirjaus- ja arvopäivä. */
const LOHKO_ALKU = /^(\d{1,2})\.(\d{1,2})\.?\s+(\d{1,2})\.(\d{1,2})\.?$/;
const PELKKA_PAIVA = /^\d{1,2}\.\d{1,2}\.?$/;
const TAPAHTUMANUMERO = /^(?:Tap\.?\s*no\.?\s*)?\d+$/i;
const SIVU = /^Sivu\s+\d+\s*\/\s*\d+$/i;
/** Tapahtuman ensimmäinen rivi: kirjauspäivä (+ arvopäivä) ilman vuotta ja loput rivistä. */
const OTSAKE = /^(\d{1,2})\.(\d{1,2})\.?(?:\s+(\d{1,2})\.(\d{1,2})\.?)?\s+(.+)$/;
const VALUUTTA = /^([A-Z]{3})\s+(\d{1,3}(?:[ .]\d{3})*,\d{2})(?:\s+.*)?$/;
const VIITE =
  /^(?:Viite(?:numero)?|Viitenro|Ref(?:erence)?)\s*:?\s*(RF\d{2}[0-9A-Z ]*[0-9A-Z]|\d[\d ]{2,}\d)$/i;
const RF_VIITE = /^(RF\d{2}[0-9A-Z]{1,21})$/;
const VIESTI = /^Viesti\s*:?\s*(.*)$/i;

function tiivista(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function kaksi(n: string | number): string {
  return String(n).padStart(2, '0');
}

/** '1 234,56', '-18,00', '+5,00' tai '18,00-' → etumerkilliset sentit. */
export function lueSumma(s: string): Cents {
  let t = s.trim();
  let etumerkki = 1;
  if (t.endsWith('-')) {
    etumerkki = -1;
    t = t.slice(0, -1);
  }
  if (t.startsWith('-')) {
    etumerkki = -etumerkki;
    t = t.slice(1);
  } else if (t.startsWith('+')) t = t.slice(1);
  const sentit = Euro.fromString(t.replace(/[ .]/g, ''));
  return (etumerkki < 0 ? Euro.neg(sentit) : sentit) as Cents;
}

/** Validi päivä/kuukausi tapahtumarivillä (estää esim. kellonajan tai summan tulkitsemisen päiväksi). */
function paivaKelpaa(d: number, kk: number): boolean {
  return d >= 1 && d <= 31 && kk >= 1 && kk <= 12;
}

interface Loppusummat {
  nimi: string;
  maara: Cents;
  saldo?: Cents;
}

/**
 * Jakaa rivin loppuosan nimeksi ja perässä oleviksi rahamääriksi (tapahtuman summa ja
 * valinnaisesti juokseva saldo). Palauttaa kaikki mahdolliset tulkinnat, sillä nimen perässä
 * oleva luku voi sekoittua tuhaterotettuun summaan ('SHOP 24 150,00'); kutsuja valitsee
 * saldon perusteella. Ensimmäinen tulkinta on ahnein (pisin summa).
 */
function loppusummat(loppu: string): Loppusummat[] {
  const sanat = loppu.split(' ');
  const tulos: Loppusummat[] = [];
  // Rahamäärä on 1..n sanaa; kokeillaan kaikki jaot: nimi | summa [| saldo].
  for (let i = 1; i < sanat.length; i++) {
    const nimi = sanat.slice(0, i).join(' ');
    const hanta = sanat.slice(i);
    // Yksi summa.
    const yksi = hanta.join(' ');
    if (SUMMA_KOKO.test(yksi)) tulos.push({ nimi, maara: lueSumma(yksi) });
    // Summa + saldo.
    for (let j = 1; j < hanta.length; j++) {
      const a = hanta.slice(0, j).join(' ');
      const b = hanta.slice(j).join(' ');
      if (SUMMA_KOKO.test(a) && SUMMA_KOKO.test(b))
        tulos.push({ nimi, maara: lueSumma(a), saldo: lueSumma(b) });
    }
  }
  return tulos.filter(
    (t) => t.nimi.trim() !== '' && !SUMMA_KOKO.test(t.nimi.split(' ').at(-1) ?? ''),
  );
}

/** Tunnistaako teksti pankin kuukausitiliotteeksi (kausi tai päivätty saldo-rivi). */
export function onkoKuukausitiliote(teksti: string): boolean {
  const litea = tiivista(teksti);
  if (KAUSI.test(litea)) return true;
  return teksti.split('\n').some((r) => SALDO.test(tiivista(r)));
}

/**
 * Poimii pankin (Nordea) kuukausittaisen tiliotteen tekstistä (pdf.js-poiminta, rivit
 * hasEOL-lipun mukaan). Rakenne: otsakkeessa 'Kausi: 01.07.2026 - 31.07.2026', alkusaldo-rivi
 * '30.06.2026 Saldo 8 905,25', tapahtumat muodossa 'PP.KK PP.KK <nimi> <summa> [saldo]' ja
 * niiden alla lisätietorivit (IBAN, BIC, arkistointitunnus, 'USD 6,26 GITHUB.COM', viite,
 * viesti), sivunvaihdoissa toistuva otsake ja lopussa loppusaldo-rivi. Vuosi tulee kaudesta.
 */
export function poimiKuukausitiliote(teksti: string): Tiliote {
  const rivit = teksti
    .split('\n')
    .map(tiivista)
    .filter((r) => r !== '');
  const tulos: Tiliote = { muoto: 'kuukausitiliote', tapahtumat: [] };

  const k = KAUSI.exec(tiivista(teksti));
  if (k) {
    const [, ad, akk, av, ld, lkk, lv] = k;
    tulos.kausi = {
      alkaa: `${av}-${kaksi(akk ?? '')}-${kaksi(ad ?? '')}`,
      loppuu: `${lv}-${kaksi(lkk ?? '')}-${kaksi(ld ?? '')}`,
    };
  }

  // Päivätyt saldorivit: ensimmäinen = alkusaldo, viimeinen = loppusaldo.
  const saldot: { pvm: IsoDate; saldo: Cents; rivi: number }[] = [];
  rivit.forEach((r, i) => {
    const m = SALDO.exec(r);
    if (m) {
      const [, d, kk, v, s] = m;
      saldot.push({
        pvm: `${v}-${kaksi(kk ?? '')}-${kaksi(d ?? '')}`,
        saldo: lueSumma(s ?? ''),
        rivi: i,
      });
      return;
    }
    // 'PP.KK.VVVV Saldo' ilman määrää: määrä on ensimmäinen pelkkä rahamäärä seuraavilla riveillä.
    const ilman = SALDO_ILMAN_SUMMAA.exec(r);
    if (ilman) {
      const [, d, kk, v] = ilman;
      const summa = rivit.slice(i + 1, i + 6).find((x) => SUMMA_KOKO.test(x));
      if (summa !== undefined)
        saldot.push({
          pvm: `${v}-${kaksi(kk ?? '')}-${kaksi(d ?? '')}`,
          saldo: lueSumma(summa),
          rivi: i,
        });
    }
  });
  const ensimmainen = saldot[0];
  const viimeinen = saldot.at(-1);
  if (ensimmainen) tulos.alkusaldo = ensimmainen.saldo;
  if (viimeinen && saldot.length > 1) tulos.loppusaldo = viimeinen.saldo;
  if (!tulos.kausi && ensimmainen && viimeinen && saldot.length > 1) {
    // Ilman Kausi-otsaketta: jakso alkaa alkusaldon jälkeisestä päivästä.
    const [v, kk, d] = ensimmainen.pvm.split('-').map(Number);
    const seuraava = new Date(Date.UTC(v ?? 0, (kk ?? 1) - 1, (d ?? 1) + 1))
      .toISOString()
      .slice(0, 10);
    tulos.kausi = { alkaa: seuraava, loppuu: viimeinen.pvm };
  }
  const kausi = tulos.kausi;
  if (!kausi) return tulos;

  const alkuVuosi = Number(kausi.alkaa.slice(0, 4));
  const alkuKk = Number(kausi.alkaa.slice(5, 7));
  const loppuVuosi = Number(kausi.loppuu.slice(0, 4));
  /** Vuodeton päivä → ISO kauden perusteella (vuodenvaihteen yli menevä kausi huomioiden). */
  const isoksi = (d: number, kk: number): IsoDate =>
    `${kk < alkuKk ? loppuVuosi : alkuVuosi}-${kaksi(kk)}-${kaksi(d)}`;

  // Tapahtumien rivialue: alkusaldon jälkeen, loppusaldoon asti.
  const alku = ensimmainen ? ensimmainen.rivi + 1 : 0;
  const loppu = viimeinen && saldot.length > 1 ? viimeinen.rivi : rivit.length;

  if (rivit.slice(alku, loppu).some((r) => LOHKO_ALKU.test(r))) {
    tulos.tapahtumat = poimiLohkot(rivit.slice(alku, loppu), isoksi, tulos.alkusaldo);
    return tulos;
  }

  let edellinenSaldo: Cents | undefined = tulos.alkusaldo;
  let nykyinen: Tilitapahtuma | undefined;
  let odottaaViestia = false;

  for (let i = alku; i < loppu; i++) {
    const rivi = rivit[i] ?? '';
    const valisaldo = SALDO.exec(rivi);
    if (valisaldo) {
      // Välisaldo (esim. sivunvaihdossa) katkaisee lisätiedot ja tarkentaa juoksevan saldon.
      nykyinen = undefined;
      edellinenSaldo = lueSumma(valisaldo[4] ?? '');
      continue;
    }
    const o = OTSAKE.exec(rivi);
    if (o && paivaKelpaa(Number(o[1]), Number(o[2]))) {
      // Summa voi pdf.js-poiminnassa pudota seuraavalle riville: liitetään enintään kaksi riviä.
      let loppuosa = o[5] ?? '';
      let ehdokkaat = loppusummat(loppuosa);
      let kulutettu = 0;
      while (ehdokkaat.length === 0 && kulutettu < 2) {
        const seuraava = rivit[i + kulutettu + 1];
        if (seuraava === undefined || SALDO.test(seuraava) || OTSAKE.test(seuraava)) break;
        kulutettu++;
        loppuosa = `${loppuosa} ${seuraava}`;
        ehdokkaat = loppusummat(loppuosa);
      }
      const valittu =
        ehdokkaat.find(
          (e) =>
            e.saldo !== undefined &&
            edellinenSaldo !== undefined &&
            edellinenSaldo + e.maara === e.saldo,
        ) ?? ehdokkaat[0];
      if (valittu) {
        i += kulutettu;
        nykyinen = {
          pvm: isoksi(Number(o[1]), Number(o[2])),
          nimi: valittu.nimi.trim(),
          maara: valittu.maara,
        };
        tulos.tapahtumat.push(nykyinen);
        edellinenSaldo =
          valittu.saldo ??
          (edellinenSaldo !== undefined ? ((edellinenSaldo + valittu.maara) as Cents) : undefined);
        odottaaViestia = false;
        continue;
      }
    }
    if (!nykyinen) continue;

    // Lisätietorivit nykyiselle tapahtumalle.
    if (odottaaViestia) {
      nykyinen.viesti = rivi;
      odottaaViestia = false;
      continue;
    }
    const valuutta = VALUUTTA.exec(rivi);
    if (valuutta && nykyinen.alkuperainen === undefined) {
      const alkuperainen: AlkuperainenSumma = {
        valuutta: valuutta[1] ?? '',
        maara: Euro.abs(lueSumma(valuutta[2] ?? '')),
      };
      nykyinen.alkuperainen = alkuperainen;
      continue;
    }
    const viite = VIITE.exec(rivi) ?? RF_VIITE.exec(rivi);
    if (viite && nykyinen.viite === undefined) {
      nykyinen.viite = (viite[1] ?? '').replace(/\s/g, '');
      continue;
    }
    const viesti = VIESTI.exec(rivi);
    if (viesti && nykyinen.viesti === undefined) {
      const sisalto = (viesti[1] ?? '').trim();
      if (sisalto === '') odottaaViestia = true;
      else nykyinen.viesti = sisalto;
    }
  }
  return tulos;
}

/**
 * Lukee summarivin: pelkkä tapahtuman summa tai summa + juokseva saldo. Jos jakoja on useita,
 * valitaan se, jossa edellinen saldo + summa = saldo.
 */
function lueSummarivi(rivi: string, edellinenSaldo: Cents | undefined): Loppusummat | undefined {
  if (SUMMA_KOKO.test(rivi)) return { nimi: '', maara: lueSumma(rivi) };
  const sanat = rivi.split(' ');
  const ehdokkaat: Loppusummat[] = [];
  for (let j = 1; j < sanat.length; j++) {
    const a = sanat.slice(0, j).join(' ');
    const b = sanat.slice(j).join(' ');
    if (SUMMA_KOKO.test(a) && SUMMA_KOKO.test(b))
      ehdokkaat.push({ nimi: '', maara: lueSumma(a), saldo: lueSumma(b) });
  }
  return (
    ehdokkaat.find(
      (e) =>
        edellinenSaldo !== undefined &&
        e.saldo !== undefined &&
        edellinenSaldo + e.maara === e.saldo,
    ) ?? ehdokkaat[0]
  );
}

/**
 * pdf.js:n lohkomuoto (Nordean kuukausitiliote): jokainen tapahtuma alkaa rivillä, jolla on vain
 * kirjaus- ja arvopäivä, ja sitä seuraavat maksupäivä, tapahtumanumero, nimi, lisätietorivit ja
 * lopuksi summa (+ juokseva saldo). Lohko päättyy seuraavaan tapahtumaan, saldoriviin tai
 * sivunvaihtoon; sivun alalaidan irtorivit jäävät summarivin jälkeen eivätkä haittaa.
 */
function poimiLohkot(
  rivit: readonly string[],
  isoksi: (d: number, kk: number) => IsoDate,
  alkusaldo: Cents | undefined,
): Tilitapahtuma[] {
  const tapahtumat: Tilitapahtuma[] = [];
  let saldo = alkusaldo;
  let i = 0;
  while (i < rivit.length) {
    const m = LOHKO_ALKU.exec(rivit[i] ?? '');
    if (!m || !paivaKelpaa(Number(m[1]), Number(m[2]))) {
      i++;
      continue;
    }
    const lohko: string[] = [];
    let j = i + 1;
    for (; j < rivit.length; j++) {
      const r = rivit[j] ?? '';
      if (LOHKO_ALKU.test(r) || SALDO.test(r) || SALDO_ILMAN_SUMMAA.test(r) || SIVU.test(r)) break;
      lohko.push(r);
    }
    i = j;

    let k = 0;
    if (PELKKA_PAIVA.test(lohko[k] ?? '')) k++;
    if (TAPAHTUMANUMERO.test(lohko[k] ?? '')) k++;
    const nimi = lohko[k];
    if (nimi === undefined) continue;
    k++;

    let summaRivi = -1;
    let summat: Loppusummat | undefined;
    for (let a = lohko.length - 1; a >= k; a--) {
      summat = lueSummarivi(lohko[a] ?? '', saldo);
      if (summat) {
        summaRivi = a;
        break;
      }
    }
    if (!summat) continue;

    const tapahtuma: Tilitapahtuma = {
      pvm: isoksi(Number(m[1]), Number(m[2])),
      nimi,
      maara: summat.maara,
    };
    for (const r of lohko.slice(k, summaRivi)) {
      const valuutta = VALUUTTA.exec(r);
      if (valuutta && tapahtuma.alkuperainen === undefined) {
        tapahtuma.alkuperainen = {
          valuutta: valuutta[1] ?? '',
          maara: Euro.abs(lueSumma(valuutta[2] ?? '')),
        };
        continue;
      }
      const viite = VIITE.exec(r) ?? RF_VIITE.exec(r);
      if (viite && tapahtuma.viite === undefined)
        tapahtuma.viite = (viite[1] ?? '').replace(/\s/g, '');
    }
    tapahtumat.push(tapahtuma);
    saldo = summat.saldo ?? (saldo !== undefined ? ((saldo + summat.maara) as Cents) : undefined);
  }
  return tapahtumat;
}
