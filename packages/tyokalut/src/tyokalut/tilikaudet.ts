import { z } from 'zod/v4';
import { maaritaTyokalu } from '../tyokalu.js';

export const tilikaudet = maaritaTyokalu({
  nimi: 'tilikaudet',
  kuvaus:
    'Kaikki tilikaudet alku- ja loppupäivineen ja onko kausi lukittu (TilitPaatetty). Käytä ' +
    'kun kysytään tilikausista, niiden määrästä tai lukituksesta.',
  kirjoittava: false,
  syote: z.object({}),
  async suorita(client) {
    const [kaudet, asetukset] = await Promise.all([client.haeTilikaudet(), client.haeAsetukset()]);
    const paatetty = asetukset.TilitPaatetty ?? '';
    return {
      tilikaudet: kaudet.map((k) => ({
        alkaa: k.alkaa,
        loppuu: k.loppuu,
        lukittu: paatetty !== '' && k.loppuu <= paatetty,
      })),
    };
  },
});
