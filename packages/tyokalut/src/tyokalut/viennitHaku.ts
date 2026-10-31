import { z } from 'zod/v4';
import { maaritaTyokalu, pvmSchema, raha } from '../tyokalu.js';

/** Kova katto riveille; ilman raja-syötettä palautetaan enintään OLETUS_RAJA riviä —
 *  pieni malli hukkuu satojen rivien listaan, ja lukumaara-kenttä kantaa kokonaismäärän. */
const RAJA = 200;
const OLETUS_RAJA = 30;

export const viennitHaku = maaritaTyokalu({
  nimi: 'viennit_haku',
  kuvaus:
    'Etsii ja laskee kirjattuja (tila >= 100) vientirivejä yli tositerajojen. Käytä kun ' +
    'kysytään kuinka monta vientiä tilillä tai jaksolla on, tai millä alv-kannalla vientejä on ' +
    'kirjattu. Syötteet: tili (valinnainen, rajaa yhteen tilinumeroon), alkaen ja loppuen ' +
    '(valinnainen päivämäärärajaus viennin päivälle, YYYY-MM-DD), alvProsentti (valinnainen, ' +
    'rajaa vienteihin joilla on tämä alv-kanta, esim. 25.5) ja raja (valinnainen rivimäärän ' +
    'katto, oletus 30). Rajaa kysytty jakso aina alkaen- ja loppuen-päivillä (esim. kuluva ' +
    'tilikausi tai yksittäinen kuukausi). Jos et tiedä tilinumeroa, hae se ensin ' +
    'tilit_haku-työkalulla. Palauttaa lukumaara-kentässä osumien kokonaismäärän — vastaa ' +
    'lukumääräkysymykseen tällä luvulla — sekä rivit debet- ja kredit-summineen, alvKoodi- ja ' +
    'alvProsentti-kenttineen sekä tositteen tunnuksella (tosite = id tosite-työkalulle), ' +
    'numerolla (tunniste) ja otsikolla; rajattu-kenttä kertoo, jos rivejä karsittiin.',
  kirjoittava: false,
  syote: z.object({
    tili: z.number().int().optional(),
    alkaen: pvmSchema.optional(),
    loppuen: pvmSchema.optional(),
    alvProsentti: z.number().optional(),
    raja: z.number().int().min(1).max(RAJA).optional(),
  }),
  async suorita(client, syote) {
    // Viennit poimitaan kirjatuista tositteista (eikä listaaViennit-kutsulla), jotta jokaiselle
    // riville saadaan tositteen tunnus, numero ja otsikko. Rajaus ja järjestys vastaavat
    // listaaViennit-kutsua: tila >= 100, viennin oma päivä (ei tositteen), tositteen id:n mukaan.
    const tositteet = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    const kaikki = [...tositteet]
      .sort((a, b) => a.id - b.id)
      .flatMap((t) =>
        t.viennit
          .filter(
            (v) =>
              (syote.tili === undefined || v.tili === syote.tili) &&
              (syote.alkaen === undefined || v.pvm >= syote.alkaen) &&
              (syote.loppuen === undefined || v.pvm <= syote.loppuen),
          )
          .map((v) => ({ t, v })),
      );
    const viennit =
      syote.alvProsentti !== undefined
        ? kaikki.filter(({ v }) => Math.abs(v.alvProsentti - (syote.alvProsentti ?? 0)) < 0.001)
        : kaikki;
    const raja = syote.raja ?? OLETUS_RAJA;
    const rivit = viennit.slice(0, raja).map(({ t, v }) => ({
      tosite: t.id,
      tunniste: t.tunniste,
      pvm: v.pvm,
      tili: v.tili,
      debet: raha(v.debet),
      kredit: raha(v.kredit),
      alvKoodi: v.alvKoodi,
      alvProsentti: v.alvProsentti,
      selite: v.selite ?? null,
      otsikko: t.otsikko ?? null,
    }));
    return { lukumaara: viennit.length, viennit: rivit, rajattu: viennit.length > raja };
  },
});
