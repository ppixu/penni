import { lueOhitus, lueTyontekijatTurvallisesti } from '@/palkat/usePalkatAsetukset';
import type { KpClient } from '@penni/asiakas';
import {
  type Asetukset,
  type IsoDate,
  type PalkkaAjo,
  type PalkkaHenkilo,
  type PalkkaRivi,
  type StoredTosite,
  TositeTila,
  TositeTyyppi,
  onkoPvmValidi,
  tiliAsetuksesta,
} from '@penni/engine';
import type { Cents } from '@penni/euro';
import {
  ASETUS,
  type Maksaja,
  type PalkatAsetukset,
  type Palkkatilit,
  type SyoteRivi,
  type TaulukkoOhitus,
  type Tyontekija,
  kertymaVerokortille,
  laskePalkka,
  luePalkatAsetukset,
  luePalkkatilit,
  taulukkoHaku,
  valitseVerokortti,
} from '@penni/palkat';

/**
 * Palkka-ajon yhteiset palat lomakkeelle, tallennukselle ja tiedostoille: kirjan palkkatietojen
 * luku asetuksista, aiempien palkka-ajojen haku ja henkilön laskenta. Virheviesteissä ei koskaan
 * ole henkilötunnusta eikä IBANia; nimiä vain käyttöliittymään menevissä viesteissä.
 */

export type PalkkaAjoVirheKoodi =
  | 'SYOTE' // luonnos on virheellinen (päivät, henkilöt)
  | 'REKISTERI' // työntekijärekisteri tai palkka-asetukset ovat viallisia
  | 'TYONTEKIJA' // ajon henkilö puuttuu rekisteristä
  | 'PALKKATILIT' // nettopalkkojen maksutili (MP) puuttuu tai kartta on viallinen
  | 'NEGATIIVINEN' // jonkin henkilön nettopalkka on negatiivinen
  | 'EI_PALKKA_AJO' // tosite ei ole (voimassa oleva) palkka-ajo
  | 'LAHETETTY' // ilmoitus on merkitty lähetetyksi: ajo on vain luku
  | 'YTUNNUS' // kirjalta puuttuu Y-tunnus (XML)
  | 'YHTEYSHENKILO'; // palkka-asetuksista puuttuu yhteyshenkilö (XML)

export class PalkkaAjoVirhe extends Error {
  constructor(
    readonly koodi: PalkkaAjoVirheKoodi,
    viesti: string,
  ) {
    super(viesti);
    this.name = 'PalkkaAjoVirhe';
  }
}

/** Kirjan palkkatiedot asetuksista. `palkkatilit` puuttuu, jos MP:tä ei ole valittu. */
export interface KirjanPalkkatiedot {
  asetukset: Asetukset;
  tyontekijat: ReadonlyMap<string, Tyontekija>;
  palkatAsetukset: PalkatAsetukset;
  ohitus: TaulukkoOhitus;
  palkkatilit: Palkkatilit | undefined;
}

/** Lukee palkkarekisterin ja -asetukset. Heittää `PalkkaAjoVirhe('REKISTERI')`, jos ne ovat viallisia. */
export function luePalkkatiedot(asetukset: Asetukset): KirjanPalkkatiedot {
  const luku = lueTyontekijatTurvallisesti(asetukset);
  if (luku.virhe) throw new PalkkaAjoVirhe('REKISTERI', luku.virhe);
  let palkatAsetukset: PalkatAsetukset;
  try {
    palkatAsetukset = luePalkatAsetukset(asetukset);
  } catch {
    throw new PalkkaAjoVirhe('REKISTERI', 'Palkka-asetukset ovat virheelliset. Tarkista ne.');
  }
  let ohitus: TaulukkoOhitus;
  try {
    ohitus = lueOhitus(asetukset[ASETUS.taulukot]);
  } catch {
    throw new PalkkaAjoVirhe(
      'REKISTERI',
      'Palkkataulukon omat arvot (PalkatTaulukot) ovat virheelliset. Tarkista palkka-asetukset.',
    );
  }
  let palkkatilit: Palkkatilit | undefined;
  try {
    palkkatilit = luePalkkatilit(asetukset, tiliAsetuksesta(asetukset, 'LaskuMaksutili') ?? 0);
  } catch {
    palkkatilit = undefined;
  }
  return {
    asetukset,
    tyontekijat: new Map(luku.tyontekijat.map((t) => [t.id, t])),
    palkatAsetukset,
    ohitus,
    palkkatilit,
  };
}

