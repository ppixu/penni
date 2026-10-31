import fastifyStatic from '@fastify/static';
import { LAHDEKOODI_POLKU, authContract, contract, lahdekoodiTarjous } from '@penni/contract';
import { type ControlStore, TunnistusVirhe, haeMinut } from '@penni/control';
import { ResourceError, type Storage } from '@penni/engine';
import { type RouterImplementation, initServer } from '@ts-rest/fastify';
import Fastify, { type FastifyInstance } from 'fastify';
import { luoAuthKasittelijat } from './authKasittelijat.js';
import { luoKasittelijat } from './reititin.js';
import { tunnistusALS } from './tunnistusKonteksti.js';
import { tunnistusKoodiHttp, virheKoodiHttp } from './virheet.js';

export interface PalvelinOptions {
  /** Per-request timestamp source; default `() => new Date().toISOString()`. */
  kello?: () => string;
  /** Fastify logger; default false. */
  logger?: boolean;
  /** Kontrollivarasto — kun annettu, auth-reitit (/register, /login, /me, /logout, /vaihda-salasana) sidotaan. */
  control?: ControlStore;
  /** Sessioiden kesto ms (oletus 30 vrk). */
  sessionKestoMs?: number;
  /** Kun tosi, moottorireitit vaativat voimassa olevan session. */
  vaadiTunnistus?: boolean;
  /**
   * Kun annettu, sopimusreitit rekisteröidään tämän etuliitteen alle (esim. '/api').
   * Perässä oleva kauttaviiva ('/api/') normalisoidaan pois. Pelkkä '/' (tai pelkkiä
   * kauttaviivoja) ei kelpaa, koska se ei erottaisi api-polkuja muista — luoPalvelin heittää.
   */
  apiEtuliite?: string;
  /** Kun annettu, tästä hakemistosta tarjoillaan rakennettu web-sovellus SPA-reitityksellä. */
  staattinenHakemisto?: string;
  /**
   * Lähdekoodin osoite AGPL §13 -tarjoukseen (GET /lahdekoodi). Muokatun version ylläpitäjän on
   * annettava oman lähdekoodinsa osoite; oletus on Pennin oma repo.
   */
  lahdekoodiUrl?: string;
}

