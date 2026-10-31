import { AlvLaskelmaDokumentti } from '@/alv/AlvLaskelmaDokumentti';
import { type AlvKausi, parsiIlmoitusOtsikko } from '@/alv/alvKaudet';
import { tositeTyyppiLabel } from '@/lib/tosite';
import { tositeTunniste } from '@/raportit/kirjaRivit';
import { RAPORTIT, kaavaAvain } from '@/raportit/raporttiValikko';
import { TilinpaatosDokumentti } from '@/tilinpaatos/TilinpaatosDokumentti';
import type { KpClient } from '@penni/asiakas';
import {
  type IsoDate,
  type TilinpaatosMuoto,
  TositeTyyppi,
  lataaKartta,
  onkoAlvVelvollinen,
} from '@penni/engine';
import { muotoilePvm } from '@penni/euro';
import { type EtusivunTiedot, etusivuHtml, varmenneHtml } from './ArkistoEtusivu';
import { type ArkistoLiite, ArkistoTositeSivu } from './ArkistoTositeSivu';
import { ARKISTO_CSS, kokoaSovelluksenCss } from './arkistoCss';
import { escapeHtml, kausiTunnus, liiteTiedosto, tositeTiedosto, turvallinenNimi } from './polut';
import { htmlSivu } from './sivupohja';
import {
  type StaattinenYmparisto,
  luoArkistonQueryClient,
  renderoiKerran,
  renderoiStaattiseksi,
} from './staattinen';
import { laskeSha, sha256Lista } from './tarkiste';
import { type ZipTiedosto, pakkaa } from './zip';

export interface ArkistoTulos {
  tiedostonimi: string;
  zip: Uint8Array;
  /** `arkisto.sha256`-tiedoston SHA-256, pieni heksa. */
  juuriTiiviste: string;
  tositteita: number;
  liitteita: number;
  /** Arkistointihetki (ISO-aikaleima), sama kuin manifestin `luotu` ja etusivun päiväys. */
  luotu: string;
}

/** Arkistotiedosto ennen zipiä: polku arkiston juuresta ja MIME-tyyppi manifestia varten. */
interface Tiedosto extends ZipTiedosto {
  tyyppi: string;
}

/** Raporttiavain → tiedostonimi `raportit/`-kansiossa (Kitsas: tyyppi ilman erikoismerkkejä, arkistoija.cpp:512). */
const RAPORTTITIEDOSTO: Record<string, string> = {
  tulos: 'tuloslaskelma',
  'tase-erittely': 'taseerittely',
};
/** Kuukausiraportit jäävät pois: tilinpäätöksen tase ja tuloslaskelma kattavat koko kauden. */
const EI_ARKISTOON = new Set(['tase-kk', 'tulos-kk']);
/** Raportit, joihin etusivu linkittää kiinteästi; muut menevät etusivun Raportit-osioon. */
const ETUSIVUN_KIINTEAT = new Set([
  'paivakirja',
  'paakirja',
  'tositeluettelo',
  'tililuettelo',
  'taseerittely',
]);

const enkoodaa = new TextEncoder();
const e = escapeHtml;

/** Polku href-muotoon: jokainen osa %-koodattuna. */
function osoite(...osat: string[]): string {
  return osat.map(encodeURIComponent).join('/');
}

/** Sarjan nimi tiedostonimeen: muut kuin `A-Za-z0-9_-` korvataan `_`:lla. */
function sarjaTiedostoon(sarja: string): string {
  return sarja.replace(/[^A-Za-z0-9_-]/g, '_');
}

function onkoMuoto(x: string | undefined): x is TilinpaatosMuoto {
  return x === 'yleinen' || x === 'pien' || x === 'mikro';
}

function kaksi(n: number): string {
  return String(n).padStart(2, '0');
}

