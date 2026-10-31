import type { KpClient } from '@penni/asiakas';
import { Luonne, type LuonneArvo, type TositeFilter, lataaKartta, onko } from '@penni/engine';
import { hakuMuoto, nimiTekstina } from '@penni/tyokalut';

/**
 * Expected answer for one question. `sentit`/`lukumaara` are FUNCTIONS that compute the correct
 * value from a live `KpClient` at eval time — never a hand-typed number — so the golden set
 * cannot rot when the book or engine changes (design spec §6). `kieltaytyminen` marks a
 * deliberately unanswerable question: the correct model behaviour is a refusal.
 */
export type Odotus =
  | { tyyppi: 'sentit'; arvo: (client: KpClient, pvm: string) => Promise<number> }
  | { tyyppi: 'lukumaara'; arvo: (client: KpClient, pvm: string) => Promise<number> }
  | { tyyppi: 'kieltaytyminen' };

export interface Kysymys {
  id: string;
  kysymys: string;
  odotus: Odotus;
  /** Työkalut joista vähintään yhden kutsumista pidetään oikeana lähestymistapana. */
  tyokaluPerhe?: string[];
}

// --- Odotus-funktioiden apurit: nämä laskevat "oikean" vastauksen suoraan enginestä, samalla
// logiikalla kuin vastaava tyokalu (packages/tyokalut/src/tyokalut/*) käyttäisi, jotta pisteytys
// vertaa mallin vastausta täsmälleen samaan lukuun kuin työkalu olisi tuottanut. ---

/** Tilikartan tilit, joiden luonne on `mask`:n osajoukko (esim. kaikki pankkitilit). */
async function tileillaJoillaLuonne(client: KpClient, mask: LuonneArvo): Promise<number[]> {
  const init = await client.haeInit();
  return lataaKartta(init.tilit)
    .filter((t) => onko(t.luonne, mask))
    .map((t) => t.numero);
}

/** Summa `haeSaldot`:n tuloksesta, rajattuna tileihin joiden luonne on `mask`:n osajoukko. */
async function summaaLuonteella(
  client: KpClient,
  pvm: string,
  mask: LuonneArvo,
  lisaparametrit: { tase?: boolean; tuloslaskelma?: boolean },
): Promise<number> {
  const [numerot, saldot] = await Promise.all([
    tileillaJoillaLuonne(client, mask),
    client.haeSaldot({ pvm, ...lisaparametrit }),
  ]);
  let summa = 0;
  for (const tili of numerot) summa += saldot.get(tili) ?? 0;
  return summa;
}

/**
 * Oma pääoma yhteensä = vastattavaa yhteensä − vieras pääoma yhteensä. Kitsasin tilityyppiluettelo
 * ei sisällä yhtään leaf-tyyppiä, jonka luonne olisi tarkalleen Luonne.OMAPAAOMA (vain sen
 * erikoistumat BE/T, ts. edellisten kausien ja kuluvan kauden tulos, kantavat niitä bittejä) —
 * suora `onko(luonne, OMAPAAOMA)`-summa jättäisi siis esim. osakepääomatilin (tyyppi BY, luonne
 * plain VASTATTAVAA) laskematta. VASTATTAVAA on koko puolen yhteinen kantaluokka (jokainen
 * luokan 2 tili on sen osajoukko) ja VIERASPAAOMA kattaa kaikki velkatyypit kattavasti (VELKA ja
 * sen erikoistumat) — erotus on siis oikea oma pääoma riippumatta yksittäisten tilien tarkasta
 * tyypityksestä.
 */
async function omaPaaomaSentteina(client: KpClient, pvm: string): Promise<number> {
  const [vastattavaa, vierasPaaoma] = await Promise.all([
    summaaLuonteella(client, pvm, Luonne.VASTATTAVAA, { tase: true }),
    summaaLuonteella(client, pvm, Luonne.VIERASPAAOMA, { tase: true }),
  ]);
  return vastattavaa - vierasPaaoma;
}

/** Kaikkien `haeSaldot`-tuloksen tilien summa (ei luonnerajausta). */
async function summaaSaldot(
  client: KpClient,
  pvm: string,
  lisaparametrit: { tase?: boolean; tuloslaskelma?: boolean },
): Promise<number> {
  const saldot = await client.haeSaldot({ pvm, ...lisaparametrit });
  let summa = 0;
  for (const arvo of saldot.values()) summa += arvo;
  return summa;
}

