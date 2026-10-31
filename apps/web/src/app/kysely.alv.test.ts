import { InProcessClient } from '@penni/asiakas';
import type { KpClient } from '@penni/asiakas';
import { ResourceError } from '@penni/engine';
import { Euro } from '@penni/euro';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { alvVirheViesti, valmisteleAlvTilitys } from './kysely.js';

const TILIT = [
  { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Alv-saatava' } },
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 2920, tyyppi: 'BV', nimi: { fi: 'Verovelka' } },
  { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } },
  { numero: 2941, tyyppi: 'BLM', nimi: { fi: 'Kohdentamaton alv-velka' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
];

function luoClient(asetukset: Record<string, string>): KpClient {
  const storage = createMemoryStorage({
    tilit: TILIT,
    tilikaudet: [
      { alkaa: '2025-01-01', loppuu: '2025-12-31' },
      { alkaa: '2026-01-01', loppuu: '2026-12-31' },
    ],
    asetukset: {
      Nimi: 'Demo Oy',
      OletusMyyntitili: '3000',
      LaskuSaatavaTili: '1701',
      AlvVelkaTili: '2939',
      ...asetukset,
    },
  });
  return new InProcessClient(storage, () => '2026-06-01T00:00:00.000Z');
}

const KAUSI = { alkupvm: '2026-05-01', loppupvm: '2026-05-31' };

describe('valmisteleAlvTilitys', () => {
  it('ei-maksuperusteinen kirja: EIMAKSUPERUSTEINEN nielaistaan ja tuore laskelma palautuu', async () => {
    const client = luoClient({ AlvVelvollinen: 'true', AlvAlkaa: '2025-01-01' });
    const tulos = await valmisteleAlvTilitys(client, KAUSI);
    expect(tulos.esikirjaukset).toEqual([]);
    expect(tulos.laskelma.koodit.size).toBe(0);
    expect(tulos.laskelma.maksettava).toBe(Euro.fromCents(0));
  });

  it('ei alv-velvollinen kirja: marginaalivaiheen EIVEROVELVOLLINEN nielaistaan', async () => {
    const client = luoClient({ AlvVelvollinen: 'false' });
    const tulos = await valmisteleAlvTilitys(client, KAUSI);
    expect(tulos.esikirjaukset).toEqual([]);
  });

  it('maksuperusteinen kirja: vanhennus kirjataan ja tuore laskelma sisältää tunnistetun veron', async () => {
    const client = luoClient({
      AlvVelvollinen: 'true',
      AlvAlkaa: '2025-01-01',
      MaksuAlvAlkaa: '2025-01-01',
    });
    const asiakas = await client.tallennaKumppani({ nimi: 'Asiakas Oy' });
    // Yli vuoden maksamatta ollut LASKU-myynti (100 € netto à 25,5 %) → vanhennus
    // tunnistaa lykätyn veron kauden lopussa (maksuperusteinenVanhennus.ts:50-62).
    await client.tallennaMyyntilasku({
      pvm: '2025-03-10',
      erapvm: '2025-03-24',
      kumppani: asiakas.id,
      rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
    });

    const tulos = await valmisteleAlvTilitys(client, KAUSI);
    expect(tulos.esikirjaukset).toHaveLength(1);
    expect(tulos.esikirjaukset[0]?.otsikko).toBe('Maksuperusteisen alv:n vanhennus');
    expect(tulos.laskelma.koodit.get(301)).toBe(Euro.fromCents(2_550));
    expect(tulos.laskelma.maksettava).toBe(Euro.fromCents(2_550));

    // Uusinta-ajo on turvallinen: vanhennus on laskukohtaisesti idempotentti eikä kirjaudu
    // uudestaan; luvut pysyvät samoina.
    const toinen = await valmisteleAlvTilitys(client, KAUSI);
    expect(toinen.esikirjaukset).toEqual([]);
    expect(toinen.laskelma.koodit.get(301)).toBe(Euro.fromCents(2_550));
  });
});

describe('alvVirheViesti', () => {
  it('kuvaa spec §7:n koodit suomeksi', () => {
    expect(alvVirheViesti(new ResourceError('JOILMOITETTU', 'x'))).toBe('Kausi on jo ilmoitettu');
    expect(alvVirheViesti(new ResourceError('EITILITYSTA', 'x'))).toBe(
      'Kaudella ei ole tilitettävää arvonlisäveroa',
    );
    expect(alvVirheViesti(new ResourceError('EIALVTILIA', 'x'))).toBe(
      'ALV-tili puuttuu tilikartasta',
    );
    expect(alvVirheViesti(new ResourceError('PVMLUKITTU', 'x'))).toBe(
      'Tilikausi on lukittu tälle päivälle',
    );
    expect(alvVirheViesti(new ResourceError('EIVALMISTU', 'x'))).toBe(
      'Kirjaus ei läpäise tarkastusta',
    );
    expect(alvVirheViesti(new ResourceError('EITILIKAUTTA', 'x'))).toBe(
      'Päivälle ei ole tilikautta',
    );
    expect(alvVirheViesti(new ResourceError('EITOSITETTA', 'x'))).toBe('Tositetta ei löydy');
  });

  it('tuntematon koodi ja ei-ResourceError putoavat oletusviestiin', () => {
    expect(alvVirheViesti(new ResourceError('OUTO', 'x'))).toBe('Toiminto epäonnistui (OUTO)');
    expect(alvVirheViesti(new Error('x'))).toBe('Toiminto epäonnistui');
  });
});
