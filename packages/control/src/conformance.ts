import { describe, expect, it } from 'vitest';
import type { ControlStore } from './portti.js';
import { TunnistusVirhe } from './virheet.js';

const AIKA = '2026-06-01T00:00:00.000Z';

/** Jaettu ControlStore-conformance. Sama orakkeli jokaiselle adapterille (drift-suoja). */
export function runControlConformance(
  nimi: string,
  tee: () => Promise<ControlStore> | ControlStore,
): void {
  describe(`ControlStore conformance: ${nimi}`, () => {
    it('luo käyttäjän ja hakee sen sähköpostilla ja id:llä', async () => {
      const store = await tee();
      const k = await store.luoKayttaja({
        email: 'Testi@Esimerkki.fi',
        salasanaHash: 'hash-1',
        nimi: 'Testi',
        aika: AIKA,
      });
      expect(k.id).toBeGreaterThan(0);
      expect(k.email).toBe('testi@esimerkki.fi'); // pienaakkostettu
      expect((k as { salasanaHash?: unknown }).salasanaHash).toBeUndefined(); // julkinen
      const tiedot = await store.haeKayttajaEmaililla('testi@esimerkki.fi');
      expect(tiedot?.salasanaHash).toBe('hash-1');
      const idlla = await store.haeKayttajaTiedot(k.id);
      expect(idlla?.email).toBe('testi@esimerkki.fi');
      expect(idlla?.nimi).toBe('Testi');
    });

    it('sähköpostihaku on kirjainkoosta riippumaton ja palauttaa null tuntemattomalle', async () => {
      const store = await tee();
      await store.luoKayttaja({ email: 'a@b.fi', salasanaHash: 'h', aika: AIKA });
      expect(await store.haeKayttajaEmaililla('A@B.FI')).not.toBeNull();
      expect(await store.haeKayttajaEmaililla('ei@ole.fi')).toBeNull();
    });

    it('hylkää duplikaattisähköpostin (myös eri kirjainkoolla)', async () => {
      const store = await tee();
      await store.luoKayttaja({ email: 'dup@esimerkki.fi', salasanaHash: 'h', aika: AIKA });
      await expect(
        store.luoKayttaja({ email: 'DUP@esimerkki.fi', salasanaHash: 'h2', aika: AIKA }),
      ).rejects.toBeInstanceOf(TunnistusVirhe);
    });

    it('paivitaSalasana muuttaa tiivisteen', async () => {
      const store = await tee();
      const k = await store.luoKayttaja({
        email: 'pw@esimerkki.fi',
        salasanaHash: 'vanha',
        aika: AIKA,
      });
      await store.paivitaSalasana(k.id, 'uusi');
      const tiedot = await store.haeKayttajaTiedot(k.id);
      expect(tiedot?.salasanaHash).toBe('uusi');
    });

    it('sessio: luonti, haku ja peruutus', async () => {
      const store = await tee();
      const k = await store.luoKayttaja({ email: 's@esimerkki.fi', salasanaHash: 'h', aika: AIKA });
      const sessio = {
        tokenHash: 'th-1',
        kayttajaId: k.id,
        luotu: AIKA,
        vanhenee: '2026-07-01T00:00:00.000Z',
        viimeksiKaytetty: AIKA,
      };
      await store.luoSessio(sessio);
      expect(await store.haeSessio('th-1')).toMatchObject({ kayttajaId: k.id });
      await store.poistaSessio('th-1');
      expect(await store.haeSessio('th-1')).toBeNull();
      await store.poistaSessio('th-1'); // idempotentti
    });
  });
}
