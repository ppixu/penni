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

describe('kysy: ajattelun varatie', () => {
  const silmukka = (): OllamaVastaus => ({
    message: { content: '', thinking: 'sama kappale\n'.repeat(200) },
    done_reason: 'length',
  });

  it('toistaa kysymyksen alusta ilman ajattelua, kun ajatteleva kutsu katkeaa tokenrajaan', async () => {
    const { client } = await luoTestikirja();
    const kutsut: { viestit: OllamaViesti[]; ajattelu: boolean }[] = [];
    const kutsuFn: MalliKutsu = async (viestit, _t, asetukset) => {
      kutsut.push({ viestit: [...viestit], ajattelu: asetukset.ajattelu });
      return asetukset.ajattelu ? silmukka() : { message: { content: 'Pankissa on 100,00 €' } };
    };

    const tapahtumat = await keraa(
      kysy(client, { kysymys: 'Paljonko pankissa on?', kutsuFn, asetukset: { ajattelu: true } }),
    );

    expect(tapahtumat).toEqual([
      { tyyppi: 'varatie' },
      { tyyppi: 'vastaus', teksti: 'Pankissa on 100,00 €' },
    ]);
    // yksi silmukoiva ajattelukutsu riittää: ei korjausviestiä, ei toista 3000 tokenin kierrosta
    expect(kutsut.map((k) => k.ajattelu)).toEqual([true, false]);
    // varatie alkaa puhtaalta pöydältä: järjestelmäkehote + kysymys
    expect(kutsut[1]?.viestit.map((v) => v.role)).toEqual(['system', 'user']);
    expect(kutsut[1]?.viestit[1]?.content).toBe('Paljonko pankissa on?');
  });

  it('käyttää varatietä myös, kun vastaus jää ajatteluun tyhjänä korjausviestin jälkeenkin', async () => {
    const { client } = await luoTestikirja();
    const ajatukseen: OllamaVastaus = {
      message: { content: '', thinking: 'Vastaus: pankissa on 100 €.' },
      done_reason: 'stop',
    };
    const kutsut: boolean[] = [];
    const kutsuFn: MalliKutsu = async (_v, _t, asetukset) => {
      kutsut.push(asetukset.ajattelu);
      return asetukset.ajattelu ? ajatukseen : { message: { content: 'Pankissa on 100,00 €' } };
    };

    const tapahtumat = await keraa(
      kysy(client, { kysymys: 'Kysymys', kutsuFn, asetukset: { ajattelu: true } }),
    );

    expect(kutsut).toEqual([true, true, false]);
    expect(tapahtumat.at(-1)).toEqual({ tyyppi: 'vastaus', teksti: 'Pankissa on 100,00 €' });
  });

  it('jatkaa työkalukutsujen numerointia varatiellä, jotta kutsuId:t eivät törmää', async () => {
    const { client } = await luoTestikirja();
    let ajattelevia = 0;
    let suoria = 0;
    const kutsuFn: MalliKutsu = async (_v, _t, asetukset) => {
      const tyokalu: OllamaVastaus = {
        message: { content: '', tool_calls: [{ function: { name: 'saldot', arguments: {} } }] },
      };
      if (asetukset.ajattelu) return ajattelevia++ === 0 ? tyokalu : silmukka();
      return suoria++ === 0 ? tyokalu : { message: { content: 'valmis' } };
    };

    const tapahtumat = await keraa(
      kysy(client, { kysymys: 'Kysymys', kutsuFn, asetukset: { ajattelu: true } }),
    );

    const idt = tapahtumat.filter((t) => t.tyyppi === 'tyokalu_alkoi').map((t) => t.kutsuId);
    expect(idt).toEqual([1, 2]);
    expect(tapahtumat.at(-1)).toEqual({ tyyppi: 'vastaus', teksti: 'valmis' });
  });

  it('ilman ajattelua budjettivirhe välitetään sellaisenaan eikä kysymystä toisteta', async () => {
    const { client } = await luoTestikirja();
    let n = 0;
    const kutsuFn: MalliKutsu = async () => {
      n++;
      return silmukka();
    };

    const tapahtumat = await keraa(kysy(client, { kysymys: 'Kysymys', kutsuFn }));

    expect(n).toBe(2); // alkuperäinen + korjausviesti, kuten ennenkin
    expect(tapahtumat).toEqual([
      { tyyppi: 'virhe', koodi: 'budjetti', viesti: expect.any(String) },
    ]);
  });

  it('varatien voi kytkeä pois, jolloin ajatteleva silmukka päättyy budjettivirheeseen', async () => {
    const { client } = await luoTestikirja();
    const kutsut: boolean[] = [];
    const kutsuFn: MalliKutsu = async (_v, _t, asetukset) => {
      kutsut.push(asetukset.ajattelu);
      return silmukka();
    };

    const tapahtumat = await keraa(
      kysy(client, {
        kysymys: 'Kysymys',
        kutsuFn,
        asetukset: { ajattelu: true, ajattelunVaratie: false },
      }),
    );

    expect(kutsut).toEqual([true, true]);
    expect(tapahtumat.at(-1)).toMatchObject({ tyyppi: 'virhe', koodi: 'budjetti' });
  });
});

