import { samatArvot } from '@/tallentamaton/vertailu';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

/** Automaattisen tallennuksen tila tilariville. `tallennetaan` = tallennus odottaa tai on kesken. */
export type TallennusTila = 'tallennettu' | 'tallennetaan' | 'virhe' | 'eiKelpaa';

export interface AutotallennuksenAjat {
  /** Tauko viimeisestä muutoksesta ennen tallennusta (ms). */
  viive: number;
  /** Epäonnistuneen tallennuksen uusintaväli (ms). */
  uudelleenyritys: number;
}

/**
 * Ajastus kontekstissa: reittitestit pidentävät tauon, jolloin tallennus tapahtuu vain kentästä
 * poistuttaessa, sivulta poistuttaessa tai erikseen pyydettäessä (ennustettava lokirivimäärä).
 */
export const AutotallennusAjat = createContext<AutotallennuksenAjat>({
  viive: 1_000,
  uudelleenyritys: 5_000,
});

export interface AutotallennusAsetukset<T> {
  /** Tallentaa tilan; heittää virheen epäonnistuessaan. */
  tallenna: (tila: T) => Promise<unknown>;
  /** Vertailuprojektio: sama projektio = ei muutosta (samatArvot). */
  vertailuun: (tila: T) => unknown;
  /** Miksi tilaa ei saa tallentaa (esim. "ei täsmää"); null = saa. */
  este?: ((tila: T) => string | null) | undefined;
  /** Virheen syy tilariville. */
  kuvaaVirhe: (virhe: unknown) => string;
}

/** Poisto pysäyttää tallennuksen, jottei odottava muutos kirjoita poistettua takaisin. */
export interface TallennuksenPysaytys {
  /** Peru ajastimet, älä tallenna enää (ei edes irrotettaessa) ja odota kesken oleva. */
  lopeta: () => Promise<void>;
  /** Peru lopetus (esim. poisto epäonnistui). */
  jatka: () => void;
}

export interface AutomaattinenTallennus<T> extends TallennuksenPysaytys {
  tila: TallennusTila;
  syy: string | null;
  /** Onko tällä käynnillä tallennettu jotain (tilarivi, Palauta). */
  tallennettuKerran: boolean;
  /** Lomakkeen uusi tila. Ensimmäinen kutsu on pohja: sitä ei tallenneta. */
  muuttui: (tila: T) => void;
  /** Kenttä menetti fokuksen: odottava muutos tallennetaan heti. */
  kenttaPoistui: () => void;
  /** Tallenna viimeisin (tai annettu) tila nyt, myös muuttumattomana; true = tallentui. */
  pakotaTallennus: (tila?: T) => Promise<boolean>;
  /** Aja toiminto tallennusjonossa: kesken oleva odotetaan, eikä uusi ala ennen sen loppua. */
  jonossa: <R>(toiminto: () => Promise<R>) => Promise<R>;
  /** Tila on tallessa (esim. kirjattu): siitä ei tehdä automaattista tallennusta. */
  asetaPohja: (tila: T) => void;
  /** Uusi tyhjä lomake (Kirjaa ja uusi): uusi pohja, ei aiempaa tallennusta. */
  nollaa: (tila: T) => void;
  /** Menisikö viimeisin muutos hukkaan poistuttaessa (este tai epäonnistunut tallennus)? */
  onkoMenossaHukkaan: () => boolean;
}

interface Nakyma {
  setTila: (t: TallennusTila) => void;
  setSyy: (s: string | null) => void;
  setTallennettuKerran: (k: boolean) => void;
}

interface Nykyiset<T> {
  asetukset: AutotallennusAsetukset<T>;
  ajat: AutotallennuksenAjat;
}