/** `dd.mm.yyyy` paikallisessa ajassa. */
function paivays(d: Date): string {
  return `${kaksi(d.getDate())}.${kaksi(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function teksti(polku: string, sisalto: string, tyyppi: string): Tiedosto {
  return { polku, data: enkoodaa.encode(sisalto), tyyppi };
}

/**
 * Kokoaa lukitun tilikauden sähköisen arkiston (Kitsas: arkistoija.cpp): staattiset HTML-sivut
 * raporteista, tilinpäätöksestä, alv-laskelmista ja jokaisesta tositteesta (+ tositteen JSON),
 * kaikki liitteet sellaisenaan, `manifest.json`, `arkisto.sha256` ja sen tiiviste etusivulla ja
 * arkistovarmenteessa. Ei kirjoita kirjanpitoon mitään.
 */
export async function rakennaArkisto(p: {
  client: KpClient;
  alkaa: IsoDate;
  nyt?: () => Date;
  versio?: string;
  onEdistys?: (valmis: number, yhteensa: number) => void;
  /** Sovelluksen CSS; oletuksena kerätään selaimen lataamista tyylitiedostoista. */
  css?: string;
}): Promise<ArkistoTulos> {
  const { client } = p;
  const nyt = p.nyt ? p.nyt() : new Date();
  const versio = p.versio ?? '0.0.0';

  const init = await client.haeInit();
  const kausi = init.tilikaudet.find((k) => k.alkaa === p.alkaa);
  if (!kausi) throw new Error(`Tilikautta ${p.alkaa} ei ole`);
  const { alkaa, loppuu } = kausi;
  const asetukset = init.asetukset;
  const paatetty = asetukset.TilitPaatetty;
  if (!paatetty || paatetty < loppuu) throw new Error('Tilikausi ei ole lukittu');

  const nimi = asetukset.Nimi ?? '';
  const kausiNimi = kausiTunnus(alkaa);
  const [listatut, kumppanilista] = await Promise.all([
    client.listaaTositteet({ alkupvm: alkaa, loppupvm: loppuu }),
    client.haeKumppanit(),
  ]);
  const tositteet = [...listatut].sort((a, b) =>
    a.sarja < b.sarja ? -1 : a.sarja > b.sarja ? 1 : a.tunniste - b.tunniste,
  );
  const kumppanit = new Map(kumppanilista.map((k) => [k.id, k.nimi]));
  const tilikartta = lataaKartta(init.tilit);
  const tilit = new Map(tilikartta.map((t) => [t.numero, t]));

  // Tositteiden tiedostonimet ennen renderöintiä: sivut linkittävät toisiinsa.
  const tiedostoIdlla = new Map<number, string>();
  const varatut = new Set<string>();
  for (const t of tositteet) {
    const runko = tositeTiedosto(kausiNimi, sarjaTiedostoon(t.sarja), t.tunniste);
    // Esim. sarjat "A/1" ja "A_1" päätyisivät samaan tiedostoon: ei hiljaista ylikirjoitusta.
    if (varatut.has(runko))
      throw new Error(`Kahdella tositteella on sama arkistotiedostonimi ${runko}`);
    varatut.add(runko);
    tiedostoIdlla.set(t.id, runko);
  }

  const ymp: StaattinenYmparisto = {
    client,
    queryClient: luoArkistonQueryClient(),
    linkit: (k) => {
      if (k.to === '/tositteet/$id') {
        const runko = tiedostoIdlla.get(Number(k.params?.id));
        return runko === undefined ? null : `../tositteet/${osoite(`${runko}.html`)}`;
      }
      const tili = k.search?.tili;
      if (k.to === '/tilikartta' && typeof tili === 'number' && Number.isInteger(tili))
        return `../raportit/paakirja.html#tili-${tili}`;
      return null;
    },
  };

  const kotiTeksti = `${nimi} · ${alkaa.slice(0, 4)}`;
  const alatunniste = `Arkistoitu ${paivays(nyt)} Penni-versiolla ${versio}`;
  const sivu = (
    otsikko: string,
    runko: string,
    navi: { edellinen?: string; seuraava?: string } = {},
  ) => htmlSivu({ otsikko, runko, syvyys: 1, navi: { kotiTeksti, ...navi }, alatunniste });

  const raportit = RAPORTIT.flatMap((r) => {
    if (EI_ARKISTOON.has(r.avain)) return [];
    const muoto = r.kaava ? kaavaAvain(asetukset, r.kaava) : undefined;
    if (r.kaava && muoto === undefined) return [];
    return [{ raportti: r, muoto, tiedosto: RAPORTTITIEDOSTO[r.avain] ?? r.avain }];
  });

  const varoitukset: string[] = [];
  const alvKaudet: AlvKausi[] = [];
  for (const t of tositteet) {
    if (t.tyyppi !== TositeTyyppi.ALVLASKELMA) continue;
    const alvKausi = t.otsikko ? parsiIlmoitusOtsikko(t.otsikko) : null;
    if (!alvKausi) {
      varoitukset.push(
        `ALV-laskelman ${tositeTunniste(t)} (${muotoilePvm(t.pvm)}) kautta ei voitu lukea otsikosta, joten laskelmaa ei arkistoitu`,
      );
    } else if (
      !alvKaudet.some((k) => k.alkupvm === alvKausi.alkupvm && k.loppupvm === alvKausi.loppupvm)
    ) {
      alvKaudet.push(alvKausi);
    }
  }

  const yhteensa = tositteet.length + raportit.length + 1 + alvKaudet.length;
  let valmis = 0;
  const edisty = () => p.onEdistys?.(++valmis, yhteensa);

  const tiedostot: Tiedosto[] = [
    teksti('static/arkisto.css', `${p.css ?? kokoaSovelluksenCss()}\n${ARKISTO_CSS}`, 'text/css'),
  ];

  // Tositteet liitteineen.
  const alv = onkoAlvVelvollinen(asetukset, loppuu);
  let liitteita = 0;
  for (const [i, t] of tositteet.entries()) {
    const runko = tiedostoIdlla.get(t.id) as string;
    const sarja = sarjaTiedostoon(t.sarja);
    const liitteet: ArkistoLiite[] = [];
    const liiteJson: unknown[] = [];
    // Listan liitemäärä säästää haun tositteilta, joilla liitteitä ei ole.
    const metat = t.liitteita === 0 ? [] : await client.haeLiitteet(t.id);
    for (const [j, meta] of metat.entries()) {
      const liite = await client.haeLiite(meta.id);
      if (!liite) throw new Error(`Tositteen ${tositeTunniste(t)} liitettä ${meta.id} ei löytynyt`);
      const tiedosto = liiteTiedosto(kausiNimi, sarja, t.tunniste, j + 1, meta.nimi, meta.tyyppi);
      if (meta.sha && meta.sha.toLowerCase() !== (await laskeSha(liite.data)))
        varoitukset.push(`Liitteen ${tiedosto} tarkiste ei täsmää tallennettuun`);
      tiedostot.push({
        polku: `liitteet/${tiedosto}`,
        data: liite.data,
        pakkaa: false,
        tyyppi: meta.tyyppi,
      });
      liitteet.push({ nimi: meta.nimi, tyyppi: meta.tyyppi, tiedosto });
      liiteJson.push({ ...meta, tiedosto });
      liitteita++;
    }

    // Listan omat kentät (liitemäärä, alkuperä) eivät kuulu tallennettuun tositteeseen.
    const { liitteita: _liitteita, alkupera: _alkupera, ...tosite } = t;
    tiedostot.push(
      teksti(
        `tositteet/${runko}.json`,
        JSON.stringify({ ...tosite, liitteet: liiteJson }, null, 2),
        'application/json',
      ),
    );

    const html = renderoiKerran(
      <ArkistoTositeSivu
        tosite={tosite}
        tilit={tilit}
        kumppanit={kumppanit}
        tyyppiNimi={tositeTyyppiLabel(t.tyyppi)}
        liitteet={liitteet}
        alv={alv}
        jsonTiedosto={osoite(`${runko}.json`)}
      />,
      ymp,
      `tosite ${tositeTunniste(t)}`,
    );
    const edellinen = tositteet[i - 1];
    const seuraava = tositteet[i + 1];
    tiedostot.push(
      teksti(
        `tositteet/${runko}.html`,
        sivu(`Tosite ${tositeTunniste(t)}`, html, {
          ...(edellinen ? { edellinen: osoite(`${tiedostoIdlla.get(edellinen.id)}.html`) } : {}),
          ...(seuraava ? { seuraava: osoite(`${tiedostoIdlla.get(seuraava.id)}.html`) } : {}),
        }),
        'text/html',
      ),
    );
    edisty();
  }

  // Raportit koko kaudelta (tase ja tase-erittely kauden lopussa).
  const kausiTeksti = `${muotoilePvm(alkaa)} – ${muotoilePvm(loppuu)}`;
  for (const { raportti: r, muoto, tiedosto } of raportit) {
    const html = await renderoiStaattiseksi(
      <r.Nakyma
        alkupvm={alkaa}
        loppupvm={loppuu}
        naytaTilit
        {...(muoto !== undefined ? { muoto } : {})}
      />,
      ymp,
      r.nimi,
    );
    // Laskut listaa oletuksena kauden lopussa avoimet laskut: tilanne päivänä, ei jaksolta.
    const jakso =
      r.avain === 'laskut'
        ? `Avoimet ${muotoilePvm(loppuu)}`
        : r.tilanneLopussa
          ? muotoilePvm(loppuu)
          : kausiTeksti;
    tiedostot.push(
      teksti(
        `raportit/${tiedosto}.html`,
        sivu(
          r.nimi,
          `<header class="arkistoteksti"><h1>${e(r.nimi)}</h1><p class="jakso">${e(jakso)}</p></header>${html}`,
        ),
        'text/html',
      ),
    );
    edisty();
  }

  // Tilinpäätös, liitetiedot pelkkänä tekstinä.
  const tpMuoto = asetukset.Tilinpaatosmuoto;
  const doc = await client.haeTilinpaatos({
    alkaa,
    ...(onkoMuoto(tpMuoto) ? { muoto: tpMuoto } : {}),
  });
  const tilinpaatos = renderoiKerran(
    <TilinpaatosDokumentti
      doc={doc}
      nimi={nimi}
      liitetiedot={<div className="whitespace-pre-wrap text-[13px]">{doc.liitetiedot}</div>}
    />,
    ymp,
    'tilinpäätös',
  );
  tiedostot.push(
    teksti('raportit/tilinpaatos.html', sivu('Tilinpäätös', tilinpaatos), 'text/html'),
  );
  edisty();

  // Alv-laskelmat kausittain, kaikki osiot auki.
  const alvLinkit: { nimi: string; polku: string }[] = [];
  for (const alvKausi of alvKaudet) {
    const [laskelma, erittely] = await Promise.all([
      client.haeAlvLaskelma(alvKausi),
      client.haeAlvErittely(alvKausi),
    ]);
    const html = renderoiKerran(
      <AlvLaskelmaDokumentti
        nimi={nimi}
        kausi={alvKausi}
        laskelma={laskelma}
        erittely={erittely}
        tilit={tilikartta}
        auki={{ laskelma: true, erittely: true }}
        onVaihda={() => {}}
      />,
      ymp,
      `alv ${alvKausi.alkupvm}–${alvKausi.loppupvm}`,
    );
    const tiedosto = `alv-${alvKausi.alkupvm}_${alvKausi.loppupvm}.html`;
    const otsikko = `Arvonlisäverolaskelma ${muotoilePvm(alvKausi.alkupvm)} – ${muotoilePvm(alvKausi.loppupvm)}`;
    tiedostot.push(teksti(`alv/${tiedosto}`, sivu(otsikko, html), 'text/html'));
    alvLinkit.push({ nimi: otsikko, polku: osoite('alv', tiedosto) });
    edisty();
  }

  // Manifest luettelee kaikki tähänastiset tiedostot; tarkistelista kattaa myös manifestin.
  const luotu = nyt.toISOString();
  const manifest = {
    muoto: 'penni-arkisto',
    versio: 1,
    kirjanpito: { nimi, ytunnus: asetukset.Ytunnus },
    tilikausi: { alkaa, loppuu },
    luotu,
    ohjelma: `Penni ${versio}`,
    tositteita: tositteet.length,
    liitteita,
    tiedostot: await Promise.all(
      tiedostot.map(async (t) => ({
        polku: t.polku,
        koko: t.data.length,
        sha256: await laskeSha(t.data),
        tyyppi: t.tyyppi,
      })),
    ),
  };
  tiedostot.push(teksti('manifest.json', JSON.stringify(manifest, null, 2), 'application/json'));

  const lista = enkoodaa.encode(await sha256Lista(tiedostot));
  const juuriTiiviste = await laskeSha(lista);

  const etusivu: EtusivunTiedot = {
    nimi,
    ...(asetukset.Ytunnus ? { ytunnus: asetukset.Ytunnus } : {}),
    kausi: { alkaa, loppuu },
    arkistoitu: luotu,
    versio,
    juuriTiiviste,
    vahvistettu: doc.vahvistettu,
    raportit: raportit
      .filter((r) => !ETUSIVUN_KIINTEAT.has(r.tiedosto))
      .map((r) => ({ nimi: r.raportti.nimi, polku: osoite('raportit', `${r.tiedosto}.html`) })),
    alv: alvLinkit,
    tositteita: tositteet.length,
    liitteita,
    varoitukset,
  };

  const kaikki: ZipTiedosto[] = [
    ...tiedostot,
    { polku: 'arkisto.sha256', data: lista },
    teksti('index.html', etusivuHtml(etusivu), 'text/html'),
    teksti('arkistovarmenne.html', varmenneHtml(etusivu), 'text/html'),
  ];
  // Kaikki yhden juurikansion alle; liitteet tallennetaan pakkaamatta.
  const zipattavat = kaikki.map(
    (t): ZipTiedosto => ({
      polku: `${kausiNimi}/${t.polku}`,
      data: t.data,
      ...(t.pakkaa === false ? { pakkaa: false } : {}),
    }),
  );

  return {
    tiedostonimi: `${turvallinenNimi(nimi)}-arkisto-${kausiNimi}.zip`,
    zip: pakkaa(zipattavat),
    juuriTiiviste,
    tositteita: tositteet.length,
    liitteita,
    luotu,
  };
}