/** Build a Fastify server exposing the @penni/contract over the given Storage. */
export function luoPalvelin(storage: Storage, options: PalvelinOptions = {}): FastifyInstance {
  if (options.vaadiTunnistus && !options.control) {
    throw new Error('vaadiTunnistus vaatii control-varaston');
  }
  // Etuliite normalisoidaan KERRAN tässä ja samaa arvoa käytetään kaikkialla — reitityksessä,
  // auth-polkujen vertailussa ja 404-käsittelijän rajatarkastuksessa. Fastify normalisoi perässä
  // olevan kauttaviivan itse reittejä rekisteröidessään (esim. { prefix: '/api/' } + '/login' ->
  // '/api/login'), mutta omat merkkijonovertailumme eivät — ilman tätä normalisointia esim.
  // '/api/' olisi rikkonut sekä auth-polkujen tunnistuksen että api/staattinen-rajan.
  let apiEtuliite: string | undefined;
  if (options.apiEtuliite) {
    const normalisoitu = options.apiEtuliite.replace(/\/+$/, '');
    if (normalisoitu === '') {
      // Pelkkä '/' (tai pelkkiä kauttaviivoja) ei erottaisi mitään — se normalisoituisi tyhjäksi
      // ja poistaisi hiljaisesti koko etuliitteen suojan, esim. staattinenHakemisto-vaatimuksen
      // takaa. Hylätään eksplisiittisesti sen sijaan, että se hiljaa vastaisi "ei etuliitettä".
      throw new Error("apiEtuliite ei voi olla pelkkiä '/'-merkkejä");
    }
    apiEtuliite = normalisoitu;
  }
  // Ilman etuliitettä ei voida erottaa api-polkuja muista poluista, jolloin staattinen jakelu
  // palauttaisi index.html:n myös tuntemattomille api-pyynnöille.
  if (options.staattinenHakemisto && !apiEtuliite) {
    throw new Error('staattinenHakemisto vaatii apiEtuliitteen');
  }
  const kello = options.kello ?? (() => new Date().toISOString());
  const app = Fastify({ logger: options.logger ?? false });

  // ResourceError -> HTTP status; everything else -> 500.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ResourceError) {
      void reply
        .status(virheKoodiHttp(error.code))
        .send({ virhe: error.message, koodi: error.code });
      return;
    }
    if (error instanceof TunnistusVirhe) {
      void reply
        .status(tunnistusKoodiHttp(error.koodi))
        .send({ virhe: error.message, koodi: error.koodi });
      return;
    }
    void reply.status(500).send({ virhe: 'Palvelinvirhe' });
  });

  // AGPL §13: verkon yli Penniä käyttävälle tarjotaan lähdekoodi. Juuripolussa API-etuliitteen
  // ulkopuolella ja ilman kirjautumista (ks. tunnistuskoukku alla), jotta tarjous on kaikkien
  // käyttäjien saatavilla — myös niiden, jotka eivät ole vielä kirjautuneet.
  const lahdekoodi = lahdekoodiTarjous(options.lahdekoodiUrl);
  app.get(LAHDEKOODI_POLKU, (_request, reply) => {
    void reply.type('text/plain; charset=utf-8').send(lahdekoodi);
  });

  const s = initServer();

  if (options.control && options.vaadiTunnistus) {
    const control = options.control;
    // Johdetaan sopimuksesta kovakoodatun listan sijaan, jotta polut eivät voi ajautua erilleen.
    // Etuliite lisätään mukaan, koska koukku vertaa tätä joukkoa request.url:iin, joka sisältää
    // etuliitteen kun apiEtuliite on annettu — muuten esim. /login näyttäisi suojatulta reitiltä.
    const etuliite = apiEtuliite ?? '';
    const authPolut = new Set(
      Object.values(authContract).map((r) => etuliite + (r as { path: string }).path),
    );
    // Callback-tyylinen koukku (ei async/await): tunnistusALS.run() käynnistää `done`:n
    // SYNKRONISESTI oman kontekstinsa sisällä, jolloin Fastifyn jatko (seuraava koukku / käsittelijä)
    // periytyy oikein. `enterWith` ei toimisi tässä: sen jälkeinen `await haeMinut(...)` -paluu
    // rekisteröi Fastifyn jatkopromisen `.then`:n jo ENNEN kuin enterWith ehtii ajaa, joten konteksti
    // ei periytyisi seuraavaan koukkuun.
    app.addHook('onRequest', (request, reply, done) => {
      const polku = request.url.split('?')[0] ?? request.url;
      if (authPolut.has(polku) || polku === LAHDEKOODI_POLKU) {
        done();
        return;
      }
      const otsake = request.headers.authorization ?? '';
      const token = otsake.toLowerCase().startsWith('bearer ') ? otsake.slice(7) : '';
      if (!token) {
        void reply.status(401).send({ virhe: 'Kirjautuminen vaaditaan', koodi: 'EI_SESSIOTA' });
        done();
        return;
      }
      haeMinut(control, token, {
        kello,
        ...(options.sessionKestoMs !== undefined ? { sessionKestoMs: options.sessionKestoMs } : {}),
      }).then(
        (kayttaja) => {
          tunnistusALS.run({ userId: kayttaja.id }, done);
        },
        (e: unknown) => {
          // Vain TunnistusVirhe tarkoittaa aitoa 401:tä (puuttuva/vanhentunut sessio). Muu hylkäys
          // (esim. control-varaston katkos) on palvelinvirhe — väärä "istunto vanhentunut" johtaisi
          // käyttäjän harhaan uloskirjautumiseen, vaikka vika ei ole hänen sessiossaan.
          if (e instanceof TunnistusVirhe) {
            void reply.status(401).send({ virhe: 'Istunto vanhentunut', koodi: 'EI_SESSIOTA' });
          } else {
            void reply.status(500).send({ virhe: 'Palvelinvirhe' });
          }
          done();
        },
      );
    });
  }

  // ts-rest checks handler responses against each route's zod z.input/objectInputType, and the
  // schemas use .passthrough() — which defeats structural matching against our codec return types
  // (e.g. encodeInit().tilit is Record<string,unknown>[], wider than the inferred body type).
  // Tightening the codecs doesn't cleanly resolve it (each field fixed uncovers another z.input
  // mismatch), so we cast once at this boundary. Runtime shapes are codec-guaranteed and proven
  // by the HTTP integration suite (palvelin.test.ts) + the contract's golden/round-trip tests.
  const router = s.router(
    contract,
    luoKasittelijat(storage, kello) as unknown as RouterImplementation<typeof contract>,
  );
  void app.register(s.plugin(router), apiEtuliite ? { prefix: apiEtuliite } : {});

  if (options.control) {
    const authRouter = s.router(
      authContract,
      luoAuthKasittelijat(
        options.control,
        kello,
        options.sessionKestoMs,
      ) as unknown as RouterImplementation<typeof authContract>,
    );
    void app.register(s.plugin(authRouter), apiEtuliite ? { prefix: apiEtuliite } : {});
  }

  // Työpöytätila: tarjoillaan rakennettu web-sovellus samasta palvelimesta kuin API, jolloin
  // renderöijä on sama-alkuperäinen API:n kanssa — ei CORSia eikä osoitteen injektointia.
  if (options.staattinenHakemisto) {
    const juuri = options.staattinenHakemisto;
    const etuliite = apiEtuliite;
    // wildcard: false rekisteröi erillisen reitin jokaiselle käynnistyshetkellä olemassa olevalle
    // tiedostolle, jolloin reittilista on eksplisiittinen ja ennustettava. (wildcard: true toimisi
    // tässäkin — @fastify/static kutsuu puuttuvalle tiedostolle reply.callNotFound():ia, joka
    // päätyisi samaan alla olevaan setNotFoundHandleriin — mutta eksplisiittinen lista on selkeämpi.)
    void app.register(fastifyStatic, { root: juuri, wildcard: false });
    // SPA-reititys: tuntematon EI-api-polku palauttaa index.html:n, jotta selainreititys toimii.
    // Polkuraja on segmenttikohtainen (ei raakamerkkijonovertailu), jotta esim. '/apidocs' ei näytä
    // virheellisesti api-poluilta vain siksi, että se ALKAA etuliitteen kirjaimilla.
    app.setNotFoundHandler((request, reply) => {
      const polku = request.url.split('?')[0] ?? request.url;
      if (etuliite && (polku === etuliite || polku.startsWith(`${etuliite}/`))) {
        void reply.status(404).send({ virhe: 'Reittiä ei löydy', koodi: 'EI_LOYDY' });
        return;
      }
      void reply.sendFile('index.html');
    });
  }

  return app;
}