export function vaadiPalkkatilit(tiedot: KirjanPalkkatiedot): Palkkatilit {
  if (!tiedot.palkkatilit) {
    throw new PalkkaAjoVirhe(
      'PALKKATILIT',
      'Nettopalkkojen maksutiliä ei ole valittu tai palkkatilit ovat virheelliset. Valitse se palkka-asetuksista.',
    );
  }
  return tiedot.palkkatilit;
}

/** Kirjattu palkka-ajo: tositteen id, maksupäivä ja tilannekuva. */
export interface AiempiAjo {
  id: number;
  pvm: IsoDate;
  palkka: PalkkaAjo;
}

/** Kirjatut (ei poistetut) palkka-ajot. Tyyppisuodatin tehdään myös itse varmuuden vuoksi. */
export async function haePalkkaAjot(client: KpClient): Promise<AiempiAjo[]> {
  const tositteet = await client.listaaTositteet({ tyyppi: TositeTyyppi.PALKKA });
  return palkkaAjotTositteista(tositteet);
}

export function palkkaAjotTositteista(tositteet: readonly StoredTosite[]): AiempiAjo[] {
  const ajot: AiempiAjo[] = [];
  for (const t of tositteet) {
    if (t.tyyppi !== TositeTyyppi.PALKKA || t.tila < TositeTila.KIRJANPIDOSSA || !t.palkka)
      continue;
    ajot.push({ id: t.id, pvm: t.pvm, palkka: t.palkka });
  }
  return ajot;
}

/**
 * Ajot, jotka edeltävät maksua: maksupäivä aiemmin, tai sama päivä ja pienempi id. Muokattava
 * ajo (`omaId`) jätetään aina pois; uudella ajolla (ei id:tä) kaikki saman päivän ajot edeltävät.
 */
export function edeltavatAjot(
  ajot: readonly AiempiAjo[],
  maksupaiva: IsoDate,
  omaId?: number,
): AiempiAjo[] {
  return ajot.filter(
    (a) =>
      a.id !== omaId &&
      (a.pvm < maksupaiva || (a.pvm === maksupaiva && (omaId === undefined || a.id < omaId))),
  );
}

export interface PalkkaAjoLuonnos {
  maksupaiva: IsoDate;
  kausiAlkaa: IsoDate;
  kausiLoppuu: IsoDate;
  syotteet: { tyontekijaId: string; rivit: SyoteRivi[] }[];
}

/** Tarkistaa luonnoksen päivät ja henkilöt (laskenta tarkistaa rivit). */
export function tarkistaLuonnos(l: PalkkaAjoLuonnos): void {
  for (const [pvm, nimi] of [
    [l.maksupaiva, 'Maksupäivä'],
    [l.kausiAlkaa, 'Palkkakauden alku'],
    [l.kausiLoppuu, 'Palkkakauden loppu'],
  ] as const) {
    if (!onkoPvmValidi(pvm))
      throw new PalkkaAjoVirhe('SYOTE', `${nimi} puuttuu tai on virheellinen.`);
  }
  if (l.kausiAlkaa > l.kausiLoppuu) {
    throw new PalkkaAjoVirhe('SYOTE', 'Palkkakauden alku on lopun jälkeen.');
  }
  if (l.syotteet.length === 0) throw new PalkkaAjoVirhe('SYOTE', 'Valitse vähintään yksi henkilö.');
  const idt = new Set(l.syotteet.map((s) => s.tyontekijaId));
  if (idt.size !== l.syotteet.length) {
    throw new PalkkaAjoVirhe('SYOTE', 'Sama henkilö on palkka-ajossa kahdesti.');
  }
}

