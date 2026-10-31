import { describe, expect, it } from 'vitest';
import { OLETUS_SYOTE, luoKirjanpidonSiemen } from './luoSiemen.js';
import { luoPaikallinenClient } from './makeClient.js';

// makeClient('local') on nyt async ja avaa OPFS-kannan Workerissa — sitä ei voi ajaa Node/jsdomissa.
// Siemen → tilikartta -käytös on kuitenkin backend-riippumaton (conformance todistaa sen memory/
// sqlite/opfs-ajureilla), joten testataan se synkronisen muistiapurin (luoPaikallinenClient) kautta.
describe('paikallinen kirjanpito (siemen)', () => {
  it('luo kirjanpidon koko yritys-tilikartalla', async () => {
    const client = luoPaikallinenClient(luoKirjanpidonSiemen(OLETUS_SYOTE));
    const init = await client.haeInit();
    // Siemen sisältää 1079 riviä (tilit + H<n>-otsikot). Varasto avaimittaa kartan parilla
    // (numero, taso) (Storage-sopimus: putTili(numero, data), taso johdetaan data.tyyppistä),
    // joten tilit ja eritasoiset otsikot samalla numerolla eivät enää törmää keskenään.
    // Yritys-kartassa on yksi aito (numero, taso)-pari kahdesti: 262/H4 esiintyy kahdella eri
    // suomenkielisellä nimellä (siemendatan laatuvirhe, ei tason-avaimistuksen bugi) → haeInit
    // palauttaa 1078 riviä.
    expect(init.tilit).toHaveLength(1078);
  });

  it('siementää raporttilayoutit asetuksiin', async () => {
    const client = luoPaikallinenClient(luoKirjanpidonSiemen(OLETUS_SYOTE));
    const asetukset = await client.haeAsetukset();
    expect(asetukset.Nimi).toBe('Oma kirjanpito');
    expect(asetukset['tulos/yleinen']).toBeDefined();
  });
});
