import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Jos wasm-glue ei lataudu Nodessa, poista kommentti seuraavalta riviltä:
    // server: { deps: { inline: ['@sqlite.org/sqlite-wasm'] } },
  },
});
