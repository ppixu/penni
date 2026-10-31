import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Monisivuisten PDF:ien ladonta kestää CI:n hitaammilla koneilla rinnakkaisajossa yli
    // oletuksen 5 s.
    testTimeout: 30_000,
  },
});
