import { z } from 'zod/v4';
import { haeLiiteTiedot } from '../liiteTiedot.js';
import { maaritaTyokalu, raha } from '../tyokalu.js';

export const tosite = maaritaTyokalu({
  nimi: 'tosite',
  kuvaus:
    'Hakee yhden tositteen täydet tiedot vientirivit mukaan lukien. Syöte: id (tositteen ' +
    'numeerinen tunnus). Jokaisella viennillä on alvKoodi ja alvProsentti, tositteella ' +
    'kumppani (id ja nimi, tai null) sekä liitteet (id, nimi, tyyppi, koko tavuina; ei ' +
    'tiedostodataa). Jos tositetta ei löydy, palauttaa { virhe: "EITOSITETTA" } poikkeuksen ' +
    'sijaan.',
  kirjoittava: false,
  syote: z.object({ id: z.number().int() }),
  async suorita(client, syote) {
    const t = await client.haeTosite(syote.id);
    if (t === null) return { virhe: 'EITOSITETTA' as const };
    const [kumppani, liitteet] = await Promise.all([
      t.kumppani !== undefined && t.kumppani !== null
        ? client.haeKumppanit().then((kaikki) => ({
            id: t.kumppani as number,
            nimi: kaikki.find((k) => k.id === t.kumppani)?.nimi ?? null,
          }))
        : Promise.resolve(null),
      haeLiiteTiedot(client, t.id),
    ]);
    return {
      id: t.id,
      pvm: t.pvm,
      tyyppi: t.tyyppi,
      tila: t.tila,
      sarja: t.sarja,
      tunniste: t.tunniste,
      otsikko: t.otsikko ?? null,
      kumppani,
      viennit: t.viennit.map((v) => ({
        tili: v.tili,
        debet: raha(v.debet),
        kredit: raha(v.kredit),
        pvm: v.pvm,
        alvKoodi: v.alvKoodi,
        alvProsentti: v.alvProsentti,
        selite: v.selite ?? null,
      })),
      liitteet,
    };
  },
});