/** Kuluvan tilikauden alkupäivä alv-laskelman oletukselle — mirrors alvTilanne.ts:n logiikkaa. */
async function oletusAlvAlkupvm(client: KpClient, pvm: string): Promise<string> {
  const kaudet = await client.haeTilikaudet();
  const nykyinen = kaudet.find((k) => k.alkaa <= pvm && pvm <= k.loppuu);
  const varhaisin = [...kaudet].sort((a, b) => (a.alkaa < b.alkaa ? -1 : 1))[0];
  return (nykyinen ?? varhaisin)?.alkaa ?? pvm;
}

/** Mirrors tilit_haku-tyokalun hakulogiikkaa: nimen osuma tai tilinumeron alku, otsikot pois. */
async function tilitHakuLukumaara(client: KpClient, haku: string): Promise<number> {
  const init = await client.haeInit();
  const h = hakuMuoto(haku);
  return init.tilit
    .map((t) => ({
      numero: Number(t.numero),
      nimi: nimiTekstina(t.nimi),
      tyyppi: String(t.tyyppi ?? ''),
    }))
    .filter((t) => Number.isFinite(t.numero) && !t.tyyppi.startsWith('H'))
    .filter((t) => h === '' || hakuMuoto(t.nimi).includes(h) || String(t.numero).startsWith(h))
    .length;
}

/** Mirrors tositteet_haku-tyokalun teksti/sarja-suodatusta listaaTositteet-tuloksen päällä. */
async function tositeLukumaara(
  client: KpClient,
  filter: TositeFilter,
  lisasuodatin: { teksti?: string; sarja?: string } = {},
): Promise<number> {
  const tositteet = await client.listaaTositteet(filter);
  const teksti = lisasuodatin.teksti?.toLowerCase();
  return tositteet
    .filter((t) => {
      if (teksti === undefined) return true;
      const haku = `${t.otsikko ?? ''} ${t.viite ?? ''}`.toLowerCase();
      return haku.includes(teksti);
    })
    .filter((t) => lisasuodatin.sarja === undefined || t.sarja === lisasuodatin.sarja).length;
}

/** Kaikkien pankkitilien (Luonne.PANKKITILI) vientirivien yhteismäärä. */
async function pankkiVientejaLukumaara(client: KpClient): Promise<number> {
  const numerot = await tileillaJoillaLuonne(client, Luonne.PANKKITILI);
  let summa = 0;
  for (const tili of numerot) {
    const viennit = await client.listaaViennit({ tili });
    summa += viennit.length;
  }
  return summa;
}

/** Mirrors tilikaudet-tyokalun lukitusmääritelmää: TilitPaatetty ulottuu kauden loppuun asti. */
async function lukitutTilikaudet(client: KpClient): Promise<number> {
  const [kaudet, asetukset] = await Promise.all([client.haeTilikaudet(), client.haeAsetukset()]);
  const paatetty = asetukset.TilitPaatetty ?? '';
  return kaudet.filter((k) => paatetty !== '' && k.loppuu <= paatetty).length;
}

/** Päiviä kuluvan tilikauden alusta annettuun päivään; 0 jos päivä ei osu millekään tilikaudelle. */
async function paiviaTilikaudenAlusta(client: KpClient, pvm: string): Promise<number> {
  const kaudet = await client.haeTilikaudet();
  const nykyinen = kaudet.find((k) => k.alkaa <= pvm && pvm <= k.loppuu);
  if (!nykyinen) return 0;
  const alku = new Date(`${nykyinen.alkaa}T00:00:00.000Z`).getTime();
  const nyt = new Date(`${pvm}T00:00:00.000Z`).getTime();
  return Math.round((nyt - alku) / 86_400_000);
}

/** Viimeisimmän (suurimman tunnisteen) kirjanpitoon kirjatun tositteen vientien debet-summa. */
async function viimeisimmanTositteenDebetSumma(client: KpClient): Promise<number> {
  const tositteet = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
  if (tositteet.length === 0) return 0;
  const viimeisin = tositteet.reduce((max, t) => (t.tunniste > max.tunniste ? t : max));
  return viimeisin.viennit.reduce((s, v) => s + v.debet, 0);
}

