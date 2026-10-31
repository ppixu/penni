import { readFileSync, renameSync, writeFileSync } from 'node:fs';

const ENINTAAN = 10;

/** Näkymäavaimen muoto (esim. `tositteet`); Object.prototypen nimet eivät kelpaa. */
const NAKYMA = /^[a-z][a-z0-9._-]{0,63}$/i;
/** Yhden näkymän suodatinvalintojen enimmäiskoko JSONina ja näkymien enimmäismäärä. */
const SUODATIN_ENINTAAN_MERKKEJA = 16_384;
const NAKYMIA_ENINTAAN = 64;

/** Näkymien suodatinvalinnat näkymäavaimittain (sama avain kuin web-sovelluksen lib/muisti.ts). */
export type Suodattimet = Record<string, unknown>;

interface Asetukset {
  viimeisimmat: string[];
  avoin: string | null;
  malliLupa: boolean;
  suodattimet: Suodattimet;
}

function onNakyma(nakyma: unknown): nakyma is string {
  return typeof nakyma === 'string' && NAKYMA.test(nakyma) && !(nakyma in Object.prototype);
}

/** Tallennettu suodattimet-kenttä: vain olio, ja siitä vain kelvolliset näkymäavaimet. */
function lueSuodattimet(arvo: unknown): Suodattimet {
  if (typeof arvo !== 'object' || arvo === null || Array.isArray(arvo)) return {};
  return Object.fromEntries(Object.entries(arvo).filter(([avain]) => onNakyma(avain)));
}

/** Small JSON-file settings store. Plain Node, no Electron import, so it is testable. */
export class Asetusvarasto {
  constructor(private readonly polku: string) {}

  private lue(): Asetukset {
    try {
      const arvo: unknown = JSON.parse(readFileSync(this.polku, 'utf8'));
      if (arvo && typeof arvo === 'object' && Array.isArray((arvo as Asetukset).viimeisimmat)) {
        const rivi = arvo as Asetukset;
        return {
          viimeisimmat: rivi.viimeisimmat.filter((p) => typeof p === 'string'),
          avoin: typeof rivi.avoin === 'string' ? rivi.avoin : null,
          malliLupa: rivi.malliLupa === true,
          suodattimet: lueSuodattimet(rivi.suodattimet),
        };
      }
    } catch {
      // Puuttuva tai rikkinäinen tiedosto: aloitetaan puhtaalta pöydältä.
    }
    return { viimeisimmat: [], avoin: null, malliLupa: false, suodattimet: {} };
  }

  /**
   * Atominen kirjoitus: ensin väliaikainen tiedosto samaan hakemistoon, sitten uudelleennimeäminen
   * sen päälle. Keskeytynyt kirjoitus (kaatuminen, virtakatko) ei siis jätä katkaistua JSONia,
   * joka hävittäisi kaikki asetukset — suodatinvalinnat kirjoittavat tiedostoa usein.
   */
  private kirjoita(asetukset: Asetukset): void {
    const valiaikainen = `${this.polku}.tmp`;
    writeFileSync(valiaikainen, JSON.stringify(asetukset, null, 2), 'utf8');
    renameSync(valiaikainen, this.polku);
  }

  viimeisimmat(): string[] {
    return this.lue().viimeisimmat;
  }

  /** Move `polku` to the front of the recent list, de-duplicated, capped at ten. */
  lisaaViimeisin(polku: string): void {
    const asetukset = this.lue();
    const nykyiset = asetukset.viimeisimmat.filter((p) => p !== polku);
    this.kirjoita({ ...asetukset, viimeisimmat: [polku, ...nykyiset].slice(0, ENINTAAN) });
  }

  /** Drop `polku` from the recent list. The file itself is left alone. */
  poistaViimeisin(polku: string): void {
    const asetukset = this.lue();
    this.kirjoita({
      ...asetukset,
      viimeisimmat: asetukset.viimeisimmat.filter((p) => p !== polku),
    });
  }

  /** The book open right now, or `null` when none has been recorded (e.g. the default book). */
  avoin(): string | null {
    return this.lue().avoin;
  }

  /** Record which book is open right now; pass `null` to clear it. */
  asetaAvoin(polku: string | null): void {
    const asetukset = this.lue();
    this.kirjoita({ ...asetukset, avoin: polku });
  }

  /** Onko käyttäjä sallinut kuitinlukumallin latauksen tälle koneelle. */
  malliLupa(): boolean {
    return this.lue().malliLupa;
  }

  annaMalliLupa(): void {
    this.kirjoita({ ...this.lue(), malliLupa: true });
  }

  /**
   * Näkymien suodatinvalinnat (tositelistan rajaukset ym.). Ne ovat koneen asetuksia, eivät
   * kirjan: kirjan sivu tarjoillaan joka avauksella uudesta portista, joten sivun oma
   * localStorage ei säily. Arvot tulkitaan sivulla kuten ennenkin (ne voivat olla vanhoja).
   */
  suodattimet(): Suodattimet {
    return this.lue().suodattimet;
  }

  /** Tallenna yhden näkymän valinnat. Heittää kelvottomalle avaimelle tai liian suurelle arvolle. */
  tallennaSuodatin(nakyma: string, arvo: unknown): void {
    if (!onNakyma(nakyma)) throw new Error('Kelvoton näkymän nimi suodatinvalinnoille.');
    let json: string | undefined;
    try {
      json = JSON.stringify(arvo);
    } catch {
      json = undefined;
    }
    if (json === undefined || json.length > SUODATIN_ENINTAAN_MERKKEJA)
      throw new Error(`Näkymän ${nakyma} suodatinvalintoja ei voi tallentaa.`);
    const asetukset = this.lue();
    const { suodattimet } = asetukset;
    if (!(nakyma in suodattimet) && Object.keys(suodattimet).length >= NAKYMIA_ENINTAAN)
      throw new Error('Liian monta näkymää suodatinvalinnoissa.');
    this.kirjoita({
      ...asetukset,
      suodattimet: { ...suodattimet, [nakyma]: JSON.parse(json) as unknown },
    });
  }
}
