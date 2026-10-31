import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // PGlite (WASM-Postgres) käynnistyy hitaasti, kun turbo ajaa paketteja rinnakkain; oletus 5 s
    // ylittyi satunnaisesti.
    testTimeout: 30_000,
  },
});
