import {
  type Tili,
  type Tilitapahtuma,
  TositeTila,
  type TyolistaRivi,
  type TyolistaTila,
  lataaKartta,
  lueTasmaysSaannot,
  muodostaTyolista,
  riviTositteeksi,
  siirraPaivia,
  tasmayksenPankkitili,
  nimi as tilinNimi,
  tyolistanTositeAsetukset,
} from '@penni/engine';
import type { Cents } from '@penni/euro';
import { z } from 'zod/v4';
import { TyokaluVirhe, maaritaTyokalu, pvmSchema, raha } from '../tyokalu.js';

const sentit = z.number().int();

const tilitapahtumaSchema = z.object({
  pvm: pvmSchema,
  nimi: z.string(),
  viite: z.string().optional(),
  maara: sentit, // etumerkillinen: negatiivinen = raha ulos
  viesti: z.string().optional(),
  alkuperainen: z.object({ valuutta: z.string(), maara: sentit }).optional(),
});

/** Luettu tiliote (`@penni/luku` lueTiliotePdf -> engine Tiliote), rahat sentteinä. */
const tilioteSchema = z.object({
  muoto: z.enum(['kuukausitiliote', 'tapahtumat']).optional(),
  kausi: z.object({ alkaa: pvmSchema, loppuu: pvmSchema }).optional(),
  alkusaldo: sentit.optional(),
  loppusaldo: sentit.optional(),
  tapahtumat: z.array(tilitapahtumaSchema),
});

/** Skeeman tapahtuma moottorin Tilitapahtumaksi (sentit brändätyksi Cents-tyypiksi). */
function tapahtumaksi(t: z.output<typeof tilitapahtumaSchema>): Tilitapahtuma {
  return {
    pvm: t.pvm,
    nimi: t.nimi,
    maara: t.maara as Cents,
    ...(t.viite !== undefined ? { viite: t.viite } : {}),
    ...(t.viesti !== undefined ? { viesti: t.viesti } : {}),
    ...(t.alkuperainen !== undefined
      ? {
          alkuperainen: { valuutta: t.alkuperainen.valuutta, maara: t.alkuperainen.maara as Cents },
        }
      : {}),
  };
}

function tiliNimi(chart: readonly Tili[], numero: number): string | null {
  const tili = chart.find((t) => t.numero === numero);
  return tili ? tilinNimi(tili) : null;
}

interface RiviTulos {
  nro: number;
  pvm: string;
  nimi: string;
  viite: string | null;
  maara: ReturnType<typeof raha>;
  tila: TyolistaTila;
  kirjattu: boolean;
  kirjattuTunniste: string | null;
  ehdotus: {
    tili: number;
    tilinNimi: string | null;
    alvKoodi: number;
    alvProsentti: number;
    otsikko: string | null;
    peruste: string;
  } | null;
  luonnos: number | null;
  /** Luonnoksen luonnin virhe (vain --luonnokset); rivikohtainen, ei keskeytä muita rivejä. */
  virhe: string | null;
}

function riviTulokseksi(rivi: TyolistaRivi, nro: number, chart: readonly Tili[]): RiviTulos {
  const { tapahtuma, ehdotus } = rivi;
  return {
    nro,
    pvm: tapahtuma.pvm,
    nimi: tapahtuma.nimi,
    viite: tapahtuma.viite ?? null,
    maara: raha(tapahtuma.maara),
    tila: rivi.tila,
    kirjattu: rivi.tila === 'joKirjattu',
    kirjattuTunniste: rivi.kirjattuTunniste ?? null,
    ehdotus: ehdotus
      ? {
          tili: ehdotus.tili,
          tilinNimi: tiliNimi(chart, ehdotus.tili),
          alvKoodi: ehdotus.alvKoodi,
          alvProsentti: ehdotus.alvProsentti,
          otsikko: ehdotus.otsikko ?? null,
          peruste: ehdotus.peruste,
        }
      : null,
    luonnos: null,
    virhe: null,
  };
}

/**
 * Tiliotteen täsmäytys kirjanpitoon — sama moottorin polku (`muodostaTyolista`) kuin
 * työpöydän Täsmäytys-näkymässä. Työkalu ottaa JO LUETUN tiliotteen (kausi, saldot,
 * tapahtumat), ei tiedostoa: PDF:n lukee kutsuja (CLI) levyltä `@penni/luku`-paketilla.
 */
