import { TositeTyyppi } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { c, env, luoTestikirja } from '../testi/kirja.js';
import { tosite } from './tosite.js';

describe('tosite', () => {
  it('returns EITOSITETTA shape for a missing id', async () => {
    const tulos = await tosite.suorita((await luoTestikirja()).client, { id: 99999 }, env);
    expect(tulos).toEqual({ virhe: 'EITOSITETTA' });
  });

  it('returns the full voucher with viennit in both money forms', async () => {
    const { client } = await luoTestikirja();
    const [myynti] = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    const tulos = (await tosite.suorita(client, { id: myynti?.id }, env)) as {
      otsikko: string | null;
      viennit: {
        tili: number;
        debet: { sentit: number; eur: string };
        kredit: { sentit: number; eur: string };
        pvm: string;
        selite: string | null;
      }[];
    };
    expect(tulos.otsikko).toBe('Konsultointi');
    const pankkiVienti = tulos.viennit.find((v) => v.tili === 1900);
    expect(pankkiVienti?.debet).toEqual({ sentit: 10000, eur: '100,00\u00a0€' });
    expect(pankkiVienti?.kredit).toEqual({ sentit: 0, eur: '0,00\u00a0€' });
    expect(pankkiVienti?.selite).toBeNull();
  });

  it('rejects a non-integer id via zod', async () => {
    await expect(
      tosite.suorita((await luoTestikirja()).client, { id: 1.5 }, env),
    ).rejects.toThrow();
  });

  it('returns alv fields per vienti, the kumppani and attachment metadata without data', async () => {
    const { client } = await luoTestikirja();
    const kumppani = await client.tallennaKumppani({ nimi: 'Testi Oy' });
    const t = await client.luoTosite({
      pvm: '2026-04-10',
      tyyppi: TositeTyyppi.MENO,
      sarja: '',
      otsikko: 'Toimistotarvikkeet',
      kumppani: kumppani.id,
      tila: 50,
      viennit: [
        {
          tili: 4000,
          debet: c(1000),
          kredit: c(0),
          pvm: '2026-04-10',
          alvKoodi: 26,
          alvProsentti: 25.5,
        },
        {
          tili: 1900,
          debet: c(0),
          kredit: c(1000),
          pvm: '2026-04-10',
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });
    await client.tallennaLiite({
      tosite: t.id,
      nimi: 'kuitti.pdf',
      tyyppi: 'application/pdf',
      sha: 'abc',
      luotu: '2026-04-10T10:00:00.000Z',
      data: new Uint8Array([1, 2, 3, 4, 5]),
    });
    const tulos = (await tosite.suorita(client, { id: t.id }, env)) as {
      kumppani: { id: number; nimi: string | null } | null;
      viennit: { tili: number; alvKoodi: number; alvProsentti: number }[];
      liitteet: Record<string, unknown>[];
    };
    expect(tulos.kumppani).toEqual({ id: kumppani.id, nimi: 'Testi Oy' });
    expect(tulos.viennit[0]).toMatchObject({ tili: 4000, alvKoodi: 26, alvProsentti: 25.5 });
    expect(tulos.liitteet).toHaveLength(1);
    expect(tulos.liitteet[0]).toMatchObject({
      nimi: 'kuitti.pdf',
      tyyppi: 'application/pdf',
      koko: 5,
      sha: 'abc',
    });
    expect(tulos.liitteet[0]).not.toHaveProperty('data');
  });

  it('returns kumppani null and an empty liitteet list when the voucher has neither', async () => {
    const { client } = await luoTestikirja();
    const [myynti] = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    const tulos = (await tosite.suorita(client, { id: myynti?.id }, env)) as {
      kumppani: unknown;
      liitteet: unknown[];
    };
    expect(tulos.kumppani).toBeNull();
    expect(tulos.liitteet).toEqual([]);
  });
});
