import { z } from 'zod/v4';
import { haeLiiteTiedot } from '../liiteTiedot.js';
import { maaritaTyokalu } from '../tyokalu.js';

export const liitteet = maaritaTyokalu({
  nimi: 'liitteet',
  kuvaus:
    'Listaa tositteen liitteet: id, nimi, tyyppi (MIME), koko tavuina, sha256 ja luontiaika — ' +
    'ei tiedostodataa. Syöte: tosite (tositteen id). Jos tositetta ei löydy, palauttaa ' +
    '{ virhe: "EITOSITETTA" }.',
  kirjoittava: false,
  syote: z.object({ tosite: z.number().int() }),
  async suorita(client, syote) {
    if ((await client.haeTosite(syote.tosite)) === null) return { virhe: 'EITOSITETTA' as const };
    return { tosite: syote.tosite, liitteet: await haeLiiteTiedot(client, syote.tosite) };
  },
});
