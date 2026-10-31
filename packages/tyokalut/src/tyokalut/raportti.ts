import { Luonne, lataaKartta, onko } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { z } from 'zod/v4';
import { maaritaTyokalu, pvmSchema, pvmTanaan, raha } from '../tyokalu.js';

export const raportti = maaritaTyokalu({
  nimi: 'raportti',
  kuvaus:
    'Tuloslaskelma ja tase valmiine summariveineen. Käytä tätä kun kysytään liikevaihtoa, ' +
    'kuluja yhteensä, tilikauden tulosta/voittoa, omaa pääomaa, vierasta pääomaa tai taseen ' +
    'vastaavaa/vastattavaa yhteensä. Syötteet: muoto ("tulos/yleinen" tuloslaskelmalle, ' +
    '"tase/yleinen" taseelle), pvm (valinnainen kauden loppupäivä YYYY-MM-DD, oletus tämä ' +
    'päivä) ja alkupvm (valinnainen kauden alkupäivä; vaikuttaa vain tulostileihin, joiden ' +
    'rivit lasketaan oletuksena kuluvan tilikauden alusta — taseen rivit ovat aina ' +
    'kumulatiivisia eikä alkupvm vaikuta niihin). Jos annettua muoto-pohjaa ei ole määritetty ' +
    'kirjanpitoon, kutsu epäonnistuu virhekoodilla EIRAPORTTIA. Raportin rivit sisältävät ' +
    'valmiit välisummat ja yhteensä-rivit (esim. "Liikevaihto", "Vastaavaa yhteensä") — ' +
    'lainaa oikean rivin eur-arvo sellaisenaan, älä laske rivejä yhteen itse. Tuloslaskelmalle ' +
    'palautetaan lisäksi kulutYhteensa: kaikki kulutilit (tuloverot mukaan lukien) samalta ' +
    'kaudelta yhteensä — käytä sitä kun kysytään kuluja yhteensä.',
  kirjoittava: false,
  syote: z.object({
    muoto: z.string(),
    pvm: pvmSchema.optional(),
    alkupvm: pvmSchema.optional(),
  }),
  async suorita(client, syote, env) {
    const kausi = {
      pvm: syote.pvm ?? pvmTanaan(env),
      ...(syote.alkupvm !== undefined ? { alkupvm: syote.alkupvm } : {}),
    };
    const rivit = await client.laadiRaportti({ muoto: syote.muoto, ...kausi });
    // Tuloslaskelma has no "kulut yhteensä" row and models add signed rows badly, so the
    // total is computed here: every account whose luonne is MENO, income taxes included.
    let kulutYhteensa: number | undefined;
    if (syote.muoto.startsWith('tulos')) {
      const [saldot, init] = await Promise.all([
        client.haeSaldot({ ...kausi, tuloslaskelma: true }),
        client.haeInit(),
      ]);
      kulutYhteensa = lataaKartta(init.tilit)
        .filter((t) => onko(t.luonne, Luonne.MENO))
        .reduce((summa, t) => summa + (saldot.get(t.numero) ?? 0), 0);
    }
    return {
      muoto: syote.muoto,
      ...(kulutYhteensa !== undefined ? { kulutYhteensa: raha(kulutYhteensa as Cents) } : {}),
      rivit: rivit
        .filter((r) => !r.tyhja)
        .map((r) => ({
          teksti: r.teksti,
          sisennys: r.sisennys,
          lihava: r.lihava,
          ...(r.arvo !== null ? raha(r.arvo) : {}),
        })),
    };
  },
});
