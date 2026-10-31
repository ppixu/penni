import type { Asetukset, IsoDate, Tilikausi } from '@penni/engine';

/** Alv-ilmoituskausi: suljettu päiväväli. */
export interface AlvKausi {
  alkupvm: IsoDate;
  loppupvm: IsoDate;
}

/** Kausityypin pituus kuukausina (legacy AlvKausi-semantiikka). */
export type KausiKk = 1 | 3 | 12;

/** Pura 'YYYY-MM-DD' kokonaislukukentiksi (vuosi, kuukausi 1–12, päivä). */
function puraIso(iso: string): { v: number; k: number; p: number } {
  return { v: Number(iso.slice(0, 4)), k: Number(iso.slice(5, 7)), p: Number(iso.slice(8, 10)) };
}

/** Muotoile UTC-aikaleima takaisin 'YYYY-MM-DD'-muotoon (ei aikavyöhykeriippuvuutta). */
function isoUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO-päivä + n päivää (Date.UTC-kokonaislukulaskenta normalisoi kuun/vuoden vaihteen). */
function lisaaPaivia(iso: IsoDate, paivia: number): IsoDate {
  const { v, k, p } = puraIso(iso);
  return isoUtc(Date.UTC(v, k - 1, p + paivia));
}

/** Päivien ero (loppu − alku) kokonaislukupäivinä. */
function paiviaValilla(alku: IsoDate, loppu: IsoDate): number {
  const ms = (iso: IsoDate) => {
    const { v, k, p } = puraIso(iso);
    return Date.UTC(v, k - 1, p);
  };
  return Math.round((ms(loppu) - ms(alku)) / 86_400_000);
}

/** ISO-päivä + n kuukautta Qt:n addMonths-semantiikalla: päivä clampataan kohdekuukauden
 *  pituuteen (31.12. + 2 kk → 28./29.2.) — Date.UTC yksinään ylivuotaisi maaliskuulle. */
function lisaaKuukausia(iso: IsoDate, kk: number): IsoDate {
  const { v, k, p } = puraIso(iso);
  const kohdekuunViimeinen = new Date(Date.UTC(v, k - 1 + kk + 1, 0)).getUTCDate();
  return isoUtc(Date.UTC(v, k - 1 + kk, Math.min(p, kohdekuunViimeinen)));
}

/** AlvKausi-asetus kuukausina: '1' | '3' | '12'; muu tai puuttuva arvo → 1 (kuukausi). */
export function alvKausiKk(asetukset: Asetukset): KausiKk {
  if (asetukset.AlvKausi === '3') return 3;
  if (asetukset.AlvKausi === '12') return 12;
  return 1;
}

/**
 * Verokauden pituuden muutokset (vero.fi "Verokauden muutos"): pidempi kausi alkaa hakemusta
 * seuraavan vuoden alusta, lyhyempi seuraavan lyhyemmän kauden alusta, joten pituus vaihtelee
 * vuosien välillä. Rivi kertoo pituuden päivästä `alkaa` alkaen seuraavaan riviin asti;
 * ensimmäisen rivin `alkaa` on '' = kirjanpidon alusta. Tallennetaan asetukseen
 * AlvKausiHistoria (JSON); legacy-avain AlvKausi pidetään tämänhetkisessä pituudessa.
 */
export interface VerokausiMuutos {
  alkaa: IsoDate | '';
  kk: KausiKk;
}
export type VerokausiHistoria = readonly VerokausiMuutos[];

/** Kiinteä pituus tai historia — kiinteä pituus on yksirivinen historia. */
export type KausiPituus = KausiKk | VerokausiHistoria;

const HISTORIA_AVAIN = 'AlvKausiHistoria';

function historiaksi(p: KausiPituus): VerokausiHistoria {
  return typeof p === 'number' ? [{ alkaa: '', kk: p }] : p;
}

const onKausiKk = (x: unknown): x is KausiKk => x === 1 || x === 3 || x === 12;

/**
 * Kirjan verokausihistoria. Ilman (tai rikkinäisellä) AlvKausiHistorialla koko kirjanpito on
 * legacy-asetuksen AlvKausi pituinen. Ensimmäinen rivi kattaa aina alun.
 */
export function verokausiHistoria(asetukset: Asetukset): VerokausiHistoria {
  let rivit: VerokausiMuutos[] = [];
  try {
    const raaka: unknown = JSON.parse(asetukset[HISTORIA_AVAIN] ?? '[]');
    if (Array.isArray(raaka)) {
      rivit = raaka
        .filter(
          (r): r is VerokausiMuutos =>
            typeof r === 'object' &&
            r !== null &&
            typeof r.alkaa === 'string' &&
            (r.alkaa === '' || /^\d{4}-\d{2}-\d{2}$/.test(r.alkaa)) &&
            onKausiKk(r.kk),
        )
        .map((r) => ({ alkaa: r.alkaa, kk: r.kk }))
        .sort((a, b) => a.alkaa.localeCompare(b.alkaa));
    }
  } catch {
    /* rikkinäinen JSON → legacy-asetus */
  }
  const [eka, ...muut] = rivit;
  if (eka === undefined) return [{ alkaa: '', kk: alvKausiKk(asetukset) }];
  return [{ alkaa: '', kk: eka.kk }, ...muut];
}