/** Rekisterin työntekijä; puuttuva on virhe (työntekijöitä ei poisteta, vain poistetaan käytöstä). */
export function haeTyontekija(tiedot: KirjanPalkkatiedot, id: string): Tyontekija {
  const t = tiedot.tyontekijat.get(id);
  if (!t) {
    throw new PalkkaAjoVirhe(
      'TYONTEKIJA',
      'Palkka-ajon henkilöä ei löydy työntekijärekisteristä (tietue voi olla viallinen).',
    );
  }
  return t;
}

/**
 * Yhden henkilön laskenta: verokortin tulokertymä edeltävistä ajoista (`kertymaVerokortille`,
 * kortin `aiemminMaksettu` mukaan lukien). Heittää `PalkatVirhe`n (esim. TAULUKKO_PUUTTUU).
 */
export function laskeHenkilo(
  l: Pick<PalkkaAjoLuonnos, 'maksupaiva' | 'kausiAlkaa' | 'kausiLoppuu'>,
  tyontekija: Tyontekija,
  rivit: SyoteRivi[],
  tiedot: KirjanPalkkatiedot,
  edeltavat: readonly AiempiAjo[],
): PalkkaHenkilo {
  const valinta = valitseVerokortti(tyontekija.verokortit, l.maksupaiva);
  const aiempiKertyma = valinta
    ? kertymaVerokortille(valinta.kortti, tyontekija.id, edeltavat)
    : (0 as Cents);
  return laskePalkka(
    {
      tyontekija,
      maksupaiva: l.maksupaiva,
      kausiAlkaa: l.kausiAlkaa,
      kausiLoppuu: l.kausiLoppuu,
      rivit,
    },
    { taulukko: taulukkoHaku(tiedot.ohitus), asetukset: tiedot.palkatAsetukset, aiempiKertyma },
  );
}

/** Koko ajon laskenta (puhdas). `edeltavat` = `edeltavatAjot(…)`. */
export function laskeAjoTiedoista(
  l: PalkkaAjoLuonnos,
  tiedot: KirjanPalkkatiedot,
  edeltavat: readonly AiempiAjo[],
  laskettu: string,
): PalkkaAjo {
  tarkistaLuonnos(l);
  return {
    versio: 1,
    kausiAlkaa: l.kausiAlkaa,
    kausiLoppuu: l.kausiLoppuu,
    laskettu,
    henkilot: l.syotteet.map((s) =>
      laskeHenkilo(l, haeTyontekija(tiedot, s.tyontekijaId), s.rivit, tiedot, edeltavat),
    ),
  };
}

/** Lajit, joiden summa syötetään; muiden summa (ja a-hinta) lasketaan taulukosta uudelleen. */
const SYOTETTY_SUMMA = new Set<PalkkaRivi['laji']>(['kuukausipalkka', 'lisa', 'kulukorvaus']);
/** Lajit, joiden a-hinta syötetään (tuntipalkka, ravintoedun ateriakustannus). */
const SYOTETTY_HINTA = new Set<PalkkaRivi['laji']>(['tuntipalkka', 'ravintoetu']);

/** Tallennetun ajon rivi takaisin syöteriviksi muokkausta varten (kopio, ei viittausta). */
export function syoteRiviksi(r: PalkkaRivi): SyoteRivi {
  const { summa, ahinta, ...muut } = structuredClone(r);
  const rivi: SyoteRivi = { ...muut };
  if (SYOTETTY_SUMMA.has(r.laji)) rivi.summa = summa;
  if (SYOTETTY_HINTA.has(r.laji) && ahinta !== undefined) rivi.ahinta = ahinta;
  return rivi;
}

/** Tallennetusta tositteesta muokattava luonnos (tilannekuva kopioidaan: koodekki jakaa olion). */
export function luonnosTositteesta(t: StoredTosite): PalkkaAjoLuonnos {
  if (!t.palkka) throw new PalkkaAjoVirhe('EI_PALKKA_AJO', 'Tosite ei ole palkka-ajo.');
  const ajo = structuredClone(t.palkka);
  return {
    maksupaiva: t.pvm,
    kausiAlkaa: ajo.kausiAlkaa,
    kausiLoppuu: ajo.kausiLoppuu,
    syotteet: ajo.henkilot.map((h) => ({
      tyontekijaId: h.tyontekijaId,
      rivit: h.rivit.map(syoteRiviksi),
    })),
  };
}

