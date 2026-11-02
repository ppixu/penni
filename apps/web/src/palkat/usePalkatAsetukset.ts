import { useKpClient } from '@/app/KpClientProvider';
import { useInit, usePaivitaAsetukset } from '@/app/kysely';
import type { Asetukset } from '@penni/engine';
import { tiliAsetuksesta } from '@penni/engine';
import {
  ASETUS,
  type PalkatAsetukset,
  type PalkkaKoodi,
  type Palkkatilit,
  type TaulukkoKentta,
  type TaulukkoOhitus,
  type Tyontekija,
  luePalkatAsetukset,
  luePalkkatilit,
  lueTyontekijat,
} from '@penni/palkat';
import { useMemo } from 'react';

/**
 * Palkkarekisterin lukeminen ja tallentaminen kirjan asetuksiin (JSON-merkkijonoina).
 * Virheilmoituksiin ei koskaan päädy henkilötunnusta, IBANia eikä syötettyjä arvoja:
 * `@penni/palkat`-lukijat palauttavat vain kenttäpolkuja.
 */

const TALLENNUS_EPAONNISTUI = 'Tallennus epäonnistui.';

type Raaka = Record<string, unknown>;

const onOlio = (x: unknown): x is Raaka => typeof x === 'object' && x !== null && !Array.isArray(x);

function jasennaJson(teksti: string | undefined): unknown {
  if (teksti === undefined || teksti.trim() === '') return undefined;
  return JSON.parse(teksti) as unknown;
}

/** Lukijan virheestä pois asetusavain ja taulukkoindeksi: jäljelle jää "kenttä: syy". */
function siistiSyy(e: unknown): string {
  const viesti = e instanceof Error ? e.message : 'tuntematon virhe';
  return viesti.replace(/^Asetus \S+ on virheellinen: /, '').replace(/(^|; )\d+\./g, '$1');
}

/** Rikkinäinen tallennettu tietue: järjestysnumero (1 alkaen) ja nimi, jos se on luettavissa. */
export interface RikkinainenTyontekija {
  jarjestys: number;
  nimi?: string;
  syy: string;
}

export interface TyontekijaLuku {
  tyontekijat: Tyontekija[];
  rikkinaiset: RikkinainenTyontekija[];
  /** Koko asetus on käyttökelvoton (esim. ei JSON-taulukko). */
  virhe?: string;
}

/**
 * Lukee `PalkatTyontekijat` tietue kerrallaan: yksi viallinen tietue ei kaada muita.
 * (`lueTyontekijat` heittää koko listasta, jos yksikin tietue on virheellinen.)
 */
export function lueTyontekijatTurvallisesti(asetukset: Asetukset): TyontekijaLuku {
  let raaka: unknown;
  try {
    raaka = jasennaJson(asetukset[ASETUS.tyontekijat]);
  } catch {
    return {
      tyontekijat: [],
      rikkinaiset: [],
      virhe: 'Työntekijärekisteri ei ole kelvollista JSONia.',
    };
  }
  if (raaka === undefined) return { tyontekijat: [], rikkinaiset: [] };
  if (!Array.isArray(raaka)) {
    return { tyontekijat: [], rikkinaiset: [], virhe: 'Työntekijärekisterin pitäisi olla lista.' };
  }
  const tyontekijat: Tyontekija[] = [];
  const rikkinaiset: RikkinainenTyontekija[] = [];
  raaka.forEach((tietue, i) => {
    try {
      const [t] = lueTyontekijat({ [ASETUS.tyontekijat]: JSON.stringify([tietue]) });
      if (t) tyontekijat.push(t);
    } catch (e) {
      const nimi = onOlio(tietue) && typeof tietue.nimi === 'string' ? tietue.nimi : undefined;
      rikkinaiset.push({
        jarjestys: i + 1,
        ...(nimi !== undefined && nimi !== '' ? { nimi } : {}),
        syy: siistiSyy(e),
      });
    }
  });
  return { tyontekijat, rikkinaiset };
}

/** Tallennusfunktiot lukevat asetukset tuoreina juuri ennen kirjoitusta (ei vanhentunutta kopiota). */
function useAsetusKirjoitus() {
  const client = useKpClient();
  const { tallenna, virheviesti, tallentaa } = usePaivitaAsetukset();
  async function kirjoita(avain: string, arvo: string): Promise<void> {
    if (!(await tallenna({ [avain]: arvo }))) throw new Error(TALLENNUS_EPAONNISTUI);
  }
  return { client, kirjoita, virheviesti, tallentaa };
}

export interface UseTyontekijat {
  /** Kelvolliset työntekijät (myös ei-aktiiviset) tallennusjärjestyksessä. */
  tyontekijat: Tyontekija[];
  /** Tallennetut tietueet, joita ei voitu lukea. Ne säilyvät tallennuksessa sellaisinaan. */
  rikkinaiset: RikkinainenTyontekija[];
  /** Koko rekisteri käyttökelvoton; tallennus on estetty. */
  virhe: string | undefined;
  ladataan: boolean;
  /** Lisää uuden (tuntematon id) tai korvaa saman id:n tietueen. Heittää virheen epäonnistuessaan. */
  tallenna(t: Tyontekija): Promise<void>;
  tallentaa: boolean;
  virheviesti: string | null;
}

