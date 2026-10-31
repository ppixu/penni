import { z } from 'zod/v4';
import { kaikkiTyokalut } from './rekisteri.js';

export function tyokalutJsonSchema(): {
  versio: 1;
  tyokalut: { nimi: string; kuvaus: string; kirjoittava: boolean; syote: unknown }[];
} {
  return {
    versio: 1,
    tyokalut: kaikkiTyokalut.map((t) => ({
      nimi: t.nimi,
      kuvaus: t.kuvaus,
      kirjoittava: t.kirjoittava,
      syote: z.toJSONSchema(t.syote),
    })),
  };
}
