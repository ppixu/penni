import type { KysySilta, KysyTapahtuma } from '@penni/kysy';
import type { LukuEdistyminen, TasmaysSilta } from '@penni/luku';
import type {
  KirjatSilta,
  MalliSilta,
  SuodatinSilta,
  TuontiEdistyminen,
  TuontiSilta,
} from '@penni/tuonti';
import { contextBridge, ipcRenderer } from 'electron';

/** Pääprosessin app-command (hiiren sivunapit Windowsissa/Linuxissa) → sivun historia. */
interface NavigointiSilta {
  kuunteleNavigointi: (kuuntelija: (suunta: 'takaisin' | 'eteenpain') => void) => () => void;
}

// Vain nämä metodit näkyvät sivulle. ipcRenderer itsessään EI koskaan vuoda ulos.
const silta: TuontiSilta &
  TasmaysSilta &
  KysySilta &
  KirjatSilta &
  MalliSilta &
  SuodatinSilta &
  NavigointiSilta = {
  // Kanava = NAVIGOINTI_KANAVA (navigointi.ts); esilataus ei voi tuoda omia moduuleja.
  kuunteleNavigointi: (kuuntelija) => {
    const k = (_t: unknown, suunta: unknown): void => {
      if (suunta === 'takaisin' || suunta === 'eteenpain') kuuntelija(suunta);
    };
    ipcRenderer.on('navigointi:siirry', k);
    return () => {
      ipcRenderer.off('navigointi:siirry', k);
    };
  },
  valitseJaLue: () => ipcRenderer.invoke('tuonti:valitse'),
  tuo: (polku, edistyminen) => {
    const kuuntelija = (_tapahtuma: unknown, e: TuontiEdistyminen): void => edistyminen(e);
    ipcRenderer.on('tuonti:edistyminen', kuuntelija);
    return ipcRenderer
      .invoke('tuonti:suorita', polku)
      .finally(() => ipcRenderer.off('tuonti:edistyminen', kuuntelija));
  },
  avaaKirja: (polku) => ipcRenderer.invoke('kirja:avaa', polku),
  kirjat: () => ipcRenderer.invoke('kirjat:tiedot'),
  vaihdaKirja: (polku) => ipcRenderer.invoke('kirjat:vaihda', polku),
  valitseKirja: () => ipcRenderer.invoke('kirjat:valitse'),
  poistaViimeisin: (polku) => ipcRenderer.invoke('kirjat:poista', polku),
  valitseTiliote: () => ipcRenderer.invoke('tasmays:valitseTiliote'),
  valitseKuittikansio: () => ipcRenderer.invoke('tasmays:valitseKansio'),
  lueAineisto: (tiliote, kansio, edistyminen) => {
    const kuuntelija = (_t: unknown, e: LukuEdistyminen): void => edistyminen(e);
    ipcRenderer.on('tasmays:edistyminen', kuuntelija);
    return ipcRenderer
      .invoke('tasmays:lueAineisto', tiliote, kansio)
      .finally(() => ipcRenderer.off('tasmays:edistyminen', kuuntelija));
  },
  lueTiedosto: (polku) => ipcRenderer.invoke('tasmays:lueTiedosto', polku),
  kysyTila: () => ipcRenderer.invoke('kysy:tila'),
  kysy: (kysymysId, kysymys, tapahtuma) => {
    // Pääprosessi lähettää kaikki avoinna olevat kyselyt samaan kanavaan — suodatetaan tässä
    // vain tämän kysymysId:n tapahtumat, jotta sivun kuuntelija ei näe muiden kyselyiden dataa.
    const kuuntelija = (_t: unknown, e: KysyTapahtuma & { kysymysId: number }): void => {
      if (e.kysymysId === kysymysId) tapahtuma(e);
    };
    ipcRenderer.on('kysy:tapahtuma', kuuntelija);
    return ipcRenderer
      .invoke('kysy:kysy', kysymysId, kysymys)
      .finally(() => ipcRenderer.off('kysy:tapahtuma', kuuntelija));
  },
  kysyPeruuta: (kysymysId) => ipcRenderer.invoke('kysy:peruuta', kysymysId),
  malliLupa: () => ipcRenderer.invoke('malli:lupa'),
  annaMalliLupa: () => ipcRenderer.invoke('malli:annaLupa'),
  suodattimet: () => ipcRenderer.invoke('suodattimet:lue'),
  tallennaSuodatin: (nakyma, arvo) => ipcRenderer.invoke('suodattimet:tallenna', nakyma, arvo),
};

contextBridge.exposeInMainWorld('penni', silta);
