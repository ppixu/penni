import { describe, expect, it } from 'vitest';
import { kysy } from './silmukka.js';
import { luoTestikirja } from './testi/kirja.js';
import type {
  KysyTapahtuma,
  MalliKutsu,
  OllamaTyokalu,
  OllamaVastaus,
  OllamaViesti,
} from './tyypit.js';
import { KysyVirhe } from './tyypit.js';

function skripti(vastaukset: OllamaVastaus[]): MalliKutsu {
  let i = 0;
  return async () => vastaukset[i++] ?? { message: { content: 'LOPPU' } };
}

async function keraa(gen: AsyncGenerator<KysyTapahtuma>): Promise<KysyTapahtuma[]> {
  const t: KysyTapahtuma[] = [];
  for await (const e of gen) t.push(e);
  return t;
}

describe('kysy', () => {
  it('kutsuu luku-työkalua ja tuottaa vastauksen sen tuloksen perusteella', async () => {
    const { client } = await luoTestikirja();
    const kutsutViestit: OllamaViesti[][] = [];
    const kutsuFn: MalliKutsu = async (viestit) => {
      kutsutViestit.push([...viestit]);
      if (kutsutViestit.length === 1) {
        return {
          message: {
            content: '',
            tool_calls: [{ function: { name: 'saldot', arguments: { pvm: '2026-12-31' } } }],
          },
        };
      }
      return { message: { content: 'Pankissa on 100,00 €' } };
    };

    const tapahtumat = await keraa(
      kysy(client, { kysymys: 'Paljonko pankkitilillä on rahaa?', kutsuFn }),
    );

    expect(tapahtumat).toHaveLength(3);
    expect(tapahtumat[0]).toMatchObject({ tyyppi: 'tyokalu_alkoi', nimi: 'saldot' });
    const valmis = tapahtumat[1] as {
      tyyppi: string;
      nimi: string;
      tulos: { saldot: { sentit: number }[] };
    };
    expect(valmis.tyyppi).toBe('tyokalu_valmis');
    expect(valmis.nimi).toBe('saldot');
    expect(valmis.tulos.saldot[0]?.sentit).toBe(10000);
    expect(tapahtumat[2]).toEqual({ tyyppi: 'vastaus', teksti: 'Pankissa on 100,00 €' });

    // toinen kutsu näkee edellisen kierroksen työkaluviestin, joka kantaa oikean tuloksen
    const toinenKutsu = kutsutViestit[1] ?? [];
    const tyokaluviesti = toinenKutsu.find((v) => v.role === 'tool');
    expect(tyokaluviesti?.content).toContain('"sentit":10000');
  });

  it('ei koskaan suorita kirjoittavaa työkalua vaan palauttaa EIKAYTOSSA', async () => {
    const { client } = await luoTestikirja();
    const ennen = await client.listaaTositteet({ bucket: 'luonnos' });
    const kutsuFn = skripti([
      {
        message: {
          content: '',
          tool_calls: [
            {
              function: {
                name: 'tosite_luonnos',
                arguments: {
                  pvm: '2026-08-15',
                  tyyppi: 0,
                  viennit: [
                    { tili: 1900, debet: 100, kredit: 0 },
                    { tili: 3000, debet: 0, kredit: 100 },
                  ],
                },
              },
            },
          ],
        },
      },
      { message: { content: 'ok' } },
    ]);

    const tapahtumat = await keraa(kysy(client, { kysymys: 'Tee luonnos.', kutsuFn }));

    const valmis = tapahtumat.find((t) => t.tyyppi === 'tyokalu_valmis') as {
      tulos: { virhe: string };
    };
    expect(valmis.tulos).toEqual({ virhe: 'EIKAYTOSSA', viesti: 'Työkalu ei ole käytettävissä.' });

    const jalkeen = await client.listaaTositteet({ bucket: 'luonnos' });
    expect(jalkeen).toHaveLength(ennen.length);
  });

  it('tuntematon työkalu palauttaa virhekoodin ja silmukka jatkuu', async () => {
    const { client } = await luoTestikirja();
    const kutsuFn = skripti([
      {
        message: {
          content: '',
          tool_calls: [{ function: { name: 'ei_olemassa', arguments: {} } }],
        },
      },
      { message: { content: 'jatketaan' } },
    ]);

    const tapahtumat = await keraa(kysy(client, { kysymys: 'Kysymys', kutsuFn }));

    const valmis = tapahtumat.find((t) => t.tyyppi === 'tyokalu_valmis') as {
      tulos: { virhe: string };
    };
    expect(valmis.tulos.virhe).toBe('TUNTEMATON_TYOKALU');
    expect(tapahtumat.at(-1)).toEqual({ tyyppi: 'vastaus', teksti: 'jatketaan' });
  });

  it('virheelliset työkalun argumentit palautuvat SYOTE-virheenä eikä silmukka heitä', async () => {
    const { client } = await luoTestikirja();
    const kutsuFn = skripti([
      {
        message: {
          content: '',
          tool_calls: [{ function: { name: 'saldot', arguments: { pvm: 42 } } }],
        },
      },
      { message: { content: 'valmis' } },
    ]);

    const tapahtumat = await keraa(kysy(client, { kysymys: 'Kysymys', kutsuFn }));

    const valmis = tapahtumat.find((t) => t.tyyppi === 'tyokalu_valmis') as {
      tulos: { koodi: string };
    };
    expect(valmis.tulos.koodi).toBe('SYOTE');
  });

  it('pakottaa lopullisen kutsun ilman työkaluja kun kierrokset loppuvat', async () => {
    const { client } = await luoTestikirja();
    const toolKierros = (): OllamaVastaus => ({
      message: {
        content: '',
        tool_calls: [{ function: { name: 'saldot', arguments: {} } }],
      },
    });
    const vastaukset: OllamaVastaus[] = [
      toolKierros(),
      toolKierros(),
      toolKierros(),
      toolKierros(),
      toolKierros(),
      toolKierros(),
      toolKierros(),
      toolKierros(), // 8 kierrosta, kaikki työkalukutsuja
      { message: { content: 'Valmis vastaus.' } }, // pakotettu lopullinen kutsu
    ];
    const kutsutTyokalut: (OllamaTyokalu[] | undefined)[] = [];
    let i = 0;
    const kutsuFn: MalliKutsu = async (_viestit, tyokalut) => {
      kutsutTyokalut.push(tyokalut);
      return vastaukset[i++] ?? { message: { content: 'LOPPU' } };
    };

    const tapahtumat = await keraa(kysy(client, { kysymys: 'Kysymys', kutsuFn }));

    const alkoiTapahtumat = tapahtumat.filter((t) => t.tyyppi === 'tyokalu_alkoi');
    expect(alkoiTapahtumat).toHaveLength(8);
    expect(kutsutTyokalut).toHaveLength(9);
    expect(kutsutTyokalut.at(-1)).toBeUndefined();
    expect(tapahtumat.at(-1)).toEqual({ tyyppi: 'vastaus', teksti: 'Valmis vastaus.' });
  });

  it('välittää kuljetuksen heittämän KysyVirheen tapahtumana eikä heitä', async () => {
    const { client } = await luoTestikirja();
    const kutsuFn: MalliKutsu = async () => {
      throw new KysyVirhe('kutsu', 'Ollamaan ei saatu yhteyttä.', 'ollama pull qwen3.5:2b');
    };

    const tapahtumat = await keraa(kysy(client, { kysymys: 'Kysymys', kutsuFn }));

    expect(tapahtumat).toEqual([
      {
        tyyppi: 'virhe',
        koodi: 'kutsu',
        viesti: 'Ollamaan ei saatu yhteyttä.',
        korjaus: 'ollama pull qwen3.5:2b',
      },
    ]);
  });

  it('keskeyttää silmukan kun keskeyta perutaan kesken kierroksen', async () => {
    const { client } = await luoTestikirja();
    const controller = new AbortController();
    const kutsuFn = skripti([
      {
        message: {
          content: '',
          tool_calls: [{ function: { name: 'saldot', arguments: {} } }],
        },
      },
      { message: { content: 'tänne ei koskaan päästä' } },
    ]);

    const tapahtumat: KysyTapahtuma[] = [];
    for await (const e of kysy(client, {
      kysymys: 'Kysymys',
      kutsuFn,
      keskeyta: controller.signal,
    })) {
      tapahtumat.push(e);
      if (e.tyyppi === 'tyokalu_valmis') controller.abort();
    }

    expect(tapahtumat.at(-1)).toMatchObject({ tyyppi: 'virhe', koodi: 'peruttu' });
  });

  it('rakentaa järjestelmäkehotteen kirjan perustiedoista ennen kysymystä', async () => {
    const { client } = await luoTestikirja();
    let ensimmainenKutsu: OllamaViesti[] | undefined;
    const kutsuFn: MalliKutsu = async (viestit) => {
      ensimmainenKutsu ??= [...viestit];
      return { message: { content: 'vastaus' } };
    };

    await keraa(kysy(client, { kysymys: 'Kysymys', kutsuFn }));

    expect(ensimmainenKutsu?.[0]?.role).toBe('system');
    expect(ensimmainenKutsu?.[0]?.content).toContain('Testi Oy');
  });
});
