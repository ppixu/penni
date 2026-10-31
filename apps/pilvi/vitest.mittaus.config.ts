import { defineConfig } from 'vitest/config';

// Mittausskriptien testit ajetaan tavallisessa Node-ympäristössä (better-sqlite3 + oikea
// `wrangler dev` -aliprosessi), ei workerd-poolissa; ks. vitest.config.ts workerd-testeille.
export default defineConfig({
  test: {
    include: ['mittaus/**/*.test.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 120_000,
    // Yksi tiedosto kerrallaan: jokainen käynnistää oman wrangler devin vapaaseen porttiin.
    fileParallelism: false,
  },
});
