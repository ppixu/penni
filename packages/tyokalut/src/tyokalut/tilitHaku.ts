import { z } from 'zod/v4';
import { hakuMuoto, maaritaTyokalu, nimiTekstina } from '../tyokalu.js';

const RAJA = 50;

export const tilitHaku = maaritaTyokalu({
  nimi: 'tilit_haku',
  kuvaus:
    'Hae tilikartasta tilejä nimellä (osuma nimen osaan) tai tilinumeron alulla. Käytä kun ' +
    'etsitään tiliä tai kysytään kuinka monta tiliä hakuun osuu — lukumaara-kenttä kertoo ' +
    'osumien kokonaismäärän. Ilman hakua palauttaa alun tilikartasta. Tilien rahamäärät ' +
    'haetaan saldot-työkalulla.',
  kirjoittava: false,
  syote: z.object({ haku: z.string().optional() }),
  async suorita(client, syote) {
    const init = await client.haeInit();
    const haku = hakuMuoto(syote.haku ?? '');
    const rivit = init.tilit
      .map((t) => ({
        numero: Number((t as Record<string, unknown>).numero),
        nimi: nimiTekstina((t as Record<string, unknown>).nimi),
        tyyppi: String((t as Record<string, unknown>).tyyppi ?? ''),
      }))
      .filter((t) => Number.isFinite(t.numero) && !String(t.tyyppi).startsWith('H'))
      .filter(
        (t) => haku === '' || hakuMuoto(t.nimi).includes(haku) || String(t.numero).startsWith(haku),
      );
    return { lukumaara: rivit.length, tilit: rivit.slice(0, RAJA), rajattu: rivit.length > RAJA };
  },
});
