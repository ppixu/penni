import type { Cents } from '@penni/euro';
import { z } from 'zod/v4';
import { maaritaTyokalu, pvmSchema, raha } from '../tyokalu.js';

/** Kova katto riveille; ilman raja-syötettä palautetaan enintään OLETUS_RAJA riviä —
 *  pieni malli hukkuu satojen rivien listaan, ja lukumaara-kenttä kantaa kokonaismäärän. */
const RAJA = 100;
const OLETUS_RAJA = 20;

export const tositteetHaku = maaritaTyokalu({
  nimi: 'tositteet_haku',
  kuvaus:
    'Etsii ja laskee tositteita suodattimilla, ilman vientejä (käytä tosite-työkalua yhden ' +
    'tositteen täysiin tietoihin). Käytä kun kysytään kuinka monta tositetta on tai etsitään ' +
    'tositteita — älä tilien saldoihin tai rahamääriin, ne haetaan saldot-työkalulla. ' +
    'Syötteet: alkaen ja loppuen (päivämäärärajaus tositteen päivälle, YYYY-MM-DD), teksti ' +
    '(vapaa haku otsikosta ja viitteestä, ei huomioi kirjainkokoa), sarja (tositesarjan tarkka ' +
    'täsmäys), bucket (kirjanpidossa | luonnos | saapuneet | malli | poistetut, oletus ' +
    'kirjanpidossa eli lopulliset kirjatut tositteet) ja raja (valinnainen rivimäärän katto, ' +
    'oletus 20). Palauttaa lukumaara-kentässä osumien kokonaismäärän — vastaa ' +
    'lukumääräkysymykseen tällä luvulla — sekä tositteet uusin ensin: kullakin rivillä on ' +
    'otsikko ja debetSumma (tositteen vientien debet-summa euroina, esim. viimeisimmän ' +
    'tositteen summa on ensimmäisen rivin debetSumma). Rajattu-kenttä kertoo, jos rivejä ' +
    'karsittiin rajan takia.',
  kirjoittava: false,
  syote: z.object({
    alkaen: pvmSchema.optional(),
    loppuen: pvmSchema.optional(),
    teksti: z.string().optional(),
    sarja: z.string().optional(),
    bucket: z.enum(['kirjanpidossa', 'luonnos', 'saapuneet', 'malli', 'poistetut']).optional(),
    raja: z.number().int().min(1).max(RAJA).optional(),
  }),
  async suorita(client, syote) {
    const tositteet = await client.listaaTositteet({
      ...(syote.bucket !== undefined ? { bucket: syote.bucket } : {}),
      ...(syote.alkaen !== undefined ? { alkupvm: syote.alkaen } : {}),
      ...(syote.loppuen !== undefined ? { loppupvm: syote.loppuen } : {}),
    });
    const teksti = syote.teksti?.toLowerCase();
    const suodatetut = tositteet
      .filter((t) => {
        if (teksti === undefined) return true;
        const haku = `${t.otsikko ?? ''} ${t.viite ?? ''}`.toLowerCase();
        return haku.includes(teksti);
      })
      .filter((t) => syote.sarja === undefined || t.sarja === syote.sarja)
      // uusin ensin: "viimeisin tosite" on listan ensimmäinen rivi myös rajatussa tuloksessa
      .sort((a, b) => b.tunniste - a.tunniste);
    const raja = syote.raja ?? OLETUS_RAJA;
    const rivit = suodatetut.slice(0, raja).map((t) => {
      const summa = t.viennit.reduce((s, v) => s + v.debet, 0) as Cents;
      return {
        id: t.id,
        pvm: t.pvm,
        tyyppi: t.tyyppi,
        tila: t.tila,
        sarja: t.sarja,
        tunniste: t.tunniste,
        otsikko: t.otsikko ?? null,
        debetSumma: raha(summa),
      };
    });
    return { lukumaara: suodatetut.length, tositteet: rivit, rajattu: suodatetut.length > raja };
  },
});
