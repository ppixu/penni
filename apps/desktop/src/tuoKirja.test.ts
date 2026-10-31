import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tuoKirja } from './tuoKirja.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-tuoKirja-'));
afterAll(() => rmSync(hakemisto, { recursive: true, force: true }));

// Sama viite-Kitsas-kirja kuin packages/tuonti/src/kokonaisuus.test.ts käyttää. Ei koskaan avata
// paikallaan (WAL-tila voisi jättää -shm/-wal-sivutiedostoja viitefixturen viereen) — kopioidaan
// väliaikaishakemistoon ensin.
const OIKEA_LAHDE = fileURLToPath(
  new URL('../../../kitsas-source/unittest/data/oy.kitsas', import.meta.url),
);
const lahde = join(hakemisto, 'oy.kitsas');
// kitsas-source on git-alimoduuli: ilman `git submodule update --init` fixtuuria ei ole ja
// testit ohitetaan.
const onOikeaLahde = existsSync(OIKEA_LAHDE);
beforeAll(() => {
  if (onOikeaLahde) copyFileSync(OIKEA_LAHDE, lahde);
});

describe('tuoKirja', () => {
  it.skipIf(!onOikeaLahde)(
    'onnistunut tuonti: kohde syntyy, väliaikaistiedosto katoaa',
    async () => {
      const kohde = join(hakemisto, 'onnistunut.penni');
      const tulos = await tuoKirja(lahde, kohde);

      expect(tulos.kohde).toBe(kohde);
      expect(tulos.raportti.tositteet).toBe(10);
      expect(tulos.taysmaytys.tasmaa).toBe(true);
      expect(existsSync(kohde)).toBe(true);
      expect(existsSync(`${kohde}.osittainen`)).toBe(false);
    },
  );

  it.skipIf(!onOikeaLahde)('kutsuu edistymiskuuntelijaa vaiheittain', async () => {
    const kohde = join(hakemisto, 'edistyminen.penni');
    const vaiheet: string[] = [];
    await tuoKirja(lahde, kohde, (e) => vaiheet.push(e.vaihe));

    expect(vaiheet).toContain('tositteet');
    expect(vaiheet).toContain('liitteet');
  });

  it('epäonnistunut tuonti: kohdetta ei synny, väliaikaistiedosto siivotaan', async () => {
    const kohde = join(hakemisto, 'epaonnistunut.penni');
    const huonoLahde = join(hakemisto, 'ei-olemassa.kitsas');

    await expect(tuoKirja(huonoLahde, kohde)).rejects.toThrow();

    expect(existsSync(kohde)).toBe(false);
    expect(existsSync(`${kohde}.osittainen`)).toBe(false);
  });

  it.skipIf(!onOikeaLahde)('vanha, jäänyt väliaikaistiedosto ei estä uutta tuontia', async () => {
    const kohde = join(hakemisto, 'jaanyt.penni');
    // Simuloi edellisen, kesken jääneen ajon roskaa: väärän muotoinen "väliaikaistiedosto".
    writeFileSync(`${kohde}.osittainen`, 'ei tämä ole kelvollinen sqlite-tiedosto');

    const tulos = await tuoKirja(lahde, kohde);

    expect(tulos.raportti.tositteet).toBe(10);
    expect(existsSync(kohde)).toBe(true);
    expect(existsSync(`${kohde}.osittainen`)).toBe(false);
  });
});
