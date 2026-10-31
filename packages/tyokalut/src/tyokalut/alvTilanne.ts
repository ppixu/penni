import { onkoAlvVelvollinen } from '@penni/engine';
import { z } from 'zod/v4';
import { maaritaTyokalu, pvmSchema, pvmTanaan, raha } from '../tyokalu.js';

export const alvTilanne = maaritaTyokalu({
  nimi: 'alv_tilanne',
  kuvaus:
    'Laskee kauden alv-tilanteen (maksettava/palautettava arvonlisävero ja veroilmoituksen ' +
    'koodit). Käytä tätä vain arvonlisäveroa (alv) koskeviin kysymyksiin — älä ostovelkoihin, ' +
    'myyntisaamisiin tai muihin tilisaldoihin, ne haetaan saldot-työkalulla. Syötteet: alkupvm ' +
    '(valinnainen, oletus kuluvan tilikauden alkupäivä; jos kuluvaa tilikautta ei löydy ' +
    'kirjanpidon nykyhetkelle, käytetään varhaisimman tilikauden alkupäivää) ja loppupvm ' +
    '(valinnainen, oletus tämä päivä). Yksittäisen kuukauden alv: anna sekä alkupvm että ' +
    'loppupvm (esim. helmikuu 2026: alkupvm "2026-02-01", loppupvm "2026-02-28"). Kauden ' +
    'alv-velka on tuloksen maksettava-kentän eur-arvo — lainaa se vastaukseksi sellaisenaan ' +
    '(maksettava > 0 tarkoittaa maksettavaa alv-velkaa kaudelta, negatiivinen palautusta). ' +
    'Koodit ovat veroilmoituksen erittelyrivejä. Taseen alv-velkatilin saldo ("paljonko ' +
    'alv-velkaa on taseessa") haetaan saldot-työkalulla (haku: "alv").',
  kirjoittava: false,
  syote: z.object({
    alkupvm: pvmSchema.optional(),
    loppupvm: pvmSchema.optional(),
  }),
  async suorita(client, syote, env) {
    const loppupvm = syote.loppupvm ?? pvmTanaan(env);
    let alkupvm = syote.alkupvm;
    if (alkupvm === undefined) {
      const kaudet = await client.haeTilikaudet();
      const pvm = pvmTanaan(env);
      const nykyinen = kaudet.find((k) => k.alkaa <= pvm && pvm <= k.loppuu);
      const varhaisin = [...kaudet].sort((a, b) => (a.alkaa < b.alkaa ? -1 : 1))[0];
      // No tilikaudet at all: fall back to loppupvm — an honest one-day period beats a lie.
      alkupvm = (nykyinen ?? varhaisin)?.alkaa ?? loppupvm;
    }
    const [asetukset, tulos] = await Promise.all([
      client.haeAsetukset(),
      client.haeAlvLaskelma({ alkupvm, loppupvm }),
    ]);
    return {
      alkupvm,
      loppupvm,
      alvVelvollinen: onkoAlvVelvollinen(asetukset, loppupvm),
      alvIlmoitettu: asetukset.AlvIlmoitettu ?? null,
      maksettava: raha(tulos.maksettava),
      koodit: [...tulos.koodit].map(([koodi, maara]) => ({ koodi, ...raha(maara) })),
    };
  },
});
