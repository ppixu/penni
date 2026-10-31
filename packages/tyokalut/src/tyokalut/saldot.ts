import type { Cents } from '@penni/euro';
import { z } from 'zod/v4';
import { hakuMuoto, maaritaTyokalu, nimiTekstina, pvmSchema, pvmTanaan, raha } from '../tyokalu.js';

export const saldot = maaritaTyokalu({
  nimi: 'saldot',
  kuvaus:
    'Tilien saldot eli rahamäärät. Käytä tätä aina kun kysytään paljonko rahaa tai velkaa ' +
    'jollakin tilillä tai tiliryhmässä on: pankkitili, käteiskassa, myyntisaamiset, ostovelat, ' +
    'alv-velka taseessa. (Oma pääoma, vieras pääoma ja taseen yhteissummat saat helpommin ' +
    'raportti-työkalun taseesta.) Syötteet: haku (valinnainen tilinimen osa tai tilinumeron ' +
    'alku, esim. haku: "käteis" — palauttaa vain osuvat tilit, saldottomatkin 0-riveinä; ' +
    'helpoin tapa löytää oikea tili), pvm (kauden loppupäivä YYYY-MM-DD, oletus tämä ' +
    'päivä), alkupvm ' +
    '(valinnainen kauden alkupäivä) ja tilit (valinnainen lista tilinumeroita, jolla tulos ' +
    'rajataan vain näihin tileihin). Taseen tilit (luokat 1–2) ovat aina kumulatiivisia tilin ' +
    'avaamisesta pvm:ään — alkupvm ei vaikuta niihin. Tulostilit (luokka 3 ja siitä ylöspäin, ' +
    'esim. myynti ja kulut) lasketaan oletuksena kuluvan tilikauden alusta pvm:ään, tai ' +
    'annetusta alkupvm:stä pvm:ään jos alkupvm on annettu. Palauttaa jokaisen tilin saldon ' +
    'nimineen sekä sentteinä että muotoiltuna euroina, tilinumeron mukaan järjestettynä.',
  kirjoittava: false,
  syote: z.object({
    haku: z.string().optional(),
    pvm: pvmSchema.optional(),
    alkupvm: pvmSchema.optional(),
    tilit: z.array(z.number().int()).optional(),
  }),
  async suorita(client, syote, env) {
    const pvm = syote.pvm ?? pvmTanaan(env);
    const [tulos, init] = await Promise.all([
      client.haeSaldot({
        pvm,
        ...(syote.alkupvm !== undefined ? { alkupvm: syote.alkupvm } : {}),
      }),
      client.haeInit(),
    ]);
    const nimet = new Map(
      init.tilit
        .filter((t) => !String((t as Record<string, unknown>).tyyppi ?? '').startsWith('H'))
        .map((t) => [
          Number((t as Record<string, unknown>).numero),
          nimiTekstina((t as Record<string, unknown>).nimi),
        ]),
    );
    const sallitut = syote.tilit ? new Set(syote.tilit) : null;
    const haku = syote.haku === undefined ? undefined : hakuMuoto(syote.haku);
    const osuuHakuun = (tili: number): boolean =>
      haku === undefined ||
      hakuMuoto(nimet.get(tili) ?? '').includes(haku) ||
      String(tili).startsWith(haku);
    // An explicitly requested account (tilit list or haku match) with no postings gets an
    // explicit 0-row: an empty result for a valid account reads as "tool failed" to the
    // calling model, not as a zero balance.
    const saldotKartta = new Map(tulos);
    if (sallitut !== null) {
      for (const tili of sallitut) {
        if (!saldotKartta.has(tili)) saldotKartta.set(tili, 0 as Cents);
      }
    }
    if (haku !== undefined) {
      for (const tili of nimet.keys()) {
        if (osuuHakuun(tili) && !saldotKartta.has(tili)) saldotKartta.set(tili, 0 as Cents);
      }
    }
    const rivit = [...saldotKartta.entries()]
      .filter(([tili]) => (sallitut === null || sallitut.has(tili)) && osuuHakuun(tili))
      .map(([tili, saldo]) => ({ tili, nimi: nimet.get(tili) ?? '', ...raha(saldo) }))
      .sort((a, b) => a.tili - b.tili);
    return { pvm, alkupvm: syote.alkupvm ?? null, saldot: rivit };
  },
});
