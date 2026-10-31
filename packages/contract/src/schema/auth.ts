import { z } from 'zod';

export const KayttajaSchema = z.object({
  id: z.number(),
  email: z.string(),
  nimi: z.string().optional(),
});

export const RekisterointiSyoteSchema = z.object({
  email: z.string(),
  salasana: z.string(),
  nimi: z.string().optional(),
});

export const KirjautuminenSyoteSchema = z.object({
  email: z.string(),
  salasana: z.string(),
});

export const TunnistusVastausSchema = z.object({
  kayttaja: KayttajaSchema,
  token: z.string(),
});

export const MinaVastausSchema = z.object({ kayttaja: KayttajaSchema });

export const SalasananVaihtoSyoteSchema = z.object({
  vanhaSalasana: z.string(),
  uusiSalasana: z.string(),
});
