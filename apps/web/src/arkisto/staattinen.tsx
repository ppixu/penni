import { KpClientProvider } from '@/app/KpClientProvider';
import { ArkistoLinkitContext, type ArkistoLinkkiKohde } from '@/components/Linkki';
import type { KpClient } from '@penni/asiakas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

/** Yhden arkistoajon yhteiset palat: sovelluksen oma asiakas, ajon kyselyvälimuisti ja linkkikartta. */
export interface StaattinenYmparisto {
  client: KpClient;
  queryClient: QueryClient;
  /** Sovelluslinkki → arkistotiedoston suhteellinen osoite, tai `null` (ei kohdetta arkistossa). */
  linkit: (k: ArkistoLinkkiKohde) => string | null;
  /** Kauanko yhden sivun valmistumista odotetaan (ms); oletus 30 000. */
  aikaraja?: number;
}

/** Arkistoajon kyselyvälimuisti: ei uusintayrityksiä, data pysyy tuoreena koko ajon. */
export function luoArkistonQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  });
}

const OLETUSAIKARAJA = 30_000;

/** Irrallinen juuri, johon sivu on renderöity kerran synkronisesti arkiston kontekstien kanssa. */
function renderoiJuureen(elementti: ReactElement, ymp: StaattinenYmparisto, nimi: string) {
  const sailio = document.createElement('div');
  // Renderöintivirhe (myös virherajan sieppaama) kaataa sivun: React poistaisi puun tai
  // näyttäisi varasisällön, ja tyhjä tai rikkinäinen sivu päätyisi arkistoon huomaamatta.
  let renderVirhe: { virhe: unknown } | null = null;
  const kirjaa = (virhe: unknown) => {
    renderVirhe ??= { virhe };
  };
  const root = createRoot(sailio, { onUncaughtError: kirjaa, onCaughtError: kirjaa });
  const tarkistaRender = () => {
    if (renderVirhe)
      throw new Error(
        `Arkistosivun "${nimi}" renderöinti epäonnistui: ${viesti(renderVirhe.virhe)}`,
      );
  };
  try {
    flushSync(() => {
      root.render(
        <QueryClientProvider client={ymp.queryClient}>
          <KpClientProvider client={ymp.client}>
            <ArkistoLinkitContext.Provider value={ymp.linkit}>
              {elementti}
            </ArkistoLinkitContext.Provider>
          </KpClientProvider>
        </QueryClientProvider>,
      );
    });
  } catch (virhe) {
    root.unmount();
    throw virhe;
  }
  return { sailio, root, tarkistaRender };
}

/**
 * Renderöi komponentin, joka saa kaiken datansa propseina (ei kyselyitä), yhdellä
 * synkronisella kierroksella ja palauttaa sen HTML:n. Ei ajastimia, joten piilotetun välilehden
 * tai pienennetyn ikkunan ajastinrajoitus ei hidasta sitä. Juuri puretaan aina.
 */
export function renderoiKerran(
  elementti: ReactElement,
  ymp: StaattinenYmparisto,
  nimi: string,
): string {
  const { sailio, root, tarkistaRender } = renderoiJuureen(elementti, ymp, nimi);
  try {
    tarkistaRender();
    return sailio.innerHTML;
  } finally {
    root.unmount();
  }
}

/** Piilotetussa välilehdessä selain harventaa ajastimia rajusti: sitä aikaa ei lasketa. */
function nakyvissa(): boolean {
  return document.visibilityState !== 'hidden';
}

/**
 * Renderöi sovelluksen olemassa olevan komponentin (joka hakee datansa omilla kyselyillään)
 * irralliseen `div`iin ja palauttaa sen HTML:n, kun kyselyt ovat valmiit ja merkintä on pysynyt
 * samana kaksi peräkkäistä kierrosta. Aikarajaan lasketaan vain aika, jonka sivu on ollut
 * näkyvissä: piilossa ajo hidastuu muttei kaadu. Juuri puretaan aina.
 */
export async function renderoiStaattiseksi(
  elementti: ReactElement,
  ymp: StaattinenYmparisto,
  nimi: string,
): Promise<string> {
  const aikaraja = ymp.aikaraja ?? OLETUSAIKARAJA;
  // Ensimmäinen renderöinti heti, jotta tyhjä säiliö ei näytä "valmiilta".
  const { sailio, root, tarkistaRender } = renderoiJuureen(elementti, ymp, nimi);
  try {
    // Näkyvissä kulunut aika: kierros lasketaan vain, jos sivu näkyi sen alussa ja lopussa.
    let kulunut = 0;
    let hetki = Date.now();
    let nakyi = nakyvissa();
    // Edellisen kierroksen merkintä, kun yhtään kyselyä ei ollut käynnissä (muuten null):
    // valmistunut kysely ilmoittaa komponenteille vasta seuraavalla kierroksella.
    let edellinen: string | null = null;
    for (;;) {
      tarkistaRender();
      await new Promise((r) => setTimeout(r, 0));
      tarkistaRender();
      const html = sailio.innerHTML;
      if (ymp.queryClient.isFetching() > 0) {
        edellinen = null;
      } else if (html === edellinen) {
        // Epäonnistunut kysely näkyisi sivulla virhe- tai tyhjänä tilana: ei arkistoon.
        const virheellinen = ymp.queryClient
          .getQueryCache()
          .getAll()
          .find((q) => q.state.status === 'error');
        if (virheellinen)
          throw new Error(
            `Arkistosivun "${nimi}" kysely epäonnistui: ${viesti(virheellinen.state.error)}`,
          );
        return html;
      } else {
        edellinen = html;
      }
      const nyt = Date.now();
      const nakyy = nakyvissa();
      if (nakyi && nakyy) kulunut += nyt - hetki;
      hetki = nyt;
      nakyi = nakyy;
      if (kulunut > aikaraja) {
        throw new Error(`Arkistosivun "${nimi}" renderöinti ei valmistunut`);
      }
    }
  } finally {
    root.unmount();
  }
}

function viesti(virhe: unknown): string {
  return virhe instanceof Error ? virhe.message : String(virhe);
}
