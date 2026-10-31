import { InProcessClient } from '@penni/asiakas';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { c, env, luoTestikirja } from '../testi/kirja.js';
import { raportti } from './raportti.js';

/** Book with a one-row income statement layout and posted sale, purchase and income tax. */
async function kirjaKuluineen(): Promise<InProcessClient> {
  const storage = createMemoryStorage({
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
      { numero: 9900, tyyppi: 'DVE', nimi: { fi: 'Ennakkoverot' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: {
      'tulos/yleinen': JSON.stringify({ rivit: [{ fi: 'Tulos', L: '3..9 S', M: 'bold' }] }),
      'tase/yleinen': JSON.stringify({ rivit: [{ fi: 'Vastaavaa', L: '1..1 S', M: 'bold' }] }),
    },
  });
  const kirjaa = (tunniste: number, pvm: string, tili: number, sentit: number) =>
    storage.saveTosite(
      {
        pvm,
        tyyppi: 0,
        tila: 100,
        tunniste,
        sarja: '',
        viennit: [
          {
            tili,
            debet: c(sentit > 0 ? sentit : 0),
            kredit: c(sentit < 0 ? -sentit : 0),
            pvm,
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 1900,
            debet: c(sentit < 0 ? -sentit : 0),
            kredit: c(sentit > 0 ? sentit : 0),
            pvm,
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
  await kirjaa(1, '2026-02-01', 3000, -100000); // myynti 1 000,00 €
  await kirjaa(2, '2026-03-01', 4000, 20000); // ostot 200,00 €
  await kirjaa(3, '2026-07-01', 9900, 5000); // ennakkoverot 50,00 €
  return new InProcessClient(storage, () => env.aika);
}

describe('raportti', () => {
  it('adds a computed kulutYhteensa (all expense accounts, income taxes included) to income statements', async () => {
    const tulos = (await raportti.suorita(
      await kirjaKuluineen(),
      { muoto: 'tulos/yleinen', pvm: '2026-12-31' },
      env,
    )) as { kulutYhteensa?: { sentit: number; eur: string } };
    expect(tulos.kulutYhteensa?.sentit).toBe(-25000);
    expect(tulos.kulutYhteensa?.eur).toBe('−250,00 €'); // muotoileEuro: U+2212 minus, NBSP
  });

  it('kulutYhteensa follows alkupvm like the report rows do', async () => {
    const tulos = (await raportti.suorita(
      await kirjaKuluineen(),
      { muoto: 'tulos/yleinen', pvm: '2026-12-31', alkupvm: '2026-06-01' },
      env,
    )) as { kulutYhteensa?: { sentit: number } };
    expect(tulos.kulutYhteensa?.sentit).toBe(-5000);
  });

  it('gives no kulutYhteensa for a balance sheet', async () => {
    const tulos = (await raportti.suorita(
      await kirjaKuluineen(),
      { muoto: 'tase/yleinen', pvm: '2026-12-31' },
      env,
    )) as Record<string, unknown>;
    expect(tulos).not.toHaveProperty('kulutYhteensa');
  });

  it('maps EIRAPORTTIA through as ResourceError', async () => {
    await expect(
      raportti.suorita(
        (await luoTestikirja()).client,
        { muoto: 'tulos/yleinen', pvm: '2026-12-31' },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EIRAPORTTIA' });
  });

  it('propagates EIRAPORTTIA even with an alkupvm given', async () => {
    await expect(
      raportti.suorita(
        (await luoTestikirja()).client,
        { muoto: 'tase/yleinen', pvm: '2026-12-31', alkupvm: '2026-01-01' },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EIRAPORTTIA' });
  });

  it('defaults pvm to today from env when omitted (still reaches the engine)', async () => {
    // The fixture book has no report templates, so reaching EIRAPORTTIA proves the call was
    // built and dispatched with the defaulted pvm rather than rejected by the input schema.
    await expect(
      raportti.suorita((await luoTestikirja()).client, { muoto: 'tulos/yleinen' }, env),
    ).rejects.toMatchObject({ code: 'EIRAPORTTIA' });
  });

  it('rejects a malformed pvm via zod', async () => {
    await expect(
      raportti.suorita(
        (await luoTestikirja()).client,
        { muoto: 'tulos/yleinen', pvm: '31.12.2026' },
        env,
      ),
    ).rejects.toThrow();
  });
});
