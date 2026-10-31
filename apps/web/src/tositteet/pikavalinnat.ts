import { kausiKkPaivalle, verokausiHistoria } from '@/alv/alvKaudet';
import { type Asetukset, type IsoDate, type Tilikausi, onkoAlvVelvollinen } from '@penni/engine';

/** Suljettu päiväväli tositehaun rajaukseen; tyhjä merkkijono = ei rajausta. */
export interface Paivavali {
  alkupvm: string;
  loppupvm: string;
}

export type Neljannes = 'q1' | 'q2' | 'q3' | 'q4';
export type Kuukausi =
  | 'm01'
  | 'm02'
  | 'm03'
  | 'm04'
  | 'm05'
  | 'm06'
  | 'm07'
  | 'm08'
  | 'm09'
  | 'm10'
  | 'm11'
  | 'm12';

export type PikavalinnanTunnus = 'kuukausi' | 'neljannes' | Neljannes | Kuukausi | 'tilikausi';

/**
 * Napit järjestyksessä. Erillistä "Tämä neljännes" -nappia ei ole: työn alla oleva neljännes
 * merkitään Q1–Q4-napeista (ks. tyonAlainenNeljannes). 'neljannes'-tunnus on yhä
 * laskePikavalinnanVali-funktion sisäinen kalenterineljännes. "Tämä vuosi" on koko valittu
 * tilikausi ('tilikausi') — oletus, johon aktiivisen napin uusi painallus palaa. Tilikauden
 * itsensä valitsee sivupalkki (tilikausi/valittuTilikausi.ts).
 */
export const PIKAVALINNAT: readonly { tunnus: PikavalinnanTunnus; label: string }[] = [
  { tunnus: 'kuukausi', label: 'Tämä kuukausi' },
  { tunnus: 'q1', label: 'Q1' },
  { tunnus: 'q2', label: 'Q2' },
  { tunnus: 'q3', label: 'Q3' },
  { tunnus: 'q4', label: 'Q4' },
  { tunnus: 'tilikausi', label: 'Tämä vuosi' },
];

/** Kuukausirivi (vain kuukausittain alv:n ilmoittavalle, ks. kuukausittainenAlv). */
export const KUUKAUSIVALINNAT: readonly { tunnus: Kuukausi; label: string }[] = [
  'Tammi',
  'Helmi',
  'Maalis',
  'Huhti',
  'Touko',
  'Kesä',
  'Heinä',
  'Elo',
  'Syys',
  'Loka',
  'Marras',
  'Joulu',
].map((label, i) => ({ tunnus: `m${String(i + 1).padStart(2, '0')}` as Kuukausi, label }));

/** Selaus avautuu tähän: koko valittu tilikausi. */
export const OLETUSVALINTA: PikavalinnanTunnus = 'tilikausi';

/** Tämä päivä paikallisena ISO-päivänä (pikavalinnat seuraavat käyttäjän kalenteria, ei UTC:tä). */
export function paikallinenTanaan(): string {
  const nyt = new Date();
  return `${nyt.getFullYear()}-${String(nyt.getMonth() + 1).padStart(2, '0')}-${String(nyt.getDate()).padStart(2, '0')}`;
}

function puraIso(iso: string): { v: number; k: number } {
  return { v: Number(iso.slice(0, 4)), k: Number(iso.slice(5, 7)) };
}

function isoUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Kalenteriyksikön (1 = kuukausi, 3 = neljännes) päivän sisältävä väli. */
function kalenteriYksikko(iso: string, pituusKk: 1 | 3): Paivavali {
  const { v, k } = puraIso(iso);
  const alkuKk = pituusKk === 3 ? Math.floor((k - 1) / 3) * 3 : k - 1;
  // Date.UTC(v, kk, 0) = edellisen kuukauden viimeinen päivä.
  return {
    alkupvm: isoUtc(Date.UTC(v, alkuKk, 1)),
    loppupvm: isoUtc(Date.UTC(v, alkuKk + pituusKk, 0)),
  };
}

/** Tänään valitun kauden sisään clampattuna — aiemmalla kaudella sen viimeinen päivä. */
function ankkuri(kausi: Pick<Tilikausi, 'alkaa' | 'loppuu'>, tanaan: string): string {
  return tanaan < kausi.alkaa ? kausi.alkaa : tanaan > kausi.loppuu ? kausi.loppuu : tanaan;
}