/** 30–50 suomenkielistä kysymystä; ≥5 vastaamattomia (odotus kieltäytyminen). */
export const KYSYMYKSET: Kysymys[] = [
  // --- Saldot ---
  {
    id: 'saldot-pankkitili',
    kysymys: 'Paljonko pankkitilillä on rahaa juuri nyt?',
    odotus: {
      tyyppi: 'sentit',
      arvo: (c, pvm) => summaaLuonteella(c, pvm, Luonne.PANKKITILI, { tase: true }),
    },
    tyokaluPerhe: ['saldot'],
  },
  {
    id: 'saldot-kateiskassa',
    kysymys: 'Paljonko käteiskassassa on rahaa?',
    odotus: {
      tyyppi: 'sentit',
      arvo: (c, pvm) => summaaLuonteella(c, pvm, Luonne.KATEINEN, { tase: true }),
    },
    tyokaluPerhe: ['saldot'],
  },
  {
    id: 'saldot-myyntisaamiset',
    kysymys: 'Paljonko avoimia myyntisaamisia on tällä hetkellä?',
    odotus: {
      tyyppi: 'sentit',
      arvo: (c, pvm) => summaaLuonteella(c, pvm, Luonne.MYYNTISAATAVA, { tase: true }),
    },
    tyokaluPerhe: ['saldot'],
  },
  {
    id: 'saldot-ostovelat',
    kysymys: 'Paljonko maksamattomia ostovelkoja on tällä hetkellä?',
    odotus: {
      tyyppi: 'sentit',
      arvo: (c, pvm) => summaaLuonteella(c, pvm, Luonne.OSTOVELKA, { tase: true }),
    },
    tyokaluPerhe: ['saldot'],
  },
  {
    id: 'saldot-oma-paaoma',
    kysymys: 'Paljonko yrityksen omaa pääomaa on tällä hetkellä?',
    odotus: { tyyppi: 'sentit', arvo: (c, pvm) => omaPaaomaSentteina(c, pvm) },
    // raportti on hyväksytty reitti: taseen vastattavaa-erittely sisältää oman pääoman.
    tyokaluPerhe: ['saldot', 'raportti'],
  },
  {
    id: 'saldot-vieras-paaoma',
    kysymys: 'Paljonko yrityksellä on vierasta pääomaa (velkoja) yhteensä juuri nyt?',
    odotus: {
      tyyppi: 'sentit',
      arvo: (c, pvm) => summaaLuonteella(c, pvm, Luonne.VIERASPAAOMA, { tase: true }),
    },
    // raportti on hyväksytty reitti: taseen vastattavaa-erittely sisältää vieraan pääoman.
    tyokaluPerhe: ['saldot', 'raportti'],
  },
  {
    id: 'saldot-alvvelka-tase',
    kysymys: 'Paljonko arvonlisäverovelkaa on kirjanpidossa taseessa juuri nyt?',
    odotus: {
      tyyppi: 'sentit',
      arvo: (c, pvm) => summaaLuonteella(c, pvm, Luonne.ALVVELKA, { tase: true }),
    },
    tyokaluPerhe: ['saldot'],
  },

  // --- Tulos/tase-rivit ---
  {
    id: 'raportti-tilikauden-tulos',
    kysymys: 'Mikä on kuluvan tilikauden voitto tai tappio tähän mennessä?',
    odotus: { tyyppi: 'sentit', arvo: (c, pvm) => summaaSaldot(c, pvm, { tuloslaskelma: true }) },
    tyokaluPerhe: ['raportti', 'saldot'],
  },
  {
    id: 'raportti-liikevaihto',
    kysymys: 'Paljonko liikevaihtoa on kertynyt kuluvalta tilikaudelta?',
    odotus: {
      tyyppi: 'sentit',
      arvo: (c, pvm) => summaaLuonteella(c, pvm, Luonne.LVTULO, { tuloslaskelma: true }),
    },
    tyokaluPerhe: ['raportti', 'saldot'],
  },
  {
    id: 'raportti-vastaavaa-yhteensa',
    kysymys: 'Paljonko taseen vastaavaa-puoli on yhteensä juuri nyt?',
    odotus: {
      tyyppi: 'sentit',
      arvo: (c, pvm) => summaaLuonteella(c, pvm, Luonne.VASTAAVAA, { tase: true }),
    },
    tyokaluPerhe: ['raportti', 'saldot'],
  },
  {
    id: 'raportti-vastattavaa-yhteensa',
    kysymys: 'Paljonko taseen vastattavaa-puoli on yhteensä juuri nyt?',
    odotus: {
      tyyppi: 'sentit',
      arvo: (c, pvm) => summaaLuonteella(c, pvm, Luonne.VASTATTAVAA, { tase: true }),
    },
    tyokaluPerhe: ['raportti', 'saldot'],
  },
  {
    id: 'raportti-kulut-yhteensa',
    kysymys: 'Paljonko kuluja on kirjattu kuluvalta tilikaudelta yhteensä?',
    odotus: {
      tyyppi: 'sentit',
      arvo: (c, pvm) => summaaLuonteella(c, pvm, Luonne.MENO, { tuloslaskelma: true }),
    },
    tyokaluPerhe: ['raportti', 'saldot'],
  },

  // --- Alv ---
  {
    id: 'alv-velka-tilikausi',
    kysymys: 'Paljonko arvonlisäverovelkaa on kertynyt kuluvalta tilikaudelta?',
    odotus: {
      tyyppi: 'sentit',
      arvo: async (c, pvm) => {
        const alkupvm = await oletusAlvAlkupvm(c, pvm);
        const tulos = await c.haeAlvLaskelma({ alkupvm, loppupvm: pvm });
        return tulos.maksettava;
      },
    },
    tyokaluPerhe: ['alv_tilanne'],
  },
  {
    id: 'alv-velka-helmikuu-2026',
    kysymys: 'Paljonko arvonlisäveroa kertyi helmikuulta 2026?',
    odotus: {
      tyyppi: 'sentit',
      arvo: async (c) => {
        const tulos = await c.haeAlvLaskelma({ alkupvm: '2026-02-01', loppupvm: '2026-02-28' });
        return tulos.maksettava;
      },
    },
    tyokaluPerhe: ['alv_tilanne'],
  },
  {
    id: 'alv-kanta-25-5-maara',
    kysymys: 'Monessako viennissä on käytetty 25,5 %:n arvonlisäverokantaa kuluvalta tilikaudelta?',
    odotus: {
      tyyppi: 'lukumaara',
      arvo: async (c, pvm) => {
        const alkupvm = await oletusAlvAlkupvm(c, pvm);
        const viennit = await c.listaaViennit({ alkupvm, loppupvm: pvm });
        return viennit.filter((v) => Math.abs(v.alvProsentti - 25.5) < 0.001).length;
      },
    },
    tyokaluPerhe: ['viennit_haku'],
  },

  // --- Tositteet ---
  {
    id: 'tositteet-kirjatut-lkm',
    kysymys: 'Kuinka monta tositetta on kirjattu lopullisesti kirjanpitoon?',
    odotus: { tyyppi: 'lukumaara', arvo: (c) => tositeLukumaara(c, { bucket: 'kirjanpidossa' }) },
    tyokaluPerhe: ['tositteet_haku'],
  },
  {
    id: 'tositteet-luonnokset-lkm',
    kysymys: 'Kuinka monta luonnostositetta on tällä hetkellä käsittelemättä?',
    odotus: { tyyppi: 'lukumaara', arvo: (c) => tositeLukumaara(c, { bucket: 'luonnos' }) },
    tyokaluPerhe: ['tositteet_haku'],
  },
  {
    id: 'tositteet-haku-konsultointi',
    kysymys: "Kuinka monta tositetta löytyy hakusanalla 'konsultointi'?",
    odotus: {
      tyyppi: 'lukumaara',
      arvo: (c) => tositeLukumaara(c, { bucket: 'kirjanpidossa' }, { teksti: 'konsultointi' }),
    },
    tyokaluPerhe: ['tositteet_haku'],
  },
  {
    id: 'tositteet-tammikuu-2026-lkm',
    kysymys: 'Kuinka monta tositetta on kirjattu tammikuussa 2026?',
    odotus: {
      tyyppi: 'lukumaara',
      arvo: (c) =>
        tositeLukumaara(c, {
          bucket: 'kirjanpidossa',
          alkupvm: '2026-01-01',
          loppupvm: '2026-01-31',
        }),
    },
    tyokaluPerhe: ['tositteet_haku'],
  },
  {
    id: 'tositteet-sarja-a-lkm',
    kysymys: "Kuinka monta tositetta on tositesarjassa 'A'?",
    odotus: {
      tyyppi: 'lukumaara',
      arvo: (c) => tositeLukumaara(c, { bucket: 'kirjanpidossa' }, { sarja: 'A' }),
    },
    tyokaluPerhe: ['tositteet_haku'],
  },
  {
    id: 'tositteet-poistetut-lkm',
    kysymys: 'Kuinka monta tositetta on poistettu kirjanpidosta?',
    odotus: { tyyppi: 'lukumaara', arvo: (c) => tositeLukumaara(c, { bucket: 'poistetut' }) },
    tyokaluPerhe: ['tositteet_haku'],
  },

  // --- Viennit ---
  {
    id: 'viennit-pankkitili-lkm',
    kysymys: 'Kuinka monta vientiriviä pankkitilillä on yhteensä?',
    odotus: { tyyppi: 'lukumaara', arvo: (c) => pankkiVientejaLukumaara(c) },
    tyokaluPerhe: ['viennit_haku'],
  },
  {
    id: 'viennit-helmikuu-2026-lkm',
    kysymys: 'Kuinka monta vientiä on kirjattu helmikuussa 2026?',
    odotus: {
      tyyppi: 'lukumaara',
      arvo: async (c) => {
        const viennit = await c.listaaViennit({ alkupvm: '2026-02-01', loppupvm: '2026-02-28' });
        return viennit.length;
      },
    },
    tyokaluPerhe: ['viennit_haku'],
  },

  // --- Tilikaudet ---
  {
    id: 'tilikaudet-lkm',
    kysymys: 'Kuinka monta tilikautta kirjanpitoon on tallennettu?',
    odotus: {
      tyyppi: 'lukumaara',
      arvo: async (c) => (await c.haeTilikaudet()).length,
    },
    tyokaluPerhe: ['tilikaudet'],
  },
  {
    id: 'tilikaudet-lukitut-lkm',
    kysymys: 'Kuinka monta tilikautta on lukittu (tilinpäätös vahvistettu)?',
    odotus: { tyyppi: 'lukumaara', arvo: (c) => lukitutTilikaudet(c) },
    tyokaluPerhe: ['tilikaudet'],
  },

  // --- Tilit haku ---
  {
    id: 'tilit-haku-pankki-lkm',
    kysymys: "Kuinka monta tiliä tilikartasta löytyy hakusanalla 'pankki'?",
    odotus: { tyyppi: 'lukumaara', arvo: (c) => tilitHakuLukumaara(c, 'pankki') },
    tyokaluPerhe: ['tilit_haku'],
  },
  {
    id: 'tilit-haku-19-lkm',
    kysymys: "Kuinka monta tiliä tilikartasta alkaa numerosarjalla '19'?",
    odotus: { tyyppi: 'lukumaara', arvo: (c) => tilitHakuLukumaara(c, '19') },
    tyokaluPerhe: ['tilit_haku'],
  },

  // --- Muut ---
  {
    id: 'perustiedot-paivia-tilikauden-alusta',
    kysymys: 'Kuinka monta päivää kuluvan tilikauden alusta on kulunut tähän päivään mennessä?',
    odotus: { tyyppi: 'lukumaara', arvo: (c, pvm) => paiviaTilikaudenAlusta(c, pvm) },
    tyokaluPerhe: ['perustiedot', 'tilikaudet'],
  },
  {
    id: 'tosite-viimeisin-debet-summa',
    kysymys:
      'Paljonko on viimeisimmän kirjanpitoon kirjatun tositteen vientien debet-summa yhteensä?',
    odotus: { tyyppi: 'sentit', arvo: (c) => viimeisimmanTositteenDebetSumma(c) },
    tyokaluPerhe: ['tositteet_haku', 'tosite'],
  },

  // --- Vastaamattomat: Tier-0-malli ei sisällä palkanlaskentaa, pörssikursseja, hallintoa
  // eikä ulkopuolisia tahoja, joten oikea vastaus on kieltäytyminen. ---
  {
    id: 'kieltaytyminen-toimitusjohtajan-palkka',
    kysymys: 'Mikä on toimitusjohtajan kuukausipalkka?',
    odotus: { tyyppi: 'kieltaytyminen' },
  },
  {
    id: 'kieltaytyminen-tyontekijoiden-lkm',
    kysymys: 'Kuinka monta työntekijää yrityksellä on palkkalistoilla?',
    odotus: { tyyppi: 'kieltaytyminen' },
  },
  {
    id: 'kieltaytyminen-osakekurssi',
    kysymys: 'Mikä on yrityksen osakekurssi pörssissä?',
    odotus: { tyyppi: 'kieltaytyminen' },
  },
  {
    id: 'kieltaytyminen-hallituksen-kokous',
    kysymys: 'Milloin yrityksen seuraava hallituksen kokous pidetään?',
    odotus: { tyyppi: 'kieltaytyminen' },
  },
  {
    id: 'kieltaytyminen-tilintarkastaja',
    kysymys: 'Kuka on yrityksen tilintarkastaja?',
    odotus: { tyyppi: 'kieltaytyminen' },
  },
  {
    id: 'kieltaytyminen-luottoluokitus',
    kysymys: 'Mikä on yrityksen luottoluokitus pankissa?',
    odotus: { tyyppi: 'kieltaytyminen' },
  },
];
