import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { MALLI_SKEEMA } from '@penni/engine';
import { net, BrowserWindow, app, dialog, protocol, shell } from 'electron';
import { Asetusvarasto } from './asetusvarasto.js';
import { asetaSovelluksenKieli } from './kieli.js';
import { IstuntoHallinta, asetaWebJuuri } from './kirjaIstunto.js';
import { rekisteroiKirjat } from './kirjatSilta.js';
import { peruutaKaikkiKysyt, rekisteroiKysy } from './kysySilta.js';
import { kasitteleMallipyynto } from './malliProtokolla.js';
import { rekisteroiMalli } from './malliSilta.js';
import { NAVIGOINTI_KANAVA, appKomentoKuuntelija, navigointiPaatos } from './navigointi.js';
import { rekisteroiSuodattimet } from './suodatinSilta.js';
import { rekisteroiTasmays } from './tasmaysSilta.js';
import { rekisteroiTuonti } from './tuontiSilta.js';
import { rakennaValikko } from './valikko.js';
import {
  kasinOtettavanNimi,
  otaPaivittainenVarmuuskopio,
  tanaan,
  varmuuskopioKansio,
} from './varmuuskopiot.js';

// Suomi ennen 'ready'-tapahtumaa: päivämääräkentät muodossa p.k.vvvv eikä mm/dd/yyyy.
asetaSovelluksenKieli(app);

