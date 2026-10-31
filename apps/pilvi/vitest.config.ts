import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Testit ajetaan paikallisessa workerdissä (Miniflare) Workeria (SELF) vasten. Sidonnat
// määritellään tässä eikä wrangler.jsonc:ssä, joten testit eivät tarvitse rakennettua web-SPA:ta
// (assets) eivätkä tiliyhteyttä — mitään ei voi vahingossa julkaista Cloudflareen.
export default defineWorkersConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Kylmä workerd ja rinnakkaiset paketit (turbo) ylittävät helposti oletuksen 5 s.
    testTimeout: 30_000,
    poolOptions: {
      workers: {
        main: './src/index.ts',
        // Jokainen testi luo oman käyttäjänsä ja kirjansa (UUID), joten pinottua eristystä ei
        // tarvita; Control DO on jaettu kuten tuotannossa.
        isolatedStorage: false,
        miniflare: {
          compatibilityDate: '2026-03-01',
          compatibilityFlags: ['nodejs_compat'],
          // workerd ei toteuta DO-lainkäyttöalueita (jurisdiction('eu') heittää paikallisesti).
          // Kehitysmuuttujat (kehitys.ts): kirjan tuonti ja mittauslaskurit päälle vain testeissä.
          bindings: {
            PAIKALLINEN_WORKERD: '1',
            PILVI_KEHITYS_TUONTI: '1',
            PILVI_KEHITYS_LASKURIT: '1',
          },
          // Paikallinen Miniflare-R2 (muistissa/tilapäishakemistossa); EU-lainkäyttöalue on vain
          // wrangler.jsonc:ssä, koska Miniflaren r2Buckets-asetus ei tunne lainkäyttöaluetta.
          r2Buckets: ['LIITTEET'],
          durableObjects: {
            KIRJA: { className: 'KirjaDO', useSQLite: true },
            CONTROL: { className: 'ControlDO', useSQLite: true },
          },
        },
      },
    },
  },
});
