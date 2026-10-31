import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: rakennetaan ja esikatsellaan apps/web ja varmistetaan OPFS-pysyvyys reloadissa.
 * Tämän ajaa käyttäjä/CI (sandbox ei voi käynnistää headless-Chromiumia):
 *   pnpm --filter @penni/web e2e:install && pnpm --filter @penni/web e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:4173', headless: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