describe('kysy: ajattelun striimaus', () => {
  it('välittää ajattelun ajatus-tapahtumina ennen vastausta, eri ajatusId kullekin kutsulle', async () => {
    const { client } = await luoTestikirja();
    let n = 0;
    const kutsuFn: MalliKutsu = async (_v, _t, _a, valinnat) => {
      n++;
      valinnat?.ajatus?.(`mietin ${n} `);
      valinnat?.ajatus?.('lisää');
      if (n === 1) {
        return {
          message: { content: '', tool_calls: [{ function: { name: 'saldot', arguments: {} } }] },
        };
      }
      return { message: { content: 'Pankissa on 100,00 €' } };
    };

    const tapahtumat = await keraa(
      kysy(client, { kysymys: 'Kysymys', kutsuFn, asetukset: { ajattelu: true } }),
    );

    const ajatukset = tapahtumat.filter((t) => t.tyyppi === 'ajatus');
    // samassa kutsussa kertyneet palat yhdistyvät; kutsut erottuvat ajatusId:llä
    expect(ajatukset).toEqual([
      { tyyppi: 'ajatus', ajatusId: 1, osa: 'mietin 1 lisää' },
      { tyyppi: 'ajatus', ajatusId: 2, osa: 'mietin 2 lisää' },
    ]);
    expect(tapahtumat.map((t) => t.tyyppi)).toEqual([
      'ajatus',
      'tyokalu_alkoi',
      'tyokalu_valmis',
      'ajatus',
      'vastaus',
    ]);
  });

  it('tuottaa ajatuksen kesken kutsun, ei vasta kutsun valmistuttua', async () => {
    const { client } = await luoTestikirja();
    let paasta: (() => void) | undefined;
    const kutsuFn: MalliKutsu = (_v, _t, _a, valinnat) =>
      new Promise((ratkaise) => {
        valinnat?.ajatus?.('ensimmäinen ajatus');
        paasta = () => ratkaise({ message: { content: 'valmis' } });
      });

    const gen = kysy(client, { kysymys: 'Kysymys', kutsuFn, asetukset: { ajattelu: true } });
    const eka = await gen.next();
    expect(eka.value).toEqual({ tyyppi: 'ajatus', ajatusId: 1, osa: 'ensimmäinen ajatus' });
    paasta?.();
    expect((await gen.next()).value).toEqual({ tyyppi: 'vastaus', teksti: 'valmis' });
  });

  it('ilman ajattelua kuljetukselle ei anneta ajatus-kuuntelijaa (ei striimausta)', async () => {
    const { client } = await luoTestikirja();
    const kuuntelijat: unknown[] = [];
    const kutsuFn: MalliKutsu = async (_v, _t, _a, valinnat) => {
      kuuntelijat.push(valinnat?.ajatus);
      return { message: { content: 'vastaus' } };
    };
    await keraa(kysy(client, { kysymys: 'Kysymys', kutsuFn }));
    expect(kuuntelijat).toEqual([undefined]);
  });

  it('peruutus kesken kutsun välitetään kuljetukselle ja raportoidaan peruutuksena', async () => {
    const { client } = await luoTestikirja();
    const ohjain = new AbortController();
    const kutsuFn: MalliKutsu = (_v, _t, _a, valinnat) =>
      new Promise((_r, hylkaa) => {
        valinnat?.signal?.addEventListener('abort', () =>
          hylkaa(new KysyVirhe('kutsu', 'This operation was aborted')),
        );
        valinnat?.ajatus?.('mietin');
      });

    const gen = kysy(client, {
      kysymys: 'Kysymys',
      kutsuFn,
      asetukset: { ajattelu: true },
      keskeyta: ohjain.signal,
    });
    expect((await gen.next()).value).toMatchObject({ tyyppi: 'ajatus' });
    ohjain.abort();
    expect((await gen.next()).value).toMatchObject({ tyyppi: 'virhe', koodi: 'peruttu' });
    expect((await gen.next()).done).toBe(true);
  });
});

