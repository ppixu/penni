import { expect, test } from '@playwright/test';

/**
 * E2E: paikallinen (OPFS-)kirjanpito säilyy sivun uudelleenlatauksessa.
 *
 * AJETAAN KÄYTTÄJÄLLÄ/CI:LLÄ — sandbox ei voi käynnistää headless-Chromiumia:
 *   corepack pnpm --filter @penni/web e2e:install   # playwright install chromium
 *   corepack pnpm --filter @penni/web e2e
 * Tämä testi EI kuulu tierin Node-vihreäporttiin (build/test/lint/typecheck).
 *
 * Todistus: velhon "Luo kirjanpito" ajaa luoOpfsKirjanpito → nollaa → siementää ainoan OPFS-kannan.
 * Reloadissa makeClient('local') avaa saman (nyt EI-tyhjän) OPFS-kannan ja OHITTAA siemennyksen,
 * joten luotu kirjanpito säilyy. Sivupalkki (AppShell) näyttää kirjanpidon nimen joka reitillä.
 * Selektorit on johdettu UusiKirjanpitoVelho.tsx:stä ja AppShell/__root:sta.
 */
test('paikallinen kirjanpito säilyy sivun uudelleenlatauksessa', async ({ page }) => {
  const nimi = `E2E-${Date.now()}`;

  // 1. Avaa uuden kirjanpidon velho ja täytä vaihe 1 (nimi + yritysmuoto oletuksena).
  await page.goto('/uusikirjanpito');
  await page.getByLabel('Organisaation nimi').fill(nimi);
  await page.getByRole('button', { name: 'Seuraava' }).click();

  // 2. Vaihe 2: tilikartta (yritys esivalittuna) → seuraava.
  await page.getByRole('button', { name: 'Seuraava' }).click();

  // 3. Vaihe 3: tilikausi (oletukset kelvollisia) → luo kirjanpito (kirjoittaa OPFS-kantaan).
  await page.getByRole('button', { name: 'Luo kirjanpito' }).click();

  // 4. Uusi kirjanpito on aktiivinen: nimi näkyy sivupalkissa ENNEN reloadia.
  await expect(page.getByText(nimi).first()).toBeVisible();

  // 5. Lataa sivu uudelleen — OPFS-kannan pitäisi säilyttää kirjanpito.
  await page.reload();

  // 6. Nimi on yhä näkyvissä reloadin jälkeen (= OPFS-pysyvyys toimii, siemennys ohitettiin).
  await expect(page.getByText(nimi).first()).toBeVisible();
});
