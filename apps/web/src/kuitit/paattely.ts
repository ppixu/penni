import type { Lukumalli } from './lueKuitti.js';
import { MAKS_UUDET_TOKENIT } from './malli.js';
import { TEKSTI_MAKS_UUDET_TOKENIT } from './teksti-malli.js';

/**
 * Kulkevatko lukumallin haut jonkin isännän kautta (työpöydällä `penni-malli://hf/`) ja saako
 * selain välimuistittaa painot (työpöydällä ei: origin vaihtuu).
 */
export interface MallinLatausAsetukset {
  kautta?: string;
  selainValimuisti: boolean;
}

/** Näkömallin ja tekstimallin ajorajapinta (pääsäie). */
export interface Paattelija {
  /** Onko WebGPU käytettävissä tässä selaimessa. */
  saatavilla(): Promise<boolean>;
  /** Lataa näkömallin painot; edistyi saa arvon 0..1. */
  lataa(edistyi: (osuus: number) => void, asetukset?: MallinLatausAsetukset): Promise<void>;
  /** Aja päättely: kuva + kehote → mallin raakateksti. */
  tulkitse(kuva: Blob, kehote: string): Promise<string>;
  /** Lataa tekstimallin painot (PDF→teksti-polku); edistyi saa arvon 0..1. */
  lataaTeksti(edistyi: (osuus: number) => void): Promise<void>;
  /** Aja tekstipäättely: dokumenttiteksti → mallin raakateksti (kehote rakennetaan työntekijässä). */
  tulkitseTeksti(teksti: string): Promise<string>;
  /** Vapauta työntekijä. */
  sulje(): void;
}

interface Odottava {
  resolve: (arvo: unknown) => void;
  reject: (virhe: Error) => void;
}

/** Työntekijäpohjainen päättelijä (storage-opfs-RPC-kuvio). */
export function luoPaattelija(suljettu?: () => void): Paattelija {
  const worker = new Worker(new URL('./paattely-worker.js', import.meta.url), {
    type: 'module',
  });
  const odottavat = new Map<number, Odottava>();
  let seq = 0;
  let edistyiKuuntelija: ((osuus: number) => void) | undefined;
  let pysyvaVirhe: Error | undefined;

  worker.addEventListener('message', (e: MessageEvent) => {
    const v = e.data as {
      id?: number;
      ok?: boolean;
      arvo?: unknown;
      virhe?: string;
      tyyppi?: string;
      osuus?: number;
    };
    if (v.tyyppi === 'edistyi' && typeof v.osuus === 'number') {
      edistyiKuuntelija?.(v.osuus);
      return;
    }
    if (typeof v.id !== 'number') return;
    const o = odottavat.get(v.id);
    if (!o) return;
    odottavat.delete(v.id);
    if (v.ok) o.resolve(v.arvo);
    else o.reject(new Error(v.virhe ?? 'Päättely epäonnistui.'));
  });

  function hylkaaKaikki(virhe: Error) {
    if (pysyvaVirhe) return;
    pysyvaVirhe = virhe;
    worker.terminate();
    for (const o of odottavat.values()) o.reject(virhe);
    odottavat.clear();
    edistyiKuuntelija = undefined;
    suljettu?.();
  }
  worker.addEventListener('error', () =>
    hylkaaKaikki(new Error('Päättelytyöntekijän lataus epäonnistui.')),
  );
  worker.addEventListener('messageerror', () =>
    hylkaaKaikki(new Error('Päättelytyöntekijän viesti oli virheellinen.')),
  );

  function kutsu<T>(metodi: string, args: readonly unknown[] = []): Promise<T> {
    if (pysyvaVirhe) return Promise.reject(pysyvaVirhe);
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      odottavat.set(id, {
        resolve: resolve as (arvo: unknown) => void,
        reject,
      });
      worker.postMessage({ id, metodi, args });
    });
  }

  return {
    saatavilla: () => kutsu<boolean>('saatavilla'),
    lataa: (edistyi, asetukset = { selainValimuisti: true }) => {
      edistyiKuuntelija = edistyi;
      return kutsu<void>('lataa', [asetukset]);
    },
    tulkitse: (kuva, kehote) => kutsu<string>('tulkitse', [kuva, kehote, MAKS_UUDET_TOKENIT]),
    lataaTeksti: (edistyi) => {
      edistyiKuuntelija = edistyi;
      return kutsu<void>('lataaTeksti');
    },
    tulkitseTeksti: (teksti) =>
      kutsu<string>('tulkitseTeksti', [teksti, TEKSTI_MAKS_UUDET_TOKENIT]),
    sulje: () => hylkaaKaikki(new Error('Päättelytyöntekijä suljettiin.')),
  };
}

let jaettu: Paattelija | undefined;

/** Sovelluksen yhteinen päättelijä: malli ladataan kerran istunnossa. */
export function jaettuPaattelija(): Paattelija {
  jaettu ??= luoPaattelija(() => {
    jaettu = undefined;
  });
  return jaettu;
}

/**
 * Yhden kuitin päättelyn yläraja. Jumittunut generointi pitäisi muuten GPU-jonon varattuna koko
 * istunnon. Latausta ei rajata: ensimmäinen 0,85 Gt:n lataus voi kestää kauan.
 */
export const TULKINNAN_AIKARAJA_MS = 120_000;

/**
 * Päättelijä kuitinlukijan malliksi. Aikakatkaistu tai kaatunut tulkinta sulkee työntekijän:
 * GPU-laitteen menetyksen jälkeen ladattu malli on käyttökelvoton, ja jaettuPaattelija() luo
 * seuraavalle kuitille uuden työntekijän (malli latautuu välimuistista).
 */
export function lukumalliPaattelijasta(p: Paattelija, asetukset: MallinLatausAsetukset): Lukumalli {
  return {
    saatavilla: () => p.saatavilla(),
    lataa: (edistyi) => p.lataa(edistyi, asetukset),
    tulkitse: (kuva, kehote) =>
      new Promise<string>((resolve, reject) => {
        const ajastin = setTimeout(() => {
          p.sulje();
          reject(new Error('Kuitin luku ylitti aikarajan.'));
        }, TULKINNAN_AIKARAJA_MS);
        p.tulkitse(kuva, kehote).then(
          (teksti) => {
            clearTimeout(ajastin);
            resolve(teksti);
          },
          (virhe: unknown) => {
            clearTimeout(ajastin);
            p.sulje();
            reject(virhe);
          },
        );
      }),
  };
}
