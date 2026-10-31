import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import {
  KirjautuminenSyoteSchema,
  MinaVastausSchema,
  RekisterointiSyoteSchema,
  SalasananVaihtoSyoteSchema,
  TunnistusVastausSchema,
} from './schema/auth.js';
import { WireVirheSchema } from './schema/wire.js';

const c = initContract();

export const authContract = c.router({
  rekisteroi: {
    method: 'POST',
    path: '/register',
    body: RekisterointiSyoteSchema,
    responses: { 201: TunnistusVastausSchema, 400: WireVirheSchema, 409: WireVirheSchema },
  },
  kirjaudu: {
    method: 'POST',
    path: '/login',
    body: KirjautuminenSyoteSchema,
    responses: { 200: TunnistusVastausSchema, 401: WireVirheSchema },
  },
  kirjauduUlos: {
    method: 'POST',
    path: '/logout',
    body: z.object({}).passthrough(),
    responses: { 200: z.null(), 401: WireVirheSchema },
  },
  mina: {
    method: 'GET',
    path: '/me',
    responses: { 200: MinaVastausSchema, 401: WireVirheSchema },
  },
  vaihdaSalasana: {
    method: 'POST',
    path: '/vaihda-salasana',
    body: SalasananVaihtoSyoteSchema,
    responses: { 200: z.null(), 400: WireVirheSchema, 401: WireVirheSchema },
  },
});