export const tiliote = maaritaTyokalu({
  nimi: 'tiliote',
  kuvaus:
    'Täsmäyttää luetun pankin tiliotteen kirjanpitoon. Syötteet: tiliote (kausi, alkusaldo, ' +
    'loppusaldo ja tapahtumat sentteinä), tili (valinnainen pankkitilin numero; oletus kirjan ' +
    'täsmäytyksen pankkitili) ja luonnokset (valinnainen; true luo kirjaamattomista riveistä ' +
    'luonnostositteet). Palauttaa saldotarkistukset (tapahtumien summa = loppusaldo − ' +
    'alkusaldo; tiliotteen alkusaldo = kirjanpidon pankkisaldo kautta edeltävänä päivänä) ja ' +
    'jokaisesta tapahtumasta tilan: joKirjattu (sama summa kirjattu pankkitilille ±2 päivää; ' +
    'kirjattuTunniste kertoo tositteen), kuittiPuuttuu tai omaPaaoma, sekä kirjaushistorian ' +
    'ehdotuksen (tili, alvKoodi, alvProsentti, otsikko). Luonnokset luodaan kuten työpöydän ' +
    'täsmäytysnäkymässä: kirjaamattomat rivit omaa pääomaa lukuun ottamatta, ehdotuksen tilillä ' +
    'ja alv-koodilla; luotujen luonnosten id:t palautetaan riveillä.',
  kirjoittava: true,
  syote: z.object({
    tiliote: tilioteSchema,
    tili: z.number().int().optional(),
    luonnokset: z.boolean().optional(),
  }),
  async suorita(client, syote) {
    const init = await client.haeInit();
    const chart = lataaKartta(init.tilit);
    const saannot = lueTasmaysSaannot(init.asetukset);
    const pankkitili = syote.tili ?? tasmayksenPankkitili(init.asetukset, chart);
    if (pankkitili === undefined)
      throw new TyokaluVirhe(
        'EIPANKKITILIA',
        'Kirjasta ei löydy pankkitiliä; anna pankkitilin numero (tili).',
      );
    if (!chart.some((t) => t.numero === pankkitili))
      throw new TyokaluVirhe('TILIPUUTTUU', `Tiliä ${pankkitili} ei ole tilikartassa.`);

    const lue = syote.tiliote;
    const tapahtumat = lue.tapahtumat.map(tapahtumaksi);
    const tyolista = await muodostaTyolista(
      client,
      {
        tapahtumat,
        ...(lue.kausi ? { kausi: lue.kausi } : {}),
        ...(lue.alkusaldo !== undefined ? { alkusaldo: lue.alkusaldo as Cents } : {}),
      },
      [],
      { pankkitili, chart, saannot },
    );

    const summa = tapahtumat.reduce((s, t) => s + t.maara, 0);
    const saldot =
      lue.alkusaldo !== undefined && lue.loppusaldo !== undefined
        ? {
            alkusaldo: raha(lue.alkusaldo as Cents),
            loppusaldo: raha(lue.loppusaldo as Cents),
            tapahtumienSumma: raha(summa as Cents),
            tasmaa: summa === lue.loppusaldo - lue.alkusaldo,
            erotus: raha((lue.loppusaldo - lue.alkusaldo - summa) as Cents),
          }
        : null;
    const kirjanpito =
      lue.kausi && lue.alkusaldo !== undefined && tyolista.kirjanpidonAlkusaldo !== undefined
        ? {
            pvm: siirraPaivia(lue.kausi.alkaa, -1),
            saldo: raha(tyolista.kirjanpidonAlkusaldo),
            tasmaa: tyolista.kirjanpidonAlkusaldo === lue.alkusaldo,
            erotus: raha((lue.alkusaldo - tyolista.kirjanpidonAlkusaldo) as Cents),
          }
        : null;

    const rivit = tyolista.rivit.map((r, i) => riviTulokseksi(r, i + 1, chart));
    const luodut: number[] = [];
    if (syote.luonnokset === true) {
      const asetukset = tyolistanTositeAsetukset(pankkitili, saannot);
      for (const [i, rivi] of tyolista.rivit.entries()) {
        if (!rivi.valittu) continue;
        const tulos = rivit[i] as RiviTulos;
        try {
          const syoteTosite = riviTositteeksi(rivi, chart, asetukset);
          // Agenttirajapinta luo vain luonnoksia, vaikka moottorin muunto muuttuisi.
          const tosite = await client.luoTosite({ ...syoteTosite, tila: TositeTila.LUONNOS });
          tulos.luonnos = tosite.id;
          luodut.push(tosite.id);
        } catch (virhe) {
          tulos.virhe = virhe instanceof Error ? virhe.message : String(virhe);
        }
      }
    }

    const lukumaarat: Record<TyolistaTila, number> = {
      joKirjattu: 0,
      valmis: 0,
      nimitasmays: 0,
      kuittiPuuttuu: 0,
      omaPaaoma: 0,
    };
    for (const r of rivit) lukumaarat[r.tila] += 1;

    return {
      pankkitili: { numero: pankkitili, nimi: tiliNimi(chart, pankkitili) },
      muoto: lue.muoto ?? null,
      kausi: lue.kausi ?? null,
      saldot,
      kirjanpito,
      lukumaarat,
      rivit,
      luonnokset: syote.luonnokset === true ? luodut : null,
    };
  },
});
