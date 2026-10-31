import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import packager from '@electron/packager';

const juuri = join(dirname(fileURLToPath(import.meta.url)), '..');
const tyotilanJuuri = join(juuri, '..', '..');
const webDist = join(juuri, '..', 'web', 'dist');

// Siirtotila (VITE_TILA) leivotaan web-buildiin build-ajassa eikä ajossa. Jos apps/web/dist olisi
// rakennettu erillisellä, käsin ajetulla komennolla (tai pelkällä `pnpm build`, joka EI aseta
// VITE_TILA:a), paketoitu sovellus näyttäisi täysin toimivalta mutta renderöijä puhuisi paikallista
// OPFS-tilaa eikä koskaan tämän työpöytäsovelluksen avaamaa kirjaa — täysin äänetön virhe. Siksi
// web-app rakennetaan TÄSSÄ, oikealla tilalla, sen sijaan että luotettaisiin erilliseen komentoon.
execFileSync('pnpm', ['--filter', '@penni/web', 'build'], {
  cwd: tyotilanJuuri,
  stdio: 'inherit',
  env: { ...process.env, VITE_TILA: 'tyopoyta' },
});

// apps/desktop -lähteeseen kopioitu web-buildi otetaan mukaan `pnpm deploy`-valmisteluun alla,
// joten kopio pitää tehdä ennen sitä.
const kohde = join(juuri, 'resources', 'web');
rmSync(kohde, { recursive: true, force: true });
mkdirSync(dirname(kohde), { recursive: true });
cpSync(webDist, kohde, { recursive: true });

// pnpm pitää transitiiviset riippuvuudet työtilan juuren node_modules/.pnpm-varastossa ja
// linkittää ne symlinkeinä pakettien väliin. @electron/packager kopioi (ja aiemmin derefsymlink-
// kasi) vain `dir`-hakemiston, joten pelkkä apps/desktop ei riitä: jonkin riippuvuuden OMAT
// riippuvuudet (esim. @ts-rest/fastify:n tarvitsema @ts-rest/core) eivät päädy mukaan eivätkä
// resolvoidu ajon aikana — sovellus kaatuu käynnistyessään ERR_MODULE_NOT_FOUND-virheeseen.
// `pnpm deploy --prod --config.node-linker=hoisted` tuottaa sen sijaan itsenäisen, tasaisen ja
// symlinkittömän node_modules-puun, jossa jokainen riippuvuus on oikeasti fyysisesti läsnä.
// Pakataan TÄTÄ valmistelualuetta, ei apps/desktop-hakemistoa suoraan.
const valmisteluAlue = join(tmpdir(), 'penni-desktop-paketointi');
rmSync(valmisteluAlue, { recursive: true, force: true }); // puhdas valmistelu joka kerta
execFileSync(
  'pnpm',
  [
    '--filter',
    '@penni/desktop',
    'deploy',
    '--prod',
    '--config.node-linker=hoisted',
    valmisteluAlue,
  ],
  { cwd: tyotilanJuuri, stdio: 'inherit' },
);
// Edellisen paketoinnin out/ on saattanut tulla valmistelun mukana kopioiduksi — se olisi pelkkää
// painolastia uudessa paketissa.
rmSync(join(valmisteluAlue, 'out'), { recursive: true, force: true });

// `pnpm deployn` tiedostonvalintasäännöt eivät ole dokumentoituja eivätkä taatusti pysyviä: tänään
// resources/web tulee mukaan valmistelualueelle siitä huolimatta, että se on .gitignoressa, mutta
// jos tuleva pnpm-versio (tai asetusmuutos) alkaisikin noudattaa .gitignorea deployssa, web-buildi
// katoaisi paketista täysin äänettömästi — ainoa oire olisi tyhjä ikkuna käynnistyksessä (ks.
// task-7-brief.md). Varmistetaan siis eksplisiittisesti, että web-buildi todella selvisi
// valmistelualueelle, ennen kuin paketointia jatketaan.
const webIndeksi = join(valmisteluAlue, 'resources', 'web', 'index.html');
if (!existsSync(webIndeksi)) {
  throw new Error(
    `Web-buildia ei löytynyt valmistelualueelta odotetusta polusta: ${webIndeksi}. \`pnpm deploy\` ei tuonut apps/desktop/resources/web-hakemistoa mukaan valmistelualueelle.`,
  );
}