export function useTyontekijat(): UseTyontekijat {
  const { data: init, isLoading } = useInit();
  const { client, kirjoita, virheviesti, tallentaa } = useAsetusKirjoitus();
  const luku = useMemo(() => (init ? lueTyontekijatTurvallisesti(init.asetukset) : null), [init]);

  async function tallenna(t: Tyontekija): Promise<void> {
    const tuoreet = await client.haeAsetukset();
    let lista: unknown[];
    try {
      const raaka = jasennaJson(tuoreet[ASETUS.tyontekijat]) ?? [];
      if (!Array.isArray(raaka)) throw new Error();
      lista = raaka;
    } catch {
      throw new Error('Työntekijärekisteri on vioittunut: tallennus estetty.');
    }
    const kohta = lista.findIndex((x) => onOlio(x) && x.id === t.id);
    if (kohta >= 0) lista[kohta] = t;
    else lista.push(t);
    await kirjoita(ASETUS.tyontekijat, JSON.stringify(lista));
  }

  return {
    tyontekijat: luku?.tyontekijat ?? [],
    rikkinaiset: luku?.rikkinaiset ?? [],
    virhe: luku?.virhe,
    ladataan: isLoading,
    tallenna,
    tallentaa,
    virheviesti,
  };
}

const ASETUS_KENTAT = [
  'tyelYhtio',
  'tyelSopimus',
  'tyelKokonaisBp',
  'tilapainenTyonantaja',
  'tapaturmaYhtio',
  'tapaturmaSopimus',
  'yhteyshenkilo',
  'tvrVapautus',
  'omaVeroViite',
] as const satisfies ReadonlyArray<keyof PalkatAsetukset>;

/** Koodit, joille käyttöliittymä näyttää valitsimen (MP:tä lukuun ottamatta kaikilla on oletus). */
export const PALKKATILI_KOODIT: readonly PalkkaKoodi[] = [
  'PA',
  'LK',
  'LU',
  'LV',
  'KM',
  'PR',
  'AT',
  'EP',
  'SB',
  'SV',
  'EL',
  'TV',
  'TL',
  'TT',
  'MP',
];

function lueOhitus(teksti: string | undefined): TaulukkoOhitus {
  const raaka = jasennaJson(teksti);
  if (raaka === undefined) return {};
  if (!onOlio(raaka)) throw new Error('odotettiin oliota');
  const tulos: TaulukkoOhitus = {};
  for (const [vuosi, kentat] of Object.entries(raaka)) {
    if (!/^\d{4}$/.test(vuosi) || !onOlio(kentat)) throw new Error('virheellinen vuosi');
    const rivi: Partial<Record<TaulukkoKentta, number>> = {};
    for (const [k, v] of Object.entries(kentat)) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
        throw new Error('virheellinen arvo');
      rivi[k as TaulukkoKentta] = v;
    }
    tulos[vuosi] = rivi;
  }
  return tulos;
}

export interface PalkatAsetuksetVirheet {
  asetukset?: string;
  palkkatilit?: string;
  ohitus?: string;
}

export interface UsePalkatAsetukset {
  asetukset: PalkatAsetukset;
  /** Kelvollinen tilikartta; `undefined`, jos MP (nettopalkkojen maksutili) puuttuu tai kartta on viallinen. */
  palkkatilit: Palkkatilit | undefined;
  /** Lomakkeen lähtötilanne: oletukset + tallennettu kartta; MP puuttuu, jos sitä ei ole valittu. */
  palkkatiliLuonnos: Partial<Palkkatilit>;
  /** Nettopalkkojen maksutiliä ei ole valittu eikä kirjalla ole LaskuMaksutiliä. */
  mpPuuttuu: boolean;
  ohitus: TaulukkoOhitus;
  virheet: PalkatAsetuksetVirheet;
  ladataan: boolean;
  /** Korvaa PalkatAsetukset-kentät (tuntemattomat kentät säilyvät). Heittää virheen epäonnistuessaan. */
  tallennaAsetukset(a: PalkatAsetukset): Promise<void>;
  /** Yhdistää annetut koodit tallennettuun karttaan; muut koodit (esim. Kitsaan AY, UO) säilyvät. */
  tallennaPalkkatilit(osa: Partial<Palkkatilit>): Promise<void>;
  /**
   * Asettaa vuoden oman arvon (`undefined` poistaa sen) ja kirjoittaa `PalkatTaulukot`-asetuksen.
   * Tyhjä vuosi poistetaan.
   */
  tallennaOhitus(
    vuosi: number,
    arvot: Partial<Record<TaulukkoKentta, number | undefined>>,
  ): Promise<void>;
  tallentaa: boolean;
  virheviesti: string | null;
}

const OLETUS_ASETUKSET: PalkatAsetukset = { tilapainenTyonantaja: false, tvrVapautus: false };