// Lukumallin painot pääprosessin levyvälimuistin kautta: kirjan origin (127.0.0.1:<portti>)
// vaihtuu joka avauksella, joten selaimen välimuisti latisi 0,85 Gt:n mallin joka kerta uudelleen.
// Pitää rekisteröidä ennen 'ready'-tapahtumaa.
protocol.registerSchemesAsPrivileged([
  {
    scheme: MALLI_SKEEMA,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const hallinta = new IstuntoHallinta();
let ikkuna: BrowserWindow | null = null;
let asetukset: Asetusvarasto;
// macOS lähettää open-file-tapahtuman (Finderin tuplaklikkaus, pudotus Dockin kuvakkeelle) jo
// ennen kuin kaynnista() on ehtinyt alustaa asetukset, kun sovellus käynnistetään tiedostolla.
// Talletetaan polku tähän ja avataan se käynnistyksessä viimeksi avoinna olleen kirjan sijaan.
let avattavaKaynnistyksessa: string | null = null;
let kaynnistetty = false;
// Asetetaan, kun käyttäjä valitsee will-prevent-unload-dialogissa "Jää sivulle": seuraava
// loadURL-hylkäys on silloin käyttäjän oma peruutus eikä virhe.
let poistuminenPeruttu = false;

/** Käyttäjä jäi tallentamattomien muutosten lomakkeelle; siirtymä peruttiin tarkoituksella. */
class SiirtyminenPeruttu extends Error {}

function oletusKirja(): string {
  return join(app.getPath('userData'), 'oletus.penni');
}

/** Ikkunan otsikko: avoimen kirjan tiedostonimi, jotta testikopio ei sekoitu oikeaan kirjaan. */
function ikkunanOtsikko(): string {
  const polku = hallinta.nykyinen()?.polku;
  if (!polku || polku === oletusKirja()) return 'Oletuskirjanpito — Penni';
  return `${basename(polku)} — Penni`;
}

function paivitaIkkuna(): void {
  if (!ikkuna) return;
  ikkuna.setTitle(ikkunanOtsikko());
  const polku = hallinta.nykyinen()?.polku;
  // macOS: otsikkopalkin tiedostokuvake, josta ⌘-klikkaus näyttää kirjan sijainnin.
  if (process.platform === 'darwin') {
    ikkuna.setRepresentedFilename(polku && polku !== oletusKirja() ? polku : '');
  }
}

function kuvakePolku(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'penni-icon.png')
    : join(import.meta.dirname, '..', 'assets', 'penni-icon.png');
}

/** Human-readable text for any thrown value — a non-Error throw must not read "undefined". */
function virheviesti(virhe: unknown): string {
  return virhe instanceof Error ? virhe.message : String(virhe);
}

/**
 * Run an async menu/startup action and report a failure as a native dialog instead of letting
 * it vanish as an unhandled rejection. Used for every fire-and-forget entry point (menu clicks);
 * IPC handlers already propagate their own errors back to the renderer and don't need this.
 */
function suoritaJaIlmoita(nimi: string, tehtava: () => Promise<void>): void {
  tehtava().catch((virhe: unknown) => {
    if (virhe instanceof SiirtyminenPeruttu) return;
    dialog.showErrorBox(nimi, virheviesti(virhe));
  });
}

/**
 * Lataa ikkunaan uuden osoitteen. Jos sivulla on tallentamattomia muutoksia ja käyttäjä jää
 * sivulle, Electron peruu navigoinnin ja loadURL hylkää — se muutetaan SiirtyminenPeruttu-
 * virheeksi, jotta kutsuja voi erottaa peruutuksen oikeasta virheestä.
 */
async function lataa(url: string): Promise<void> {
  if (!ikkuna) return;
  poistuminenPeruttu = false;
  try {
    await ikkuna.loadURL(url);
  } catch (virhe) {
    if (poistuminenPeruttu) throw new SiirtyminenPeruttu('Käyttäjä jäi sivulle.');
    throw virhe;
  } finally {
    poistuminenPeruttu = false;
  }
}

async function avaaKirja(polku: string): Promise<void> {
  // Käynnissä oleva kysely ei saa koskaan koskea suljettuun SQLite-kahvaan.
  peruutaKaikkiKysyt();
  let istunto: Awaited<ReturnType<typeof hallinta.vaihda>>;
  try {
    // Vanha kirja suljetaan vasta, kun uusi sivu on ladattu: jos käyttäjä jää tallentamattomien
    // muutosten lomakkeelle, vanha istunto jää voimaan eikä ikkuna jää suljetun kirjan varaan.
    istunto = await hallinta.vaihda(polku, (uusi) => lataa(uusi.osoite));
  } catch (virhe) {
    if (virhe instanceof SiirtyminenPeruttu) return;
    throw virhe;
  }
  // Sisäistä oletuskirjaa (jonka kaynnista() avaa joka käynnistyksellä) ei merkitä
  // "viimeisimmäksi" — muuten se pinnaisi kärjessä jokaisella käynnistyksellä.
  if (polku !== oletusKirja()) {
    asetukset.lisaaViimeisin(polku);
    // Dockin ja Tiedosto-valikon käyttöjärjestelmätason "viimeisimmät"-lista.
    app.addRecentDocument(polku);
  }
  // Oletuskirja tallennetaan tarkoituksella nulliksi, ei poluksi — muuten seuraava käynnistys
  // yrittäisi avata sen oletuskirjana uudelleen eikä osaisi erottaa sitä oikeasta kirjasta.
  asetukset.asetaAvoin(polku === oletusKirja() ? null : polku);
  paivitaValikko();
  paivitaIkkuna();
  if (polku !== oletusKirja()) {
    try {
      otaPaivittainenVarmuuskopio(polku, (kohde) => istunto.storage.varmuuskopioi(kohde));
    } catch (virhe) {
      dialog.showErrorBox(
        'Automaattinen varmuuskopio epäonnistui',
        `${polku}\n\n${virheviesti(virhe)}\n\nKirjanpito on silti auki; ota kopio käsin (Tiedosto → Varmuuskopioi…).`,
      );
    }
  }
}

async function varmuuskopioi(): Promise<void> {
  const istunto = hallinta.nykyinen();
  if (!istunto) return;
  const valinta = await dialog.showSaveDialog({
    title: 'Varmuuskopioi kirjanpito',
    defaultPath: kasinOtettavanNimi(istunto.polku, tanaan()),
    filters: [{ name: 'Penni-kirjanpito', extensions: ['penni'] }],
  });
  if (valinta.canceled || !valinta.filePath) return;
  // varmuuskopioi() kieltäytyy ylikirjoittamasta — myös silloin, kun käyttäjä vahvisti
  // dialogissa korvaamisen. Näin kopio ei voi koskaan päätyä avoimen kirjan päälle.
  istunto.storage.varmuuskopioi(valinta.filePath);
  await dialog.showMessageBox({
    type: 'info',
    message: 'Varmuuskopio tallennettu',
    detail: valinta.filePath,
  });
}

async function naytaVarmuuskopiot(): Promise<void> {
  const polku = hallinta.nykyinen()?.polku;
  if (!polku) return;
  const kansio = varmuuskopioKansio(polku);
  const virhe = await shell.openPath(existsSync(kansio) ? kansio : join(kansio, '..'));
  if (virhe) throw new Error(virhe);
}

function rekisteroiKasittelijat(): void {
  // Kaikki kanavat hyväksyvät kutsuja vain avoimen kirjan omalta paikalliselta palvelimelta.
  const annaOsoite = () => hallinta.nykyinen()?.osoite;
  rekisteroiTuonti({ annaOsoite, avaaKirja });
  rekisteroiTasmays(annaOsoite);
  rekisteroiKysy(() => hallinta.nykyinen());
  rekisteroiKirjat({
    annaOsoite,
    nykyinen: () => asetukset.avoin(),
    viimeisimmat: () => asetukset.viimeisimmat(),
    avaaKirja,
    valitseJaAvaa,
    poistaViimeisin: (polku) => {
      asetukset.poistaViimeisin(polku);
      paivitaValikko();
    },
  });
  // asetukset alustetaan vasta kaynnista():ssa, siksi getter.
  rekisteroiMalli({ annaOsoite, asetukset: () => asetukset });
  rekisteroiSuodattimet({ annaOsoite, asetukset: () => asetukset });
}

function paivitaValikko(): void {
  rakennaValikko({
    uusiKirja: () => suoritaJaIlmoita('Uuden kirjanpidon luonti epäonnistui', uusiKirja),
    avaaKirja: () => suoritaJaIlmoita('Kirjanpidon avaaminen epäonnistui', valitseJaAvaa),
    avaaViimeisin: (polku) =>
      suoritaJaIlmoita('Kirjanpidon avaaminen epäonnistui', () => avaaKirja(polku)),
    tuoKitsas: () =>
      suoritaJaIlmoita('Kitsas-tuonnin avaaminen epäonnistui', async () => {
        const istunto = hallinta.nykyinen();
        if (istunto) await lataa(`${istunto.osoite}/tuonti`);
      }),
    varmuuskopioi: () => suoritaJaIlmoita('Varmuuskopiointi epäonnistui', varmuuskopioi),
    naytaVarmuuskopiot: () =>
      suoritaJaIlmoita('Varmuuskopiokansion avaaminen epäonnistui', naytaVarmuuskopiot),
    viimeisimmat: () => asetukset.viimeisimmat(),
  });
}

/**
 * Reopen whatever book was open at last shutdown, falling back to the default book when that
 * is not possible. Shown to the user as at most one native error dialog — never both a "file
 * missing" and a "failed to open" box for the same startup. Whichever branch runs, opening the
 * default book afterwards writes `avoin = null` via `avaaKirja`, so the next startup no longer
 * tries the stale path.
 */
async function avaaAlkukirja(): Promise<void> {
  const edellinen = asetukset.avoin();
  if (edellinen) {
    if (!existsSync(edellinen)) {
      dialog.showErrorBox(
        'Viimeksi avoinna ollutta kirjanpitoa ei löydy',
        `${edellinen}\n\nAvataan oletuskirjanpito.`,
      );
    } else {
      try {
        await avaaKirja(edellinen);
        return;
      } catch (virhe) {
        dialog.showErrorBox(
          'Viimeksi avoinna ollut kirjanpito ei auennut',
          `${edellinen}\n\n${virheviesti(virhe)}\n\nAvataan oletuskirjanpito.`,
        );
      }
    }
  }
  await avaaKirja(oletusKirja());
}

async function uusiKirja(): Promise<void> {
  const valinta = await dialog.showSaveDialog({
    title: 'Uusi kirjanpito',
    defaultPath: 'kirjanpito.penni',
    filters: [{ name: 'Penni-kirjanpito', extensions: ['penni'] }],
  });
  if (valinta.canceled || !valinta.filePath) return;
  await avaaKirja(valinta.filePath);
}

async function valitseJaAvaa(): Promise<void> {
  const valinta = await dialog.showOpenDialog({
    title: 'Avaa kirjanpito',
    filters: [{ name: 'Penni-kirjanpito', extensions: ['penni'] }],
    properties: ['openFile'],
  });
  const polku = valinta.filePaths[0];
  if (valinta.canceled || !polku) return;
  await avaaKirja(polku);
}

function luoIkkuna(): BrowserWindow {
  ikkuna = new BrowserWindow({
    width: 1280,
    height: 860,
    icon: kuvakePolku(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, 'esilataus.cjs'),
    },
  });
  // Jos esilataus ei syystä tai toisesta lataudu (väärä moduulimuoto, puuttuva tiedosto…),
  // window.penni jää olemattomaksi täysin äänettömästi — tämä on ainoa paikka joka sen huomaisi.
  ikkuna.webContents.on('preload-error', (_tapahtuma, polku, virhe) => {
    dialog.showErrorBox(
      'Esilataussillan lataus epäonnistui',
      `Polku: ${polku}\n\n${virhe.message}`,
    );
  });
  // window.open (liitteen esikatselu tositteet.$id.tsx:ssä) saisi oletuksena Electronilta uuden
  // BrowserWindowin, joka PERII isäntäikkunan webPreferences-asetukset — myös esilatauksen.
  // Kitsas-tuonnin liitteet ovat käyttäjän tuomaa, mielivaltaista sisältöä (myös HTML kelpaa
  // MIME-tyypiksi), joten peritty esilataus antaisi liitteelle window.penni-rajapinnan ja saman
  // origin -pääsyn kirjan API:in. Kielletään oletuksena; sallitaan vain blob:-esikatselu, ilman
  // esilatausta tai node-integraatiota — sama karanteeni kuin tavallisella selaimella olisi.
  ikkuna.webContents.setWindowOpenHandler((tiedot) => {
    if (!tiedot.url.startsWith('blob:')) return { action: 'deny' };
    return {
      action: 'allow',
      // Ei preload-avainta lainkaan: overrideBrowserWindowOptions EI peri isäntäikkunan
      // webPreferences-asetuksia, joten avaimen puuttuminen riittää — lapsi-ikkuna ei saa
      // mitään esilatausta, aivan kuin tavallinen new BrowserWindow() ilman preloadia.
      overrideBrowserWindowOptions: {
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
    };
  });
  // Ilman tätä `ikkuna` jäisi osoittamaan tuhottuun BrowserWindowiin: macOS ei lopeta sovellusta
  // ikkunan sulkemisesta (ks. window-all-closed), joten jokainen valikkotoiminto kutsuisi
  // loadURL:ia kuolleeseen olioon.
  // Web-sivun oma <title> ei saa korvata kirjan nimeä otsikkopalkissa.
  ikkuna.on('page-title-updated', (tapahtuma) => {
    tapahtuma.preventDefault();
    paivitaIkkuna();
  });
  // Sivun beforeunload-esto (tallentamattomat muutokset lomakkeella) peruisi Electronissa
  // sulkemisen, kirjan vaihdon ja lopetuksen täysin äänettömästi. Kysytään käyttäjältä.
  const tamaIkkuna = ikkuna;
  // Ikkuna näyttää epäluotettavia liitteitä (PDF-esikatselu iframessa), joten ylätason navigointi
  // pois kirjan istunnon originista estetään: muualla sivu saisi yhä esilatauksen. Ulkoiset
  // http(s)-linkit avataan käyttäjän luvalla järjestelmän selaimessa. Ohjelmallinen loadURL
  // (kirjan avaus ja vaihto) ei laukaise will-navigate-tapahtumaa.
  ikkuna.webContents.on('will-navigate', (tapahtuma, url) => {
    const paatos = navigointiPaatos(url, hallinta.nykyinen()?.osoite);
    if (paatos === 'salli') return;
    tapahtuma.preventDefault();
    if (paatos !== 'ulkoinen') return;
    const valinta = dialog.showMessageBoxSync(tamaIkkuna, {
      type: 'question',
      buttons: ['Avaa selaimessa', 'Peruuta'],
      defaultId: 1,
      cancelId: 1,
      message: 'Avataanko linkki selaimessa?',
      detail: url,
    });
    if (valinta === 0) void shell.openExternal(url);
  });
  ikkuna.webContents.on('will-prevent-unload', (tapahtuma) => {
    const valinta = dialog.showMessageBoxSync(tamaIkkuna, {
      type: 'warning',
      buttons: ['Poistu tallentamatta', 'Jää sivulle'],
      defaultId: 1,
      cancelId: 1,
      message: 'Tallentamattomia muutoksia',
      detail: 'Lomakkeella on muutoksia, joita ei ole tallennettu. Ne menetetään, jos poistut.',
    });
    if (valinta === 0)
      tapahtuma.preventDefault(); // ohita esto: poistu
    else poistuminenPeruttu = true;
  });
  // Windows/Linux: hiiren sivunapit ja selainnäppäimet → sivun reititinhistoria (ks. navigointi.ts).
  // macOS:llä app-commandia ei ole; siellä sivu käsittelee sivunapit ja pyyhkäisyn itse.
  ikkuna.on(
    'app-command',
    appKomentoKuuntelija((suunta) => tamaIkkuna.webContents.send(NAVIGOINTI_KANAVA, suunta)),
  );
  ikkuna.on('closed', () => {
    ikkuna = null;
  });
  return ikkuna;
}

async function kaynnista(): Promise<void> {
  rekisteroiKasittelijat();
  // Pakatussa sovelluksessa web-buildi on resources/web; kehityksessä apps/web/dist.
  asetaWebJuuri(
    app.isPackaged
      ? join(process.resourcesPath, 'app', 'resources', 'web')
      : join(import.meta.dirname, '..', '..', 'web', 'dist'),
  );
  asetukset = new Asetusvarasto(join(app.getPath('userData'), 'asetukset.json'));
  const mallit = join(app.getPath('userData'), 'mallit');
  protocol.handle(
    MALLI_SKEEMA,
    async (pyynto) =>
      (
        await kasitteleMallipyynto(
          pyynto.url,
          pyynto.method,
          {
            juuri: mallit,
            hae: (u, i) => net.fetch(u, i),
            // Lupa tarkistetaan pääprosessissa: sivu ei voi käynnistää latausta ilman sitä.
            lupa: () => asetukset.malliLupa(),
          },
          pyynto.headers.get('range'),
        )
      ).vastaus,
  );
  app.setName('Penni');
  if (process.platform === 'darwin') app.dock.setIcon(kuvakePolku());
  luoIkkuna();
  // Samassa synkronisessa lohkossa kuin avattavaKaynnistyksessa-luku: tästä eteenpäin open-file
  // avaa kirjan suoraan, eikä yksikään polku jää lukematta.
  kaynnistetty = true;
  if (avattavaKaynnistyksessa) {
    const polku = avattavaKaynnistyksessa;
    avattavaKaynnistyksessa = null;
    try {
      await avaaKirja(polku);
      return;
    } catch (virhe) {
      dialog.showErrorBox('Kirjanpidon avaaminen epäonnistui', `${polku}\n\n${virheviesti(virhe)}`);
    }
  }
  await avaaAlkukirja();
}

app.on('open-file', (tapahtuma, polku) => {
  tapahtuma.preventDefault();
  if (!kaynnistetty) {
    avattavaKaynnistyksessa = polku;
    return;
  }
  suoritaJaIlmoita('Kirjanpidon avaaminen epäonnistui', async () => {
    if (!ikkuna) luoIkkuna();
    await avaaKirja(polku);
  });
});

void app
  .whenReady()
  .then(kaynnista)
  .catch((virhe: unknown) => {
    dialog.showErrorBox('Penni ei käynnistynyt', virheviesti(virhe));
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// macOS pitää sovelluksen käynnissä ilman ikkunoita, joten Dockista tai ⌘Tabilla palaaminen on
// ainoa tapa saada käyttöliittymä takaisin. Avataan ikkuna uudelleen nykyiseen istuntoon; jos
// istuntoa ei jostain syystä ole, palataan oletuskirjaan.
app.on('activate', () => {
  if (ikkuna) return;
  const osoite = hallinta.nykyinen()?.osoite;
  const ikkunaUudelleen = luoIkkuna();
  suoritaJaIlmoita('Ikkunan avaaminen epäonnistui', async () => {
    if (osoite) {
      await lataa(osoite);
      paivitaIkkuna();
    } else await avaaKirja(oletusKirja());
  });
});

// will-quit eikä before-quit: jos ikkuna peruu sulkemisensa (käyttäjä jää tallentamattomien
// muutosten lomakkeelle), lopetus perutaan eikä will-quit tule — istunto ei saa sulkeutua silloin.
app.on('will-quit', () => {
  void hallinta.suljeKaikki();
});

export { avaaKirja, hallinta };