describe('kysy: toistosilmukan katkaisu', () => {
  const lause = 'Minun täytyy tarkistaa pankkitilin saldo uudelleen.\n';

  /** Kuljetus, joka striimaa toistuvaa lausetta kunnes se perutaan — kuten Ollama kehällä. */
  const kehaKuljetus =
    (kutsut: boolean[]): MalliKutsu =>
    (_v, _t, asetukset, valinnat) => {
      kutsut.push(asetukset.ajattelu);
      if (!asetukset.ajattelu) return Promise.resolve({ message: { content: 'Ilman ajattelua.' } });
      return new Promise((_r, hylkaa) => {
        valinnat?.signal?.addEventListener('abort', () =>
          hylkaa(new KysyVirhe('kutsu', 'This operation was aborted')),
        );
        for (let i = 0; i < 10 && !valinnat?.signal?.aborted; i++) valinnat?.ajatus?.(lause);
      });
    };

  it('katkaisee kehän kesken striimin ja siirtyy varatielle odottamatta tokenrajaa', async () => {
    const { client } = await luoTestikirja();
    const kutsut: boolean[] = [];

    const tapahtumat = await keraa(
      kysy(client, {
        kysymys: 'Kysymys',
        kutsuFn: kehaKuljetus(kutsut),
        asetukset: { ajattelu: true },
      }),
    );

    expect(kutsut).toEqual([true, false]);
    const ajatus = tapahtumat
      .filter((t) => t.tyyppi === 'ajatus')
      .map((t) => t.osa)
      .join('');
    expect(ajatus).toBe(lause.repeat(4)); // katkesi neljännellä toistolla, ei kymmenellä
    expect(tapahtumat.slice(-2)).toEqual([
      { tyyppi: 'varatie' },
      { tyyppi: 'vastaus', teksti: 'Ilman ajattelua.' },
    ]);
  });

  it('käyttäjän peruutus kehän aikana on peruutus, ei varatie', async () => {
    const { client } = await luoTestikirja();
    const ohjain = new AbortController();
    const kutsuFn: MalliKutsu = (_v, _t, _a, valinnat) =>
      new Promise((_r, hylkaa) => {
        valinnat?.signal?.addEventListener('abort', () =>
          hylkaa(new KysyVirhe('kutsu', 'This operation was aborted')),
        );
        valinnat?.ajatus?.(lause);
      });
    const gen = kysy(client, {
      kysymys: 'Kysymys',
      kutsuFn,
      asetukset: { ajattelu: true },
      keskeyta: ohjain.signal,
    });
    await gen.next();
    ohjain.abort();
    expect((await gen.next()).value).toMatchObject({ tyyppi: 'virhe', koodi: 'peruttu' });
  });

  it('ilman varatietä kehää ei katkaista', async () => {
    const { client } = await luoTestikirja();
    let peruttu = false;
    const kutsuFn: MalliKutsu = async (_v, _t, _a, valinnat) => {
      for (let i = 0; i < 6; i++) valinnat?.ajatus?.(lause);
      peruttu = valinnat?.signal?.aborted ?? false;
      return { message: { content: 'vastaus' } };
    };
    await keraa(
      kysy(client, {
        kysymys: 'Kysymys',
        kutsuFn,
        asetukset: { ajattelu: true, ajattelunVaratie: false },
      }),
    );
    expect(peruttu).toBe(false);
  });
});