// Esilataussilta (dist/esilataus.cjs) käännetään erillisellä tsc-ajolla (tsconfig.preload.json),
// joka on helppo unohtaa lisätä `build`-skriptiin tai joka voi hiljaa jäädä ajamatta. Ilman sitä
// preload ei lataudu lainkaan (SyntaxError renderöijässä) eikä window.penni synny — täysin
// äänetön virhe, joka näkyisi vasta käynnistetyssä sovelluksessa. Varmistetaan siis eksplisiittisesti,
// samaan tapaan kuin web-buildin osalta yllä.
const esilatausPolku = join(valmisteluAlue, 'dist', 'esilataus.cjs');
if (!existsSync(esilatausPolku)) {
  throw new Error(
    `Esilataussiltaa ei löytynyt valmistelualueelta odotetusta polusta: ${esilatausPolku}. \`tsc -p tsconfig.preload.json\` ei tuottanut CommonJS-esilatausta ennen paketointia — tarkista että package.json:in build-skripti ajaa sen.`,
  );
}

// --prod pudottaa electron-devDependencyn valmistelualueelta, joten @electron/packager ei voi enää
// päätellä Electron-versiota sieltä. Luetaan versio sen sijaan suoraan työtilan omasta, oikeasti
// asennetusta electron-paketista.
const { version: electronVersion } = JSON.parse(
  readFileSync(join(juuri, 'node_modules', 'electron', 'package.json'), 'utf8'),
);

const prebuildInstallCli = createRequire(import.meta.url).resolve('prebuild-install/bin.js');

// Hoisted-tilassakaan pnpm ei välttämättä litistä better-sqlite3:a yhteen paikkaan: se voi
// päätyä useamman valmistelualueella olevan työtilapaketin (storage-sqlite, tuonti,
// server→storage-sqlite, …) omaan node_modules-alipuuhun. Siksi jokainen esiintymä pitää etsiä
// ja korvata erikseen.
function etsiBetterSqlite3Hakemistot(polku, loydetyt = []) {
  let merkinnat;
  try {
    merkinnat = readdirSync(polku, { withFileTypes: true });
  } catch {
    return loydetyt;
  }
  // Vain suoraan jonkin node_modules-hakemiston lapsena oleva "better-sqlite3" kelpaa — muuten
  // myös @types/better-sqlite3 (pelkät tyypit, ei natiivimoduulia) tulkittaisiin virheellisesti.
  const onNodeModules = basename(polku) === 'node_modules';
  for (const merkinta of merkinnat) {
    if (!merkinta.isDirectory()) continue;
    const lapsi = join(polku, merkinta.name);
    if (
      onNodeModules &&
      merkinta.name === 'better-sqlite3' &&
      existsSync(join(lapsi, 'package.json'))
    ) {
      loydetyt.push(lapsi);
      continue; // paketin sisällä ei voi olla toista better-sqlite3-pakettia
    }
    etsiBetterSqlite3Hakemistot(lapsi, loydetyt);
  }
  return loydetyt;
}

