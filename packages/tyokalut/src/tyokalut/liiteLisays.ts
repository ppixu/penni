import { base64ToBytes } from '@penni/contract';
import { z } from 'zod/v4';
import { TyokaluVirhe, maaritaTyokalu } from '../tyokalu.js';

/** Sama yläraja kuin sovelluksen liitelatauksessa (LiitteidenLataus: 10 Mt). */
export const LIITE_MAX_TAVUT = 10 * 1024 * 1024;

/** Sallitut liitetyypit ja niiden tiedostojen alkutavut (tyyppi tarkistetaan sisällöstä). */
const TUNNISTEET: Record<string, readonly number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function alkaa(tavut: Uint8Array, alku: readonly number[]): boolean {
  return alku.every((b, i) => tavut[i] === b);
}

async function sha256(tavut: Uint8Array): Promise<string> {
  const tiiviste = await crypto.subtle.digest('SHA-256', new Uint8Array(tavut));
  return [...new Uint8Array(tiiviste)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Liitteen lisäys tositteelle. Työkalu ottaa tiedoston SISÄLLÖN (base64), nimen ja MIME-tyypin
 * — ei koskaan tiedostopolkua: rekisterin työkaluja voi kutsua myös sovelluksen kielimalli, eikä
 * mallin syötteen saa antaa lukea levyltä mitä tahansa. Levyltä lukee vain kutsuja (CLI).
 */
export const liiteLisays = maaritaTyokalu({
  nimi: 'liite_lisays',
  kuvaus:
    'Liittää tiedoston (kuitti, lasku: PDF, JPEG tai PNG, enintään 10 Mt) tositteelle. ' +
    'Syötteet: tosite (tositteen id), nimi (tiedostonimi), tyyppi (application/pdf, ' +
    'image/jpeg tai image/png; tarkistetaan tiedoston sisällöstä) ja data (tiedoston sisältö ' +
    'base64-merkkijonona). Sallittu luonnokselle ja kirjatulle tositteelle, jonka päivä ei ole ' +
    'lukitulla kaudella (lukittu kausi: PVMLUKITTU). Liite ei muuta kirjanpitoa; lisäys ' +
    'kirjataan tositteen lokiin. Palauttaa liitteen id:n, nimen, tyypin, koon ja sha256-' +
    'tarkisteen.',
  kirjoittava: true,
  syote: z.object({
    tosite: z.number().int(),
    nimi: z
      .string()
      .min(1)
      .max(255)
      .refine((n) => !/[/\\\0]/.test(n), 'nimi on tiedostonimi ilman hakemistopolkua'),
    tyyppi: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    data: z.string().min(1),
  }),
  async suorita(client, syote, env) {
    const raaka = syote.data.replace(/\s+/g, '');
    if (raaka.length % 4 !== 0 || !BASE64.test(raaka))
      throw new TyokaluVirhe('SYOTE', 'data ei ole kelvollista base64-koodia.');
    const tavut = base64ToBytes(raaka);
    if (tavut.length === 0) throw new TyokaluVirhe('SYOTE', 'Tiedosto on tyhjä.');
    if (tavut.length > LIITE_MAX_TAVUT)
      throw new TyokaluVirhe('LIITE_LIIAN_SUURI', 'Liite on liian suuri (yli 10 Mt).');
    if (!alkaa(tavut, TUNNISTEET[syote.tyyppi] ?? []))
      throw new TyokaluVirhe(
        'TIEDOSTOTYYPPI',
        `Tiedoston sisältö ei ole ${syote.tyyppi}. Sallitut: PDF, JPEG ja PNG.`,
      );
    const sha = await sha256(tavut);
    const meta = await client.lisaaLiite({
      tosite: syote.tosite,
      nimi: syote.nimi,
      tyyppi: syote.tyyppi,
      sha,
      luotu: env.aika,
      data: tavut,
    });
    return {
      id: meta.id,
      tosite: meta.tosite,
      nimi: meta.nimi,
      tyyppi: meta.tyyppi,
      koko: tavut.length,
      sha,
    };
  },
});
