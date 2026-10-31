import { InProcessClient } from '@penni/asiakas';
import { TositeTila, TositeTyyppi } from '@penni/engine';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { kaikkiTyokalut, lueTyokalut } from '../rekisteri.js';
import { c, env, luoTestikirja } from '../testi/kirja.js';
import { liiteLisays } from './liiteLisays.js';
import { liitteet } from './liitteet.js';

const PDF = new TextEncoder().encode('%PDF-1.4\n% testiliite\n%%EOF\n');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const b64 = (u8: Uint8Array) => Buffer.from(u8).toString('base64');

async function luonnosId(client: InProcessClient): Promise<number> {
  const [luonnos] = await client.listaaTositteet({ bucket: 'luonnos' });
  if (!luonnos) throw new Error('testikirjassa pitäisi olla luonnos');
  return luonnos.id;
}

describe('liite_lisays', () => {
  it('attaches a PDF to a draft, logs it with lahde and lists it via liitteet', async () => {
    const { client, storage } = await luoTestikirja('agentti:testi');
    const id = await luonnosId(client);
    const tulos = (await liiteLisays.suorita(
      client,
      { tosite: id, nimi: 'kuitti.pdf', tyyppi: 'application/pdf', data: b64(PDF) },
      env,
    )) as { id: number; koko: number; sha: string };
    expect(tulos.koko).toBe(PDF.length);
    expect(tulos.sha).toMatch(/^[0-9a-f]{64}$/);
    expect((await client.haeLiite(tulos.id))?.data).toEqual(PDF);
    expect((await storage.getLoki(id)).at(-1)).toMatchObject({
      lahde: 'agentti:testi',
      data: { liite: { id: tulos.id, nimi: 'kuitti.pdf' } },
    });

    const lista = (await liitteet.suorita(client, { tosite: id }, env)) as {
      liitteet: Record<string, unknown>[];
    };
    expect(lista.liitteet).toEqual([
      {
        id: tulos.id,
        nimi: 'kuitti.pdf',
        tyyppi: 'application/pdf',
        koko: PDF.length,
        sha: tulos.sha,
        luotu: env.aika,
      },
    ]);
  });

  it('accepts a PNG to a booked voucher in an open period', async () => {
    const { client } = await luoTestikirja();
    const [kirjattu] = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    const tulos = (await liiteLisays.suorita(
      client,
      { tosite: kirjattu?.id, nimi: 'kuva.png', tyyppi: 'image/png', data: b64(PNG) },
      env,
    )) as { tyyppi: string };
    expect(tulos.tyyppi).toBe('image/png');
  });

  it('refuses content that does not match the declared type', async () => {
    const { client } = await luoTestikirja();
    const id = await luonnosId(client);
    await expect(
      liiteLisays.suorita(
        client,
        { tosite: id, nimi: 'kuitti.pdf', tyyppi: 'application/pdf', data: b64(PNG) },
        env,
      ),
    ).rejects.toMatchObject({ koodi: 'TIEDOSTOTYYPPI' });
  });

  it('refuses invalid base64 and a name with a directory path', async () => {
    const { client } = await luoTestikirja();
    const id = await luonnosId(client);
    await expect(
      liiteLisays.suorita(
        client,
        { tosite: id, nimi: 'kuitti.pdf', tyyppi: 'application/pdf', data: 'ei base64!' },
        env,
      ),
    ).rejects.toMatchObject({ koodi: 'SYOTE' });
    await expect(
      liiteLisays.suorita(
        client,
        { tosite: id, nimi: '../kuitti.pdf', tyyppi: 'application/pdf', data: b64(PDF) },
        env,
      ),
    ).rejects.toThrow();
  });

  it('refuses a booked voucher in a locked period with PVMLUKITTU', async () => {
    const storage = createMemoryStorage({
      tilit: [
        { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
        { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
      ],
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: { Nimi: 'Testi Oy' },
    });
    const client = new InProcessClient(storage, () => env.aika);
    const t = await client.luoTosite({
      pvm: '2026-02-01',
      tyyppi: TositeTyyppi.MENO,
      sarja: '',
      viennit: [
        {
          tili: 4000,
          debet: c(100),
          kredit: c(0),
          pvm: '2026-02-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 1900,
          debet: c(0),
          kredit: c(100),
          pvm: '2026-02-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });
    expect(t.tila).toBe(TositeTila.KIRJANPIDOSSA);
    await client.paivitaAsetukset({ TilitPaatetty: '2026-03-31' });
    await expect(
      liiteLisays.suorita(
        client,
        { tosite: t.id, nimi: 'kuitti.pdf', tyyppi: 'application/pdf', data: b64(PDF) },
        env,
      ),
    ).rejects.toMatchObject({ code: 'PVMLUKITTU' });
  });

  it('liitteet returns EITOSITETTA for a missing voucher', async () => {
    const { client } = await luoTestikirja();
    expect(await liitteet.suorita(client, { tosite: 999 }, env)).toEqual({ virhe: 'EITOSITETTA' });
  });
});

describe('registry boundaries', () => {
  it('keeps the attachment tools out of the assistant (Kysy) tool list', () => {
    expect(lueTyokalut).not.toContain(liiteLisays);
    expect(lueTyokalut).not.toContain(liitteet);
    expect(liiteLisays.kirjoittava).toBe(true);
  });

  it('no registered tool takes a filesystem path as input', () => {
    const polkumaiset = /^(polku|path|tiedosto|file|tiedostopolku|filename)$/i;
    for (const t of kaikkiTyokalut) {
      const shape = (t.syote as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      for (const kentta of Object.keys(shape)) expect(kentta).not.toMatch(polkumaiset);
    }
  });
});
