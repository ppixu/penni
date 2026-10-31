import { onkoAlvVelvollinen } from '@penni/engine';
import { z } from 'zod/v4';
import { maaritaTyokalu, pvmTanaan } from '../tyokalu.js';

export const perustiedot = maaritaTyokalu({
  nimi: 'perustiedot',
  kuvaus:
    'Kirjanpidon perustiedot: yrityksen nimi, Y-tunnus, alv-velvollisuus, kuluva tilikausi ' +
    '(alkaa, loppuu ja paiviaAlusta eli kuinka monta päivää tilikauden alusta on kulunut ' +
    'tähän päivään) ja päivämäärä. Kutsu tämä ensin.',
  kirjoittava: false,
  syote: z.object({}),
  async suorita(client, _syote, env) {
    const [asetukset, kaudet] = await Promise.all([client.haeAsetukset(), client.haeTilikaudet()]);
    const pvm = pvmTanaan(env);
    const nykyinen = kaudet.find((k) => k.alkaa <= pvm && pvm <= k.loppuu) ?? null;
    return {
      nimi: asetukset.Nimi ?? '',
      ytunnus: asetukset.Ytunnus ?? null,
      muoto: asetukset.muoto ?? null,
      alvVelvollinen: onkoAlvVelvollinen(asetukset, pvm),
      pvm,
      tilikausi: nykyinen
        ? {
            alkaa: nykyinen.alkaa,
            loppuu: nykyinen.loppuu,
            paiviaAlusta: Math.round(
              (Date.parse(`${pvm}T00:00:00.000Z`) - Date.parse(`${nykyinen.alkaa}T00:00:00.000Z`)) /
                86_400_000,
            ),
          }
        : null,
      tilitPaatetty: asetukset.TilitPaatetty ?? null,
    };
  },
});
