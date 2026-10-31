import {
  type ControlStore,
  TunnistusVirhe,
  haeMinut,
  kirjaudu,
  kirjauduUlos,
  rekisteroi,
  vaihdaSalasana,
} from '@penni/control';
import type { FastifyRequest } from 'fastify';

function bearer(request: FastifyRequest): string {
  const otsake = request.headers.authorization ?? '';
  const token = otsake.toLowerCase().startsWith('bearer ') ? otsake.slice(7) : '';
  if (!token) throw new TunnistusVirhe('EI_SESSIOTA');
  return token;
}

/** authContract-käsittelijät kontrollivaraston yli. */
export function luoAuthKasittelijat(
  control: ControlStore,
  kello: () => string,
  sessionKestoMs?: number,
) {
  const a = { kello, ...(sessionKestoMs !== undefined ? { sessionKestoMs } : {}) };
  return {
    rekisteroi: async ({ body }: { body: { email: string; salasana: string; nimi?: string } }) => ({
      status: 201 as const,
      body: await rekisteroi(control, body, a),
    }),
    kirjaudu: async ({ body }: { body: { email: string; salasana: string } }) => ({
      status: 200 as const,
      body: await kirjaudu(control, body, a),
    }),
    kirjauduUlos: async ({ request }: { request: FastifyRequest }) => {
      await kirjauduUlos(control, bearer(request));
      return { status: 200 as const, body: null };
    },
    mina: async ({ request }: { request: FastifyRequest }) => ({
      status: 200 as const,
      body: { kayttaja: await haeMinut(control, bearer(request), a) },
    }),
    vaihdaSalasana: async ({
      request,
      body,
    }: { request: FastifyRequest; body: { vanhaSalasana: string; uusiSalasana: string } }) => {
      const k = await haeMinut(control, bearer(request), a);
      await vaihdaSalasana(control, k.id, body, a);
      return { status: 200 as const, body: null };
    },
  };
}