/** Historia asetuksiksi: JSON-historia ja legacy-AlvKausi päivän `tanaan` pituutena. */
export function historiaAsetuksiksi(
  historia: VerokausiHistoria,
  tanaan: IsoDate,
): { AlvKausiHistoria: string; AlvKausi: string } {
  return {
    AlvKausiHistoria: JSON.stringify(historia),
    AlvKausi: String(kausiKkPaivalle(historia, tanaan)),
  };
}

/** Päivänä voimassa oleva verokauden pituus. */
export function kausiKkPaivalle(p: KausiPituus, pvm: IsoDate): KausiKk {
  const h = historiaksi(p);
  let kk = h[0]?.kk ?? 1;
  for (const r of h) if (r.alkaa <= pvm) kk = r.kk;
  return kk;
}

/**
 * Päivän sisältävä alv-kausi: kalenteriyksikkö voimassa olevalla pituudella, leikattuna
 * pituuden muutospäiviin (kesken neljänneksen alkava kuukausikausi katkaisee neljänneksen).
 */
export function alvKausiPaivalle(pvm: IsoDate, p: KausiPituus): AlvKausi {
  const h = historiaksi(p);
  const kk = kausiKkPaivalle(h, pvm);
  const voimaan = h.filter((r) => r.alkaa !== '' && r.alkaa <= pvm).at(-1)?.alkaa;
  const seuraava = h.find((r) => r.alkaa > pvm)?.alkaa;
  const alku = yksikonAlku(pvm, kk);
  const loppu = yksikonLoppu(pvm, kk);
  return {
    alkupvm: voimaan !== undefined && voimaan > alku ? voimaan : alku,
    loppupvm:
      seuraava !== undefined && lisaaPaivia(seuraava, -1) < loppu
        ? lisaaPaivia(seuraava, -1)
        : loppu,
  };
}

/**
 * Verokauden vaihdon voimaantulo (vero.fi): pidempi kausi seuraavan vuoden alusta, lyhyempi
 * seuraavan lyhyemmän kauden alusta. Sama pituus kuin nyt → null.
 */
export function muutoksenAlku(p: KausiPituus, uusi: KausiKk, tanaan: IsoDate): IsoDate | null {
  const nyt = kausiKkPaivalle(p, tanaan);
  if (uusi === nyt) return null;
  if (uusi > nyt) return `${Number(tanaan.slice(0, 4)) + 1}-01-01`;
  return lisaaPaivia(yksikonLoppu(tanaan, uusi), 1);
}

/** Onko päivä uuden pituuden kauden ensimmäinen päivä (muutos voi alkaa vain siitä). */
export function onKaudenAlku(pvm: IsoDate, kk: KausiKk): boolean {
  return yksikonAlku(pvm, kk) === pvm;
}

/**
 * Lisää muutos: päivästä `alkaa` alkaen pituus on `kk`. Myöhemmät rivit korvautuvat (uusin
 * päätös voittaa) ja edellisen kanssa samanpituinen rivi jää pois.
 */
export function lisaaVerokausiMuutos(
  p: KausiPituus,
  alkaa: IsoDate,
  kk: KausiKk,
): VerokausiHistoria {
  const ennen = historiaksi(p).filter((r) => r.alkaa < alkaa);
  const edellinen = ennen.at(-1);
  return edellinen?.kk === kk ? ennen : [...ennen, { alkaa, kk }];
}

/** Poista päivän `tanaan` jälkeen alkavat (vielä voimaan tulemattomat) muutokset. */
export function peruTulevatMuutokset(p: KausiPituus, tanaan: IsoDate): VerokausiHistoria {
  return historiaksi(p).filter((r) => r.alkaa <= tanaan);
}

/** Päivän sisältävän kalenteriyksikön (kuukausi/neljännes/vuosi) ensimmäinen päivä. */
function yksikonAlku(iso: IsoDate, kausiKk: KausiKk): IsoDate {
  const { v, k } = puraIso(iso);
  if (kausiKk === 12) return isoUtc(Date.UTC(v, 0, 1));
  if (kausiKk === 3) return isoUtc(Date.UTC(v, Math.floor((k - 1) / 3) * 3, 1));
  return isoUtc(Date.UTC(v, k - 1, 1));
}