/** Bruttopalkka palkkalaskelmalle ja yhteenvetoon: rahapalkka + luontoisedut. */
export const brutto = (h: PalkkaHenkilo): Cents =>
  (h.tulos.rahapalkka + h.tulos.luontoisedut) as Cents;

/**
 * Palkkalaskelman vuoden alusta -kertymät: saman kalenterivuoden edeltävät kirjatut ajot
 * (`edeltavatAjot`) + tämä maksu. Brutto = rahapalkka + luontoisedut.
 */
export function vuodenAlusta(
  tosite: { id: number; pvm: IsoDate },
  henkilo: PalkkaHenkilo,
  ajot: readonly AiempiAjo[],
): { brutto: Cents; ennakonpidatys: Cents; netto: Cents } {
  const vuosi = tosite.pvm.slice(0, 4);
  let b = brutto(henkilo) as number;
  let pidatys = henkilo.tulos.ennakonpidatys as number;
  let netto = henkilo.tulos.nettopalkka as number;
  for (const a of edeltavatAjot(ajot, tosite.pvm, tosite.id)) {
    if (a.pvm.slice(0, 4) !== vuosi) continue;
    for (const h of a.palkka.henkilot) {
      if (h.tyontekijaId !== henkilo.tyontekijaId) continue;
      b += brutto(h);
      pidatys += h.tulos.ennakonpidatys;
      netto += h.tulos.nettopalkka;
    }
  }
  return { brutto: b as Cents, ennakonpidatys: pidatys as Cents, netto: netto as Cents };
}

/** Maksaja kirjan perustiedoista ja palkka-asetuksista; puuttuva Y-tunnus tai yhteyshenkilö estää XML:n. */
export function maksajaAsetuksista(asetukset: Asetukset, p: PalkatAsetukset): Maksaja {
  const ytunnus = (asetukset.Ytunnus ?? '').trim();
  if (ytunnus === '') {
    throw new PalkkaAjoVirhe('YTUNNUS', 'Kirjan Y-tunnus puuttuu. Lisää se kirjan asetuksiin.');
  }
  const y = p.yhteyshenkilo;
  if (!y || y.nimi.trim() === '' || y.puhelin.trim() === '') {
    throw new PalkkaAjoVirhe(
      'YHTEYSHENKILO',
      'Palkkatietoilmoituksen yhteyshenkilön nimi ja puhelinnumero puuttuvat. Lisää ne palkka-asetuksiin.',
    );
  }
  const maksaja: Maksaja = {
    ytunnus,
    nimi: (asetukset.Nimi ?? '').trim(),
    yhteyshenkilo: { nimi: y.nimi.trim(), puhelin: y.puhelin.trim() },
  };
  // Osoite tarvitaan vain tilapäisen työnantajan ilmoitukseen; monirivinen osoite yhdelle riville.
  const katu = (asetukset.Osoite ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
  const postinumero = (asetukset.Postinumero ?? '').trim();
  const kaupunki = (asetukset.Kaupunki ?? '').trim();
  if (katu || postinumero || kaupunki) maksaja.osoite = { katu, postinumero, kaupunki };
  return maksaja;
}

/** Tositteen otsikko: koko kalenterikuukausi "Palkat 10/2026", muuten päivät. */
export function palkkaAjonOtsikko(kausiAlkaa: IsoDate, kausiLoppuu: IsoDate): string {
  const [v, k, p] = kausiAlkaa.split('-');
  const kuunLoppu = new Date(Date.UTC(Number(v), Number(k), 0)).getUTCDate();
  if (p === '01' && kausiLoppuu === `${v}-${k}-${String(kuunLoppu).padStart(2, '0')}`) {
    return `Palkat ${Number(k)}/${v}`;
  }
  const fi = (d: IsoDate) => {
    const [vv, kk, pp] = d.split('-');
    return `${Number(pp)}.${Number(kk)}.${vv}`;
  };
  return `Palkat ${fi(kausiAlkaa)}–${fi(kausiLoppuu)}`;
}