/** Tallennuksen tilakone: yksi instanssi hookia kohden, lukee asetukset aina tuoreina. */
function luoKone<T>(nyt: () => Nykyiset<T>, nakyma: Nakyma) {
  let viimeisin: { arvo: T } | null = null;
  let pohja: { projektio: unknown } | null = null;
  let epaonnistui = false;
  let lopetettu = false;
  let autoJonossa = false;
  let kaynnissa = false;
  /** Irrotettu: ei ajastimia eikä näkymäpäivityksiä; vain irrotushetken yksi yritys. */
  let irrotettu = false;
  /** `nollaa` aloittaa uuden sukupolven; vanhan lomakkeen tallennus ei koske uuteen. */
  let sukupolvi = 0;
  let ajastin: ReturnType<typeof setTimeout> | null = null;
  let uusinta: ReturnType<typeof setTimeout> | null = null;
  let ketju: Promise<unknown> = Promise.resolve();

  const haeViimeisin = (): { arvo: T } | null => viimeisin;

  function nayta(t: TallennusTila, s: string | null = null) {
    if (irrotettu) return;
    nakyma.setTila(t);
    nakyma.setSyy(s);
  }
  function sama(arvo: T): boolean {
    return pohja !== null && samatArvot(nyt().asetukset.vertailuun(arvo), pohja.projektio);
  }
  function este(arvo: T): string | null {
    return nyt().asetukset.este?.(arvo) ?? null;
  }
  function peruAjastimet() {
    if (ajastin !== null) clearTimeout(ajastin);
    if (uusinta !== null) clearTimeout(uusinta);
    ajastin = null;
    uusinta = null;
  }
  function ajasta() {
    if (irrotettu) return;
    if (ajastin !== null) clearTimeout(ajastin);
    ajastin = setTimeout(laukaise, nyt().ajat.viive);
  }
  function jonoon<R>(toiminto: () => Promise<R>): Promise<R> {
    const tulos = ketju.then(toiminto);
    ketju = tulos.catch(() => undefined);
    return tulos;
  }

  async function suorita(pakota: boolean, irrotusYritys = false): Promise<boolean> {
    const alku = haeViimeisin();
    if (alku === null || lopetettu || (irrotettu && !irrotusYritys)) return false;
    const { arvo } = alku;
    if (!pakota && sama(arvo)) {
      nayta('tallennettu');
      return true;
    }
    const syy = este(arvo);
    if (syy !== null) {
      nayta('eiKelpaa', syy);
      return false;
    }
    nayta('tallennetaan');
    kaynnissa = true;
    const tama = sukupolvi;
    try {
      await nyt().asetukset.tallenna(arvo);
    } catch (virhe) {
      if (tama !== sukupolvi) return false; // `nollaa` ehti väliin: uusi lomake ei kuulu tähän
      kaynnissa = false;
      if (irrotettu || lopetettu) return false; // ei uusintaa, ei tilarivin päivitystä
      epaonnistui = true;
      nayta('virhe', nyt().asetukset.kuvaaVirhe(virhe));
      if (uusinta !== null) clearTimeout(uusinta);
      uusinta = setTimeout(laukaise, nyt().ajat.uudelleenyritys);
      return false;
    }
    if (tama !== sukupolvi) return true; // vanhan lomakkeen tallennus: uuden pohja ja tila koskemattomia
    kaynnissa = false;
    epaonnistui = false;
    pohja = { projektio: nyt().asetukset.vertailuun(arvo) };
    if (irrotettu) return true;
    nakyma.setTallennettuKerran(true);
    const uusin = haeViimeisin();
    if (uusin === null || sama(uusin.arvo)) nayta('tallennettu');
    else {
      const uusiSyy = este(uusin.arvo);
      if (uusiSyy !== null) nayta('eiKelpaa', uusiSyy);
      else if (ajastin === null && !autoJonossa && !lopetettu) {
        // Tallennuksen aikana tullut muutos, jonka ajastin ehti jo laueta tai perua.
        nayta('tallennetaan');
        ajasta();
      }
    }
    return true;
  }

  /** Käynnistä automaattinen tallennus nyt; jonossa jo odottava lukee viimeisimmän tilan. */
  function laukaise() {
    peruAjastimet();
    if (lopetettu || irrotettu || autoJonossa) return;
    autoJonossa = true;
    void jonoon(async () => {
      autoJonossa = false;
      await suorita(false);
    });
  }

  function muuttui(arvo: T) {
    viimeisin = { arvo };
    if (pohja === null) {
      pohja = { projektio: nyt().asetukset.vertailuun(arvo) };
      return;
    }
    if (lopetettu) return;
    if (sama(arvo)) {
      if (ajastin !== null) clearTimeout(ajastin);
      ajastin = null;
      if (!autoJonossa && !kaynnissa) nayta('tallennettu');
      return;
    }
    const syy = este(arvo);
    if (syy !== null) {
      if (ajastin !== null) clearTimeout(ajastin);
      ajastin = null;
      nayta('eiKelpaa', syy);
      return;
    }
    nayta('tallennetaan');
    ajasta();
  }

  function kenttaPoistui() {
    // Kentän oma vahvistus (esim. summasolun blur) renderöityy ja raportoituu ennen tätä.
    setTimeout(() => {
      if (!irrotettu && ajastin !== null) laukaise();
    }, 0);
  }

  function pakotaTallennus(arvo?: T): Promise<boolean> {
    peruAjastimet();
    if (arvo !== undefined) viimeisin = { arvo };
    return jonoon(() => suorita(true));
  }

  function jatkaOdottavaa() {
    const uusin = haeViimeisin();
    if (lopetettu || uusin === null || sama(uusin.arvo)) return;
    if (ajastin === null && !autoJonossa) ajasta();
  }

  function jonossa<R>(toiminto: () => Promise<R>): Promise<R> {
    peruAjastimet();
    const tulos = jonoon(toiminto);
    void tulos.then(jatkaOdottavaa, jatkaOdottavaa);
    return tulos;
  }

  function asetaPohja(arvo: T) {
    pohja = { projektio: nyt().asetukset.vertailuun(arvo) };
    const uusin = haeViimeisin();
    if (uusin === null || sama(uusin.arvo)) {
      peruAjastimet();
      epaonnistui = false;
      nayta('tallennettu');
    }
  }

  function nollaa(arvo: T) {
    viimeisin = { arvo };
    lopetettu = false;
    sukupolvi++;
    kaynnissa = false;
    asetaPohja(arvo);
    nakyma.setTallennettuKerran(false);
  }

  /** Irrotus: yksi yritys odottavalle muutokselle, sen jälkeen ei ajastimia eikä uusintoja. */
  function irrota() {
    peruAjastimet();
    if (lopetettu) {
      irrotettu = true;
      return;
    }
    const sp = sukupolvi;
    void jonoon(async () => {
      if (sp === sukupolvi) await suorita(false, true);
    });
    irrotettu = true; // jonotettu yritys saa silti ajaa (irrotusYritys)
  }

  /** Näkymä liitettiin uudelleen (StrictMode simuloi irrotuksen): peru irrotus. */
  function liita() {
    irrotettu = false;
  }

  function lopeta(): Promise<void> {
    lopetettu = true;
    peruAjastimet();
    return ketju.then(() => undefined);
  }

  function jatka() {
    lopetettu = false;
    const uusin = haeViimeisin();
    if (uusin !== null && !sama(uusin.arvo)) {
      nayta('tallennetaan');
      ajasta();
    }
  }

  function onkoMenossaHukkaan(): boolean {
    const uusin = haeViimeisin();
    if (uusin === null || lopetettu || sama(uusin.arvo)) return false;
    return este(uusin.arvo) !== null || epaonnistui;
  }

  return {
    irrota,
    liita,
    laukaise,
    muuttui,
    kenttaPoistui,
    pakotaTallennus,
    jonossa,
    asetaPohja,
    nollaa,
    lopeta,
    jatka,
    onkoMenossaHukkaan,
  };
}

