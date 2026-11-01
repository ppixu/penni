import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { AlvKoodi } from '../alv/koodit.js';
import { TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import { CONFORMANCE_SEED, type ConformanceSeed } from './conformance.js';
import { kirjaaLaskuluonnos } from './laskuluonnosResource.js';
import { luoMaksumuistutukset } from './maksumuistutusResource.js';
import { paivitaAsetukset, putTili } from './masterData.js';
import {
  listaaMyyntilaskut,
  tallennaMyyntilasku,
  tallennaSuoritus,
} from './myyntilaskuResource.js';
import type { AuditCtx, Storage } from './storage.js';

const c = (n: number): Cents => n as Cents;
const audit: AuditCtx = { aika: '2026-06-01T00:00:00.000Z' };

/**
 * Laskutuksen lisien (luonnokset, muistutukset, toistot, ryhmä-/ennakkolasku, tuotteet)
 * tallennusyhteensopivuus. Kutsutaan `runResourceConformance`-sviitin lopusta, joten jokainen
 * tallennusadapteri ajaa nämä; uudet tapaukset lisätään `describe`-lohkon sisään.
 */
export function runLaskutusConformance(
  name: string,
  makeStorage: (seed: ConformanceSeed) => Promise<Storage> | Storage,
): void {
  const fresh = async () => makeStorage(CONFORMANCE_SEED);

  describe(`Laskutus conformance: ${name}`, () => {
    it('luonnos: kaikki uudet tosite- ja rivikentät säilyvät tallennuksessa', async () => {
      const s = await fresh();
      const tallennettu = await s.saveTosite(
        {
          pvm: '2026-05-01',
          tyyppi: TositeTyyppi.MYYNTILASKU,
          tila: TositeTila.VALMISLASKU,
          tunniste: 0,
          sarja: '',
          viennit: [],
          jakso: { alkaa: '2026-05-01', loppuu: '2026-05-31' },
          muistutus: {
            maksu: c(500),
            korko: c(945),
            viivkorko: 11.5,
            korkoalkaa: '2026-05-01',
            korkoloppuu: '2026-05-30',
            aiempiSaldo: c(100000),
            aiemmat: [7],
          },
          viivkorko: 11.5,
          toisto: 3,
          toistoPvm: '2026-05-01',
          ryhma: 'r-1',
          rivit: [
            {
              selite: 'Ylläpito',
              myyntiKpl: 1,
              aNetto: 100,
              alvKoodi: 11,
              alvProsentti: 25.5,
              tuote: 4,
              ennakkoTosite: 9,
            },
          ],
        },
        audit,
      );
      const luettu = await s.getTosite(tallennettu.id);
      expect(luettu?.jakso).toEqual({ alkaa: '2026-05-01', loppuu: '2026-05-31' });
      expect(luettu?.muistutus?.korko).toBe(945);
      expect(luettu?.rivit?.[0]).toMatchObject({ tuote: 4, ennakkoTosite: 9 });
      expect(luettu).toMatchObject({
        viivkorko: 11.5,
        toisto: 3,
        toistoPvm: '2026-05-01',
        ryhma: 'r-1',
      });
    });

    it('luonnos → kirjaus säilyttää id:n ja erän', async () => {
      const s = await fresh();
      await putTili(s, 1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await putTili(s, 2939, { numero: 2939, tyyppi: 'CV', nimi: { fi: 'Suoritettava alv' } });
      await paivitaAsetukset(s, {
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
      });
      const luonnos = await tallennaMyyntilasku(
        s,
        {
          pvm: '2026-06-01',
          luonnos: true,
          rivit: [
            { myyntiKpl: 1, aNetto: 100, alvKoodi: AlvKoodi.MYYNNIT_NETTO, alvProsentti: 25.5 },
          ],
        },
        audit,
      );
      const tallessa = await s.getTosite(luonnos.id);
      expect(tallessa).toMatchObject({ tila: TositeTila.VALMISLASKU, tunniste: 0, viennit: [] });
      expect(tallessa?.numero).toBeUndefined();
      expect((await s.getAsetukset()).LaskuSeuraavaId).toBeUndefined();

      const kirjattu = await kirjaaLaskuluonnos(s, luonnos.id, audit);
      const luettu = await s.getTosite(luonnos.id);
      expect(kirjattu.id).toBe(luonnos.id);
      expect(luettu).toMatchObject({ tila: TositeTila.KIRJANPIDOSSA, numero: '1' });
      expect(luettu?.viennit.find((v) => v.tili === 1701)?.era).toBe(luonnos.id);
      expect((await s.getAsetukset()).LaskuSeuraavaId).toBe('2');
      expect(await s.listTositteet({ bucket: 'luonnos' })).toEqual([]);
    });

    it('muistutus + maksu nollaa alkuperäisen erän', async () => {
      const s = await fresh();
      await putTili(s, 1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await putTili(s, 9170, { numero: 9170, tyyppi: 'C', nimi: { fi: 'Korkotuotot' } });
      await paivitaAsetukset(s, {
        LaskuSaatavaTili: '1701',
        LaskuMaksutili: '1900',
        OletusMyyntitili: '3000',
        LaskuMaksumuistutustili: '9170',
        LaskuViivastyskorkotili: '9170',
      });
      const lasku = await tallennaMyyntilasku(
        s,
        {
          pvm: '2026-04-01',
          erapvm: '2026-04-30',
          rivit: [{ myyntiKpl: 1, aNetto: 1000, alvKoodi: 0, alvProsentti: 0 }],
        },
        audit,
      );
      const [luonnos] = await luoMaksumuistutukset(
        s,
        { tositteet: [lasku.id], pvm: '2026-05-30', korko: true, viivkorko: 11.5 },
        audit,
      );
      const id = luonnos?.id as number;
      await kirjaaLaskuluonnos(s, id, audit);

      const muistutus = await s.getTosite(id);
      expect(muistutus).toMatchObject({
        tila: TositeTila.KIRJANPIDOSSA,
        numero: '2',
        alkuperainenTosite: lasku.id,
        muistutus: { maksu: 500, korko: 945, aiempiSaldo: 100000, aiemmat: [lasku.id] },
      });
      expect(muistutus?.viennit.map((v) => [v.tili, v.debet, v.kredit, v.era])).toEqual([
        [1701, 1445, 0, lasku.id],
        [9170, 0, 500, undefined],
        [9170, 0, 945, undefined],
      ]);
      expect((await s.queryErat({})).get(lasku.id)).toBe(101445);
      const rivit = await listaaMyyntilaskut(s, {});
      expect(rivit.find((r) => r.tosite === lasku.id)).toMatchObject({ muistutettu: 1 });
      expect(rivit.find((r) => r.tosite === id)).toMatchObject({ muistutus: true, avoin: 0 });

      await tallennaSuoritus(s, { tosite: id, pvm: '2026-06-10', summa: c(101445) }, audit);
      expect((await s.queryErat({})).get(lasku.id) ?? 0).toBe(0);
      expect(await listaaMyyntilaskut(s, { avoin: true })).toEqual([]);
    });
  });
}
