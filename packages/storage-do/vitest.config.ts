import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Testit ajetaan paikallisessa workerdissä (Miniflare). Ei wrangler-tiedostoa eikä tiliyhteyttä:
// sidonnat määritellään tässä, joten mitään ei voi vahingossa julkaista Cloudflareen.
export default defineWorkersConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // R2-sidonta (LIITETESTI) hidastaa tiedoston ensimmäistä testiä ~3 s; ruuhkassa (turbo) 5 s ylittyisi.
    testTimeout: 30_000,
    poolOptions: {
      workers: {
        main: './src/index.ts',
        // Jokainen testi luo oman DO:nsa (newUniqueId), joten pinottua eristystä ei tarvita.
        isolatedStorage: false,
        miniflare: {
          compatibilityDate: '2026-03-01',
          compatibilityFlags: ['nodejs_compat'],
          // Paikallinen Miniflare-R2 liitevaraston testeille. Nimi on tarkoituksella eri kuin
          // KirjaDO:n LIITTEET, jotta conformance-ajot (ei kirjaId:tä) jäävät SQLite-blobeille.
          r2Buckets: ['LIITETESTI'],
          durableObjects: { KIRJA: { className: 'KirjaDO', useSQLite: true } },
        },
      },
    },
  },
});