export function usePalkatAsetukset(): UsePalkatAsetukset {
  const { data: init, isLoading } = useInit();
  const { client, kirjoita, virheviesti, tallentaa } = useAsetusKirjoitus();

  const luettu = useMemo(() => {
    const a = init?.asetukset ?? {};
    const virheet: PalkatAsetuksetVirheet = {};
    let asetukset = OLETUS_ASETUKSET;
    try {
      asetukset = luePalkatAsetukset(a);
    } catch (e) {
      virheet.asetukset = siistiSyy(e);
    }
    let ohitus: TaulukkoOhitus = {};
    try {
      ohitus = lueOhitus(a[ASETUS.taulukot]);
    } catch {
      virheet.ohitus = 'Palkkataulukon omat arvot (PalkatTaulukot) ovat virheelliset.';
    }
    const pankki = tiliAsetuksesta(a, 'LaskuMaksutili');
    let palkkatilit: Palkkatilit | undefined;
    let palkkatiliLuonnos: Partial<Palkkatilit> = {};
    let mpPuuttuu = false;
    try {
      palkkatilit = luePalkkatilit(a, pankki ?? 0);
      palkkatiliLuonnos = palkkatilit;
    } catch {
      // MP puuttuu tai kartta on viallinen: koetaan tekotilillä erottelemaan nämä.
      try {
        const { MP: _tekomp, ...ilmanMp } = luePalkkatilit(a, 1);
        palkkatiliLuonnos = ilmanMp;
        mpPuuttuu = true;
      } catch (e) {
        virheet.palkkatilit = siistiSyy(e);
      }
    }
    return { asetukset, ohitus, palkkatilit, palkkatiliLuonnos, mpPuuttuu, virheet };
  }, [init]);

  async function tuore(avain: string): Promise<string | undefined> {
    return (await client.haeAsetukset())[avain];
  }

  async function tallennaAsetukset(a: PalkatAsetukset): Promise<void> {
    if (luettu.virheet.asetukset) {
      throw new Error('Tallennetut palkka-asetukset ovat virheelliset: tallennus estetty.');
    }
    let pohja: Raaka = {};
    try {
      const raaka = jasennaJson(await tuore(ASETUS.asetukset));
      if (onOlio(raaka)) pohja = raaka;
    } catch {
      throw new Error('Palkka-asetukset ovat vioittuneet: tallennus estetty.');
    }
    const uusi: Raaka = { ...pohja };
    for (const k of ASETUS_KENTAT) {
      if (a[k] === undefined) delete uusi[k];
      else uusi[k] = a[k];
    }
    await kirjoita(ASETUS.asetukset, JSON.stringify(uusi));
  }

  async function tallennaPalkkatilit(osa: Partial<Palkkatilit>): Promise<void> {
    let kartta: Raaka = {};
    try {
      const raaka = jasennaJson(await tuore(ASETUS.palkkatilit));
      if (onOlio(raaka)) kartta = raaka;
    } catch {
      throw new Error('Palkkatilit-asetus on vioittunut: tallennus estetty.');
    }
    const uusi: Raaka = { ...kartta };
    for (const [koodi, tili] of Object.entries(osa)) {
      if (tili !== undefined) uusi[koodi] = tili;
    }
    await kirjoita(ASETUS.palkkatilit, JSON.stringify(uusi));
  }

  async function tallennaOhitus(
    vuosi: number,
    arvot: Partial<Record<TaulukkoKentta, number | undefined>>,
  ): Promise<void> {
    if (luettu.virheet.ohitus) {
      throw new Error('Palkkataulukon omat arvot ovat virheelliset: tallennus estetty.');
    }
    let nykyinen: TaulukkoOhitus;
    try {
      nykyinen = lueOhitus(await tuore(ASETUS.taulukot));
    } catch {
      throw new Error('Palkkataulukon omat arvot ovat vioittuneet: tallennus estetty.');
    }
    const avain = String(vuosi);
    const rivi: Partial<Record<TaulukkoKentta, number>> = { ...(nykyinen[avain] ?? {}) };
    for (const [k, v] of Object.entries(arvot)) {
      if (v === undefined) delete rivi[k as TaulukkoKentta];
      else rivi[k as TaulukkoKentta] = v;
    }
    const uusi: TaulukkoOhitus = { ...nykyinen };
    if (Object.keys(rivi).length === 0) delete uusi[avain];
    else uusi[avain] = rivi;
    await kirjoita(ASETUS.taulukot, JSON.stringify(uusi));
  }

  return {
    asetukset: luettu.asetukset,
    palkkatilit: luettu.palkkatilit,
    palkkatiliLuonnos: luettu.palkkatiliLuonnos,
    mpPuuttuu: luettu.mpPuuttuu,
    ohitus: luettu.ohitus,
    virheet: luettu.virheet,
    ladataan: isLoading,
    tallennaAsetukset,
    tallennaPalkkatilit,
    tallennaOhitus,
    tallentaa,
    virheviesti,
  };
}
