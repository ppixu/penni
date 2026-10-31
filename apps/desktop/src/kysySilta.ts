import { InProcessClient } from '@penni/asiakas';
import { KysyVirhe, OLETUS_ASETUKSET, kysy, luoOllamaKutsu, varmistaKysyOllama } from '@penni/kysy';
import type { KysyTapahtuma, KysyTila } from '@penni/kysy';
import { ipcMain } from 'electron';
import { type IpcLahettaja, tarkistaLahettaja } from './ipcRajaus.js';
import type { KirjaIstunto } from './kirjaIstunto.js';

/** Käynnissä olevat kyselyt kysymysId:n mukaan — jaettu kaikkien `kysyKasittelijat`-kutsujen ja `peruutaKaikkiKysyt`:n kesken, koska Electronissa `rekisteroiKysy` kutsutaan vain kerran. */
const aktiiviset = new Map<number, AbortController>();

type LahetaTapahtuma = (
  kanava: 'kysy:tapahtuma',
  payload: KysyTapahtuma & { kysymysId: number },
) => void;

function eiTyhja(arvo: string | undefined): arvo is string {
  return arvo !== undefined && arvo.trim() !== '';
}

/** `asetukset.KysyMalli` jos asetettu ja ei-tyhjä, muuten Kysyn oletusmalli. */
async function malliAsetuksista(istunto: KirjaIstunto): Promise<string> {
  const asetukset = await new InProcessClient(istunto.storage).haeAsetukset();
  const malli = asetukset.KysyMalli;
  return eiTyhja(malli) ? malli : OLETUS_ASETUKSET.malli;
}

export function kysyKasittelijat(annaIstunto: () => KirjaIstunto | null) {
  async function kysyTila(): Promise<KysyTila> {
    const istunto = annaIstunto();
    if (!istunto) return { ok: false, viesti: 'Avaa ensin kirjanpito.' };
    const malli = await malliAsetuksista(istunto);
    try {
      await varmistaKysyOllama({ ...OLETUS_ASETUKSET, malli });
      return { ok: true, malli };
    } catch (e) {
      if (e instanceof KysyVirhe) {
        return {
          ok: false,
          viesti: e.message,
          ...(e.korjaus !== undefined ? { korjaus: e.korjaus } : {}),
        };
      }
      throw e;
    }
  }

  async function kysyKysy(
    kysymysId: number,
    kysymys: string,
    laheta: LahetaTapahtuma,
  ): Promise<void> {
    // Varaus (koon tarkistus + AbortControllerin lisäys) täytyy tapahtua synkronisesti, ennen
    // ensimmäistäkään awaitia — muuten kaksi peräkkäistä kutsua (ilman awaitia niiden välissä)
    // ehtisivät molemmat ohittaa tarkistuksen ennen kuin kumpikaan on varannut paikkaansa.
    if (aktiiviset.size > 0) throw new Error('kysely on jo käynnissä');
    const controller = new AbortController();
    aktiiviset.set(kysymysId, controller);
    try {
      const istunto = annaIstunto();
      if (!istunto) throw new Error('Avaa ensin kirjanpito.');
      const malli = await malliAsetuksista(istunto);
      const client = new InProcessClient(istunto.storage, undefined, 'kysy');
      for await (const e of kysy(client, {
        kysymys,
        asetukset: { malli },
        kutsuFn: luoOllamaKutsu(),
        keskeyta: controller.signal,
      })) {
        laheta('kysy:tapahtuma', { ...e, kysymysId });
      }
    } finally {
      aktiiviset.delete(kysymysId);
    }
  }

  async function kysyPeruuta(kysymysId: number): Promise<void> {
    aktiiviset.get(kysymysId)?.abort();
  }

  return { kysyTila, kysyKysy, kysyPeruuta };
}

/**
 * Keskeyttää kaikki käynnissä olevat kyselyt ilman että niitä poistetaan `aktiiviset`-kartasta —
 * silmukka itse huomaa peruutuksen, päättyy normaalisti ja siivoaa oman paikkansa. Kutsuttava
 * ennen jokaista kirjan vaihtoa: käynnissä oleva kysely ei saa koskaan koskea suljettuun
 * SQLite-kahvaan.
 */
export function peruutaKaikkiKysyt(): void {
  for (const controller of aktiiviset.values()) controller.abort();
}

/**
 * Rekisteröi Kysy-kirjanpitäjän IPC-kanavat. Kutsutaan kerran käynnistyksessä. Kutsut
 * hyväksytään vain avoimen kirjan omalta paikalliselta palvelimelta.
 */
export function rekisteroiKysy(annaIstunto: () => KirjaIstunto | null): void {
  const kasittelijat = kysyKasittelijat(annaIstunto);
  const tarkista = (tapahtuma: IpcLahettaja): void =>
    tarkistaLahettaja(tapahtuma, annaIstunto()?.osoite);
  ipcMain.handle('kysy:tila', (tapahtuma) => {
    tarkista(tapahtuma);
    return kasittelijat.kysyTila();
  });
  ipcMain.handle('kysy:kysy', (tapahtuma, kysymysId: number, kysymys: string) => {
    tarkista(tapahtuma);
    return kasittelijat.kysyKysy(kysymysId, kysymys, (kanava, payload) =>
      tapahtuma.sender.send(kanava, payload),
    );
  });
  ipcMain.handle('kysy:peruuta', (tapahtuma, kysymysId: number) => {
    tarkista(tapahtuma);
    return kasittelijat.kysyPeruuta(kysymysId);
  });
}