/** Kiinteän napin (Q1–Q4, Tammi–Joulu) ensimmäinen kuukausi ja pituus; muuten null. */
function kiinteaYksikko(tunnus: PikavalinnanTunnus): { kk: number; pituus: 1 | 3 } | null {
  if (/^q[1-4]$/.test(tunnus)) return { kk: (Number(tunnus[1]) - 1) * 3 + 1, pituus: 3 };
  if (/^m\d\d$/.test(tunnus)) return { kk: Number(tunnus.slice(1)), pituus: 1 };
  return null;
}

/** Tilikaudet nousevaan järjestykseen — kutsuja ei takaa järjestystä (init palauttaa varaston oman). */
export function jarjesta(tilikaudet: readonly Tilikausi[]): Tilikausi[] {
  return [...tilikaudet].sort((a, b) => (a.alkaa < b.alkaa ? -1 : a.alkaa > b.alkaa ? 1 : 0));
}

/**
 * Päivän `tanaan` sisältävän tilikauden indeksi järjestetyssä listassa. Kun päivä osuu
 * kirjanpidon ulkopuolelle, palautetaan lähin reuna: ennen ensimmäistä → 0, viimeisen jälkeen
 * → viimeinen. Näin kesken tilikausien oleva aukko (tai vanhentunut kirjanpito) ei koskaan
 * jätä selausta tyhjäksi. -1 vain kun tilikausia ei ole lainkaan.
 */
export function nykyisenTilikaudenIndeksi(
  tilikaudet: readonly Tilikausi[],
  tanaan: string,
): number {
  const kaudet = jarjesta(tilikaudet);
  if (kaudet.length === 0) return -1;
  const osuma = kaudet.findIndex((k) => k.alkaa <= tanaan && tanaan <= k.loppuu);
  if (osuma !== -1) return osuma;
  // Aukossa tai reunan ulkopuolella: viimeinen kausi joka alkoi jo, muuten ensimmäinen.
  const alkaneet = kaudet.filter((k) => k.alkaa <= tanaan).length;
  return alkaneet === 0 ? 0 : alkaneet - 1;
}

/**
 * Rajaa väli tilikauden sisään — selaus ei saa koskaan näyttää kauden ulkopuolista päivää.
 * Tyhjä päivä (käsin syötetyssä välissä) tarkoittaa kauden reunaa.
 */
export function leikkaa(vali: Paivavali, kausi: Pick<Tilikausi, 'alkaa' | 'loppuu'>): Paivavali {
  return {
    alkupvm: vali.alkupvm > kausi.alkaa ? vali.alkupvm : kausi.alkaa,
    loppupvm: vali.loppupvm !== '' && vali.loppupvm < kausi.loppuu ? vali.loppupvm : kausi.loppuu,
  };
}

/**
 * Pikavalinnan päiväväli valitun tilikauden sisällä. Kuukausi ja neljännes ovat
 * kalenteriyksiköitä (kuten alv-kaudet), mutta leikattuina tilikauteen; vuosirajaus on
 * tilikausi itse, ei kalenterivuosi, koska tilikausi ei läheskään aina ala tammikuusta.
 *
 * `null` = valintaa ei voi laskea (ei tilikautta, neljännes jää kauden ulkopuolelle, tai
 * "Tämä kuukausi" kun tänään ei ole valitulla kaudella) — kutsuja poistaa napin käytöstä sen
 * sijaan että näyttäisi väärän välin.
 */
export function laskePikavalinnanVali(
  tunnus: PikavalinnanTunnus,
  kausi: Tilikausi | undefined,
  tanaan: string,
): Paivavali | null {
  if (kausi === undefined) return null;
  if (tunnus === 'tilikausi') return { alkupvm: kausi.alkaa, loppupvm: kausi.loppuu };

  const kaudella = kausi.alkaa <= tanaan && tanaan <= kausi.loppuu;
  if (tunnus === 'kuukausi' && !kaudella) return null;
  // Neljännekset ankkuroidaan tilikauden sisään: jos tänään on kauden ulkopuolella (aiempi
  // kausi valittuna), käytetään lähintä kauden päivää, jottei rajaus valu kauden ohi.
  const paiva = ankkuri(kausi, tanaan);
  // Q1–Q4 ja kuukausinapit käyttävät saman kalenterivuoden kuin Tämä neljännes.
  const kiintea = kiinteaYksikko(tunnus);
  if (kiintea !== null) {
    const alku = `${paiva.slice(0, 4)}-${String(kiintea.kk).padStart(2, '0')}-01`;
    const rajattu = leikkaa(kalenteriYksikko(alku, kiintea.pituus), kausi);
    return rajattu.alkupvm <= rajattu.loppupvm ? rajattu : null;
  }
  return leikkaa(kalenteriYksikko(paiva, tunnus === 'neljannes' ? 3 : 1), kausi);
}

