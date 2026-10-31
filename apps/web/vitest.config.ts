import { URL, fileURLToPath } from 'node:url';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Must run before react() so routeTree.gen.ts is (re)generated on test startup — the
    // generated tree is gitignored, so tests importing @/routeTree.gen depend on this.
    // routeFileIgnorePattern keeps colocated *.test.tsx files out of the route tree.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '\\.test\\.(ts|tsx)$',
    }) as unknown as Plugin,
    // The `as unknown as Plugin` cast bridges a tsc type difference: Vitest 2 bundles vite@5
    // types while the app plugins resolve vite@6; the Plugin shapes are structurally identical
    // but nominally distinct under exactOptionalPropertyTypes. It affects only type-checking of
    // this config, never `vite build` (workspace stays on Vitest 2 per the version decision).
    react() as unknown as Plugin,
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