/** Päivän sisältävän kalenteriyksikön viimeinen päivä (Date.UTC(v, k, 0) = kuun viimeinen). */
function yksikonLoppu(iso: IsoDate, kausiKk: KausiKk): IsoDate {
  const { v, k } = puraIso(iso);
  if (kausiKk === 12) return isoUtc(Date.UTC(v, 12, 0));
  if (kausiKk === 3) return isoUtc(Date.UTC(v, (Math.floor((k - 1) / 3) + 1) * 3, 0));
  return isoUtc(Date.UTC(v, k, 0));
}

/**
 * Seuraava ilmoittamaton kausi: alku = raja + 1 pv, tai AlvAlkaa, tai ensimmäisen tilikauden
 * alku; loppu = alun sisältävän kalenteriyksikön loppu. Vajaa ensimmäinen kausi on siten
 * laillinen (AlvAlkaa 15.3. → 15.3.–31.3.) ja jatko kalenteriin ankkuroitu (tietoinen
 * parannus legacyyn, joka laski alkaa + kk − 1 pv ilman ankkurointia — spec §3.1).
 * Kaikkien lähteiden puuttuessa null (ei kirjanpitoa).
 */
export function seuraavaAlvKausi(
  raja: IsoDate | undefined,
  kausiKk: KausiPituus,
  alvAlkaa: IsoDate | undefined,
  tilikaudet: readonly Tilikausi[],
): AlvKausi | null {
  const alkupvm =
    raja !== undefined && raja !== ''
      ? lisaaPaivia(raja, 1)
      : alvAlkaa !== undefined && alvAlkaa !== ''
        ? alvAlkaa
        : tilikaudet[0]?.alkaa;
  if (alkupvm === undefined) return null;
  return { alkupvm, loppupvm: alvKausiPaivalle(alkupvm, kausiKk).loppupvm };
}

/**
 * Alv-kausi valitun tilikauden sisällä: oletuskausi sellaisenaan, jos se osuu tilikaudelle;
 * muuten tilikauden viimeinen yksikkö (oletus on kauden jälkeen — aiempi tilikausi valittuna)
 * tai ensimmäinen (oletus on ennen kautta).
 */
export function alvKausiTilikaudella(
  kausi: AlvKausi,
  tilikausi: Pick<Tilikausi, 'alkaa' | 'loppuu'>,
  kausiKk: KausiPituus,
): AlvKausi {
  if (osuuTilikaudelle(kausi, tilikausi)) return kausi;
  const paiva = kausi.alkupvm > tilikausi.loppuu ? tilikausi.loppuu : tilikausi.alkaa;
  return alvKausiPaivalle(paiva, kausiKk);
}

/** Osuuko alv-kausi (tai pelkkä päivä, kun otsikkoa ei voi parsia) tilikaudelle. */
export function osuuTilikaudelle(
  kausi: AlvKausi,
  tilikausi: Pick<Tilikausi, 'alkaa' | 'loppuu'>,
): boolean {
  return kausi.loppupvm >= tilikausi.alkaa && kausi.alkupvm <= tilikausi.loppuu;
}

/** Siirrä kautta: eteenpäin loppupvm + 1 pv:n kauteen, taaksepäin alkupvm − 1 pv:n kauteen —
 *  molemmat kalenteriin ankkuroituina (vajaa kausi normalisoituu täydeksi) ja kunkin päivän
 *  omalla verokauden pituudella. */
export function siirraKautta(kausi: AlvKausi, suunta: -1 | 1, kausiKk: KausiPituus): AlvKausi {
  const kohde = suunta === 1 ? lisaaPaivia(kausi.loppupvm, 1) : lisaaPaivia(kausi.alkupvm, -1);
  return alvKausiPaivalle(kohde, kausiKk);
}