const [sovellus] = await packager({
  dir: valmisteluAlue,
  out: join(juuri, 'out'),
  name: 'Penni',
  platform: 'darwin',
  overwrite: true,
  electronVersion,
  icon: join(juuri, 'assets', 'penni.icns'),
  extraResource: [join(juuri, 'assets', 'penni-icon.png')],
  // `pnpm deploy --prod` on jo karsinut devDependencyt pois valmistelualueen node_modulesista,
  // mutta package.json listaa ne yhä. @electron/packagerin oma karsinta (flora-colossus) yrittäisi
  // silti kävellä koko riippuvuuspuun devDependencyt mukaan lukien ja kaatuisi, kun niitä ei löydy
  // asennettuna. Karsittavaa ei ole enää mitään, joten packagerin oma karsinta ohitetaan.
  prune: false,
  appBundleId: 'fi.penni.desktop',
  // .penni-tiedostot Pennin omiksi dokumenteiksi: Finderin tuplaklikkaus ja pudotus Dockin
  // kuvakkeelle avaavat kirjan (paa.ts:n open-file-käsittelijä).
  extendInfo: {
    CFBundleDocumentTypes: [
      {
        CFBundleTypeName: 'Penni-kirjanpito',
        CFBundleTypeExtensions: ['penni'],
        CFBundleTypeRole: 'Editor',
        LSHandlerRank: 'Owner',
      },
    ],
  },
  // better-sqlite3 tarvitsee Electronin ABI:lle käännetyn binäärin. `pnpm deploy` on jo ajanut
  // asennusskriptit, joten valmistelualueella on tässä vaiheessa Node-ABI:n mukainen esikäännetty
  // binääri — se korvataan (ei käännetä paikallisesti) Electronin ABI:lle sopivalla, valmiiksi
  // käännetyllä binäärillä (prebuild-install) jokaiseen kopioituun esiintymään vasta pakatussa
  // puussa. Jaettu pnpm-varasto pysyy näin koskemattomana Node-ABI:ssa koko ajan.
  afterCopy: [
    // HUOM: @electron/packager kääri tämän hookin util.promisifylla, joka päättyy VAIN kun
    // callback kutsutaan — se ei koskaan odota paluuarvoa. Funktio ei siis saa olla async (silloin
    // se AINA palauttaisi Promisen, ja util.promisify jonkin funktion päälle, joka jo palauttaa
    // Promisen, on itsessään virhe — Node varoittaakin tästä DEP0174:llä). Pahempaa: jos tästä
    // heitettäisiin (throw) async-funktiona, virhe päätyisi hylätyn Promisen sisään, jota kukaan ei
    // koskaan odota — se jäisi roikkumaan käsittelemättömänä hylkäyksenä ja koko skripti kaatuisi
    // vasta Noden unhandled-rejection-mekanismin kautta, ilman että packager itse koskaan
    // raportoisi epäonnistumista. Siksi funktio on synkroninen ja jokainen virhepolku kutsuu
    // callback(virhe):tä throwin sijaan.
    (buildPath, electronVersion, platform, arch, callback) => {
      const moduulit = etsiBetterSqlite3Hakemistot(join(buildPath, 'node_modules'));
      if (moduulit.length === 0) {
        callback(new Error(`better-sqlite3-moduulia ei löytynyt kopioidusta puusta: ${buildPath}`));
        return;
      }
      for (const moduulipolku of moduulit) {
        try {
          execFileSync(
            process.execPath,
            [
              prebuildInstallCli,
              '--runtime',
              'electron',
              '--target',
              electronVersion,
              '--arch',
              arch,
              '--platform',
              'darwin',
              '--tag-prefix',
              'v',
            ],
            { cwd: moduulipolku, stdio: 'inherit' },
          );
        } catch (virhe) {
          callback(
            new Error(
              `Ei löytynyt valmiiksi käännettyä better-sqlite3-binääriä (${moduulipolku}) yhdistelmälle Electron ${electronVersion} / ${arch}. Tarkista verkkoyhteys ja GitHub-julkaisujen saatavuus (katso alkuperäinen virhe: error.cause). Tämä skripti EI käännä lähdekoodista automaattisesti eikä yritä sitä — kääntäminen on täysin erillinen, manuaalinen toimenpide ("pnpm --filter @penni/desktop run rebuild", vaatii pkgutilille rekisteröidyn Xcode Command Line Tools -asennuksen) eikä korjaa tätä pakkausta.`,
              { cause: virhe },
            ),
          );
          return;
        }
      }
      callback();
    },
  ],
});

console.log(`Valmis: ${sovellus}`);