/**
 * Lomakkeen automaattinen tallennus: noin sekunti viimeisen muutoksen jälkeen, heti kentästä
 * poistuttaessa ja sivulta poistuttaessa (irrotus, pagehide, beforeunload). Yksi tallennus
 * kerrallaan; jonossa odottava lukee viimeisimmän tilan. Epäonnistunut yritetään uudelleen
 * seuraavasta muutoksesta tai 5 s kuluttua. Ei tiedä lomakkeen rakenteesta mitään (T).
 */
export function useAutomaattinenTallennus<T>(
  asetukset: AutotallennusAsetukset<T>,
): AutomaattinenTallennus<T> {
  const ajat = useContext(AutotallennusAjat);
  const nykyiset = useRef<Nykyiset<T>>({ asetukset, ajat });
  nykyiset.current = { asetukset, ajat };
  const [tila, setTila] = useState<TallennusTila>('tallennettu');
  const [syy, setSyy] = useState<string | null>(null);
  const [tallennettuKerran, setTallennettuKerran] = useState(false);
  const [kone] = useState(() =>
    luoKone<T>(() => nykyiset.current, { setTila, setSyy, setTallennettuKerran }),
  );

  useEffect(() => {
    const { laukaise } = kone;
    kone.liita();
    window.addEventListener('pagehide', laukaise);
    window.addEventListener('beforeunload', laukaise);
    return () => {
      window.removeEventListener('pagehide', laukaise);
      window.removeEventListener('beforeunload', laukaise);
      kone.irrota(); // poistuminen: odottava muutos talteen, yksi yritys
    };
  }, [kone]);

  return useMemo(
    () => ({
      tila,
      syy,
      tallennettuKerran,
      muuttui: kone.muuttui,
      kenttaPoistui: kone.kenttaPoistui,
      pakotaTallennus: kone.pakotaTallennus,
      jonossa: kone.jonossa,
      asetaPohja: kone.asetaPohja,
      nollaa: kone.nollaa,
      lopeta: kone.lopeta,
      jatka: kone.jatka,
      onkoMenossaHukkaan: kone.onkoMenossaHukkaan,
    }),
    [tila, syy, tallennettuKerran, kone],
  );
}