/** Pääsiäispäivä (gregoriaaninen, anonyymi algoritmi; kokonaislukulaskentaa). */
function paasiainen(v: number): IsoDate {
  const a = v % 19;
  const b = Math.floor(v / 100);
  const c = v % 100;
  const h =
    (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const kk = Math.floor((h + l - 7 * m + 114) / 31);
  const pp = ((h + l - 7 * m + 114) % 31) + 1;
  return isoUtc(Date.UTC(v, kk - 1, pp));
}

/**
 * Arkipäivä määräajan laskennassa: ei lauantai, sunnuntai eikä arkipäivälle osuva pyhä tai
 * aatto (laki säädettyjen määräaikain laskemisesta 150/1930: pyhäpäivä, itsenäisyyspäivä,
 * vapunpäivä, joulu- ja juhannusaatto). Viikonloppuun osuvat pyhät kattaa jo viikonpäivätesti.
 */
function onArkipaiva(iso: IsoDate): boolean {
  const viikonpaiva = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = su, 6 = la
  if (viikonpaiva === 0 || viikonpaiva === 6) return false;
  const kkpp = iso.slice(5);
  if (['01-01', '01-06', '05-01', '12-06', '12-24', '12-25', '12-26'].includes(kkpp)) return false;
  // Juhannusaatto: perjantai 19.–25.6.
  if (viikonpaiva === 5 && kkpp >= '06-19' && kkpp <= '06-25') return false;
  const paasiaispaiva = paasiainen(Number(iso.slice(0, 4)));
  // Pitkäperjantai, 2. pääsiäispäivä, helatorstai.
  return ![-2, 1, 39].some((ero) => lisaaPaivia(paasiaispaiva, ero) === iso);
}

/**
 * Ilmoituksen ja maksun eräpäivä (legacy alvilmoitustenmodel.cpp:164-181): vuosikausi →
 * loppupvm + 2 kk (päivä clampattuna = helmikuun viimeinen); muuten loppupvm + 1 pv + 1 kk +
 * 11 pv (= toiseksi seuraavan kuun 12. päivä, esim. Q3 → 12.11.). Lauantai tai pyhäpäivä
 * siirtää eräpäivän seuraavaan arkipäivään — vero.fi: "Jos se on lauantai tai pyhäpäivä,
 * määräpäivä siirtyy seuraavaksi arkipäiväksi"
 * (https://vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/arvonlisaverotus/ilmoitus-ja-maksuohjeet/).
 * Legacy siirsi vain viikonlopun yli; pyhät on lisätty.
 */
export function alvErapaiva(loppupvm: IsoDate, kausiKk: KausiPituus): IsoDate {
  let erapvm =
    kausiKkPaivalle(kausiKk, loppupvm) === 12
      ? lisaaKuukausia(loppupvm, 2)
      : lisaaPaivia(lisaaKuukausia(lisaaPaivia(loppupvm, 1), 1), 11);
  while (!onArkipaiva(erapvm)) erapvm = lisaaPaivia(erapvm, 1);
  return erapvm;
}

/** Eräpäivän kiireellisyys (legacy alvsivu.cpp:118-124): eräpäivään < 1 pv (tänään tai ohi)
 *  → danger, < 6 pv → warn, muuten normal. */
export function erapaivanVari(erapvm: IsoDate, tanaan: IsoDate): 'danger' | 'warn' | 'normal' {
  const paivia = paiviaValilla(tanaan, erapvm);
  if (paivia < 1) return 'danger';
  if (paivia < 6) return 'warn';
  return 'normal';
}

/** Päivät tekstistä ISO-muodossa: ISO (vvvv-kk-pp) tai suomalainen (p.k.vvvv), esiintymisjärjestyksessä. */
function paivatTekstista(teksti: string): IsoDate[] {
  const tulos: IsoDate[] = [];
  for (const m of teksti.matchAll(/(\d{4})-(\d{2})-(\d{2})|\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g)) {
    if (m[1] !== undefined) tulos.push(`${m[1]}-${m[2]}-${m[3]}`);
    else tulos.push(`${m[6]}-${(m[5] ?? '').padStart(2, '0')}-${(m[4] ?? '').padStart(2, '0')}`);
  }
  return tulos;
}

/**
 * Parsi tilitystositteen otsikko takaisin kaudeksi: moottorin "Arvonlisävero ${alkupvm} –
 * ${loppupvm}" (alvLaskelma.ts:122) tai Kitsaksesta tuotu "Arvonlisäveroilmoitus 01.01.2025 -
 * 31.03.2025" (alvlaskelma.cpp:945) — kaksi ensimmäistä päivää. Epäonnistuessa null —
 * historia näyttää silloin vain tositepäivän.
 */
export function parsiIlmoitusOtsikko(otsikko: string): AlvKausi | null {
  const [alkupvm, loppupvm] = paivatTekstista(otsikko);
  if (alkupvm === undefined || loppupvm === undefined || alkupvm > loppupvm) return null;
  return { alkupvm, loppupvm };
}

/**
 * Viimeinen ilmoitettu päivä: suurin AlvIlmoitettu-rajasta ja annettujen ilmoitusten
 * kausien loppupäivistä. Kitsaksesta tuodussa kirjassa raja-asetus voi puuttua, vaikka
 * ilmoitukset ovat mukana — ilman tätä sivu avautuisi jo ilmoitetulle kaudelle.
 */
export function viimeisinIlmoitettu(
  raja: IsoDate | undefined,
  ilmoitukset: readonly { otsikko?: string | undefined }[],
): IsoDate | undefined {
  let viimeisin = raja !== undefined && raja !== '' ? raja : undefined;
  for (const t of ilmoitukset) {
    const kausi = t.otsikko !== undefined ? parsiIlmoitusOtsikko(t.otsikko) : null;
    if (kausi && (viimeisin === undefined || kausi.loppupvm > viimeisin))
      viimeisin = kausi.loppupvm;
  }
  return viimeisin;
}