function neljannesPaivasta(iso: string): Neljannes {
  return `q${Math.ceil(Number(iso.slice(5, 7)) / 3)}` as Neljannes;
}

function kuukausiPaivasta(iso: string): Kuukausi {
  return `m${iso.slice(5, 7)}` as Kuukausi;
}

function seuraavaPaiva(iso: IsoDate): IsoDate {
  const { v, k } = puraIso(iso);
  return isoUtc(Date.UTC(v, k - 1, Number(iso.slice(8, 10)) + 1));
}

/**
 * Työn alla oleva neljännes Q1–Q4-napeista: ensimmäinen, jonka alv:ta ei ole vielä ilmoitettu
 * (`ilmoitettuAsti` = viimeinen ilmoitettu päivä, ks. alv/alvKaudet.ts:n viimeisinIlmoitettu).
 * Lokakuussa työn alla on siis Q3, kunnes sen alv on tilitetty. Kun ilmoituksia ei ole tai
 * seuraava ilmoittamaton päivä osuu nappien vuoden ulkopuolelle, käytetään kalenterin
 * neljännestä — mutta vain jos tänään on valitulla kaudella: aiemman, jo ilmoitetun kauden
 * napeista mikään ei ole työn alla. `null` kun tilikautta ei ole tai mikään ei ole työn alla.
 */
export function tyonAlainenNeljannes(
  kausi: Tilikausi | undefined,
  tanaan: string,
  ilmoitettuAsti: IsoDate | undefined,
): Neljannes | null {
  return tyonAlainen(kausi, tanaan, ilmoitettuAsti, 3, neljannesPaivasta);
}

/** Työn alla oleva kuukausi kuukausirivistä — sama sääntö kuin tyonAlainenNeljannes. */
export function tyonAlainenKuukausi(
  kausi: Tilikausi | undefined,
  tanaan: string,
  ilmoitettuAsti: IsoDate | undefined,
): Kuukausi | null {
  return tyonAlainen(kausi, tanaan, ilmoitettuAsti, 1, kuukausiPaivasta);
}

function tyonAlainen<T extends Neljannes | Kuukausi>(
  kausi: Tilikausi | undefined,
  tanaan: string,
  ilmoitettuAsti: IsoDate | undefined,
  pituus: 1 | 3,
  tunnusPaivasta: (iso: string) => T,
): T | null {
  if (kausi === undefined) return null;
  const kalenterin = leikkaa(kalenteriYksikko(ankkuri(kausi, tanaan), pituus), kausi);
  const kaudella = kausi.alkaa <= tanaan && tanaan <= kausi.loppuu;
  const varalla = kaudella ? tunnusPaivasta(kalenterin.alkupvm) : null;
  if (ilmoitettuAsti === undefined) return varalla;
  const seuraava = seuraavaPaiva(ilmoitettuAsti);
  // Napit ovat saman kalenterivuoden yksiköitä kuin kalenterin yksikkö.
  if (seuraava.slice(0, 4) !== kalenterin.alkupvm.slice(0, 4)) return varalla;
  const tunnus = tunnusPaivasta(seuraava);
  return laskePikavalinnanVali(tunnus, kausi, tanaan) === null ? varalla : tunnus;
}

/**
 * Näytetäänkö kuukausirivi: kirja on alv-velvollinen ja ilmoittaa kuukausittain jossain valitun
 * kauden osassa. Verokauden pituus voi vaihtua kesken kauden (ks. alv/alvKaudet.ts:n
 * VerokausiHistoria), joten kumpikin reuna tarkistetaan; neljännes- tai vuosi-ilmoittajalle
 * riittävät Q-napit.
 */
export function kuukausittainenAlv(asetukset: Asetukset, kausi: Tilikausi | undefined): boolean {
  if (kausi === undefined) return false;
  const historia = verokausiHistoria(asetukset);
  return [kausi.alkaa, kausi.loppuu].some(
    (pvm) => onkoAlvVelvollinen(asetukset, pvm) && kausiKkPaivalle(historia, pvm) === 1,
  );
}
