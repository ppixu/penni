import type { SuodatinSilta } from '@penni/tuonti';

/**
 * Katsojakohtainen muisti näkymien suodatinvalinnoille.
 *
 * Selaimessa muisti on localStorage. localStorage voi puuttua tai heittää (yksityinen ikkuna,
 * estetty sivustodata), joten jokainen luku ja kirjoitus on try/catchin sisällä: silloin sivu
 * toimii oletuksilla ja valinta pätee vain tämän sivun ajan. Sama malli kuin liitepaneelin
 * piilotuksessa (liitteet/LiitePaneeli.tsx).
 *
 * Työpöydällä jokainen kirja tarjoillaan uudesta portista (127.0.0.1:<portti>), joten origin ja
 * sen localStorage vaihtuvat joka avauksella. Siellä valinnat ovat sovelluksen asetuksissa
 * (asetukset.json esilatauksen sillan kautta): `alustaMuisti` lataa ne kerran käynnistyksessä
 * välimuistiin, josta luetaan synkronisesti; kirjoitus menee välimuistiin ja sillalle taustalla
 * (epäonnistuminen vain varoittaa — valinta pätee silloin tämän istunnon ajan).
 *
 * Avain on näkymäkohtainen, mutta EI kirjanpitokohtainen: verkkosovelluksella ei ole vakaata
 * kirjan tunnistetta (KpClient vaihdetaan kokonaan, ks. KpClientProvider). Pikavalinnat
 * tallennetaan valintoina (esim. 'q2'), joten ne tarkoittavat aina avatun kirjan kautta.
 * Arvot ovat raakaa JSONia, jonka kutsuja tulkitsee (ne voivat olla vanhoja tai vioittuneita).
 */
const ETULIITE = 'penni.suodattimet.';

export function muistinAvain(nakyma: string): string {
  return `${ETULIITE}${nakyma}`;
}

/** Työpöydän tila: silta ja sen kautta ladatut arvot JSON-merkkijonoina. null = localStorage. */
let tyopoyta: { silta: SuodatinSilta; arvot: Map<string, string> } | null = null;

function sivunSilta(): SuodatinSilta | null {
  const silta = typeof window !== 'undefined' ? window.penni : undefined;
  return typeof silta?.suodattimet === 'function' && typeof silta.tallennaSuodatin === 'function'
    ? (silta as SuodatinSilta)
    : null;
}

/**
 * Ota käyttöön sillan suodatinmuisti (oletuksena sivulle annettu työpöytäsilta) ja lataa sen
 * arvot välimuistiin. Ilman siltaa (selain, tai `null`) muistina on localStorage. Ei heitä.
 */
export async function alustaMuisti(silta: SuodatinSilta | null = sivunSilta()): Promise<void> {
  if (silta === null) {
    tyopoyta = null;
    return;
  }
  const arvot = new Map<string, string>();
  try {
    const kaikki: unknown = await silta.suodattimet();
    if (typeof kaikki === 'object' && kaikki !== null && !Array.isArray(kaikki)) {
      for (const [nakyma, arvo] of Object.entries(kaikki)) {
        const json = JSON.stringify(arvo);
        if (typeof json === 'string') arvot.set(nakyma, json);
      }
    }
  } catch (e) {
    console.warn('Suodatinvalintojen lataus asetuksista epäonnistui; käytetään oletuksia.', e);
  }
  tyopoyta = { silta, arvot };
}

/** Tallennettu raaka-arvo (JSON) tai undefined, jos sitä ei ole tai sitä ei voi lukea. */
export function lueMuisti(nakyma: string): unknown {
  try {
    const raaka = tyopoyta
      ? (tyopoyta.arvot.get(nakyma) ?? null)
      : window.localStorage.getItem(muistinAvain(nakyma));
    return raaka === null ? undefined : (JSON.parse(raaka) as unknown);
  } catch {
    return undefined;
  }
}

export function tallennaMuisti(nakyma: string, arvo: unknown): void {
  let json: string | undefined;
  try {
    json = JSON.stringify(arvo);
  } catch {
    json = undefined;
  }
  if (json === undefined) return; // ei JSONiksi muuttuvaa arvoa ei muisteta
  if (tyopoyta) {
    tyopoyta.arvot.set(nakyma, json);
    const varoita = (e: unknown) =>
      console.warn('Suodatinvalintojen tallennus asetuksiin epäonnistui.', e);
    try {
      tyopoyta.silta.tallennaSuodatin(nakyma, JSON.parse(json) as unknown).catch(varoita);
    } catch (e) {
      varoita(e);
    }
    return;
  }
  try {
    window.localStorage.setItem(muistinAvain(nakyma), json);
  } catch {
    // ei muistia — valinta pätee tämän sivun ajan
  }
}
