import { type Kuitti, OCR_KEHOTE, onkoTekstia, poimiKuittiTekstista } from '@penni/engine';

export type LukuVaihe =
  | { vaihe: 'tarvitseeLuvan' }
  | { vaihe: 'ladataanMallia'; osuus: number }
  | { vaihe: 'luetaan' };

export type EiLuettuSyy = 'eiTuettu' | 'eiGpu' | 'eiLupaa' | 'tyhja' | 'virhe' | 'peruttu';

export type LukuTulos = { ok: true; kuitti: Kuitti } | { ok: false; syy: EiLuettuSyy };

/** Näkömallin kapea rajapinta: Paattelija + ympäristön latausasetukset (useKuitinLuku sitoo). */
export interface Lukumalli {
  saatavilla(): Promise<boolean>;
  lataa(edistyi: (osuus: number) => void): Promise<void>;
  tulkitse(kuva: Blob, kehote: string): Promise<string>;
}

export interface LukuRiippuvuudet {
  pdfTeksti: (pdf: Blob) => Promise<string>;
  rasteroiPdf: (pdf: Blob) => Promise<Blob>;
  malli: () => Lukumalli;
  /** true = saa ladata/käyttää mallin; kysyy tarvittaessa käyttäjältä. */
  lupa: () => Promise<boolean>;
  vaihe: (v: LukuVaihe) => void;
  signal: AbortSignal;
}

/** Kuvat, jotka selaimen createImageBitmap purkaa (HEIC ei kuulu joukkoon Chromiumissa). */
export const KUVATYYPIT: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

/** Litteraatti tai tekstikerros kuitiksi; ei yhtään tunnistettua kenttää = tyhjä. */
function poimi(teksti: string): LukuTulos {
  const t = poimiKuittiTekstista(teksti);
  if (!t.ok) return { ok: false, syy: 'tyhja' };
  const k = t.kuitti;
  if (k.myyja === undefined && k.pvm === undefined && k.bruttoSumma === undefined)
    return { ok: false, syy: 'tyhja' };
  return { ok: true, kuitti: k };
}

/**
 * Lukee kuitin laitteella: digitaalisen PDF:n tekstikerros suoraan (ei mallia), muuten kuva
 * (tai rasteroitu PDF:n ensimmäinen sivu) litteroidaan näkömallilla ja kentät poimitaan
 * deterministisesti. Mallia ei ladata ilman lupaa. Ei koskaan heitä: virheet ovat syitä.
 */
export async function lueKuitti(
  data: Uint8Array,
  tyyppi: string,
  r: LukuRiippuvuudet,
): Promise<LukuTulos> {
  const peruttu = (): LukuTulos | null => (r.signal.aborted ? { ok: false, syy: 'peruttu' } : null);
  // Kopio: pdf.js ja Blob eivät saa irrottaa kutsujan puskuria (liite tallennetaan myöhemmin).
  const tiedosto = new Blob([new Uint8Array(data)], { type: tyyppi });
  try {
    let kuva: Blob;
    if (tyyppi === 'application/pdf') {
      const teksti = await r.pdfTeksti(tiedosto);
      if (peruttu()) return { ok: false, syy: 'peruttu' };
      if (onkoTekstia(teksti)) return poimi(teksti);
      kuva = await r.rasteroiPdf(tiedosto);
    } else if (KUVATYYPIT.has(tyyppi)) {
      kuva = tiedosto;
    } else {
      return { ok: false, syy: 'eiTuettu' };
    }
    const malli = r.malli();
    if (!(await malli.saatavilla())) return { ok: false, syy: 'eiGpu' };
    if (peruttu()) return { ok: false, syy: 'peruttu' };
    if (!(await r.lupa())) return { ok: false, syy: 'eiLupaa' };
    if (peruttu()) return { ok: false, syy: 'peruttu' };
    r.vaihe({ vaihe: 'ladataanMallia', osuus: 0 });
    await malli.lataa((osuus) => {
      if (!r.signal.aborted) r.vaihe({ vaihe: 'ladataanMallia', osuus });
    });
    if (peruttu()) return { ok: false, syy: 'peruttu' };
    r.vaihe({ vaihe: 'luetaan' });
    const litteraatti = await malli.tulkitse(kuva, OCR_KEHOTE);
    return peruttu() ?? poimi(litteraatti);
  } catch (virhe) {
    const peruttuTulos = peruttu();
    if (peruttuTulos) return peruttuTulos;
    // Vain virheen viesti: kuitin sisältö ei kuulu lokiin.
    console.warn(
      `Kuitin luku epäonnistui: ${virhe instanceof Error ? virhe.message : String(virhe)}`,
    );
    return { ok: false, syy: 'virhe' };
  }
}
