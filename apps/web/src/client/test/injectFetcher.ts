import type { ApiFetcher, ApiFetcherArgs } from '@ts-rest/core';
import type { FastifyInstance } from 'fastify';

/** A ts-rest ApiFetcher that dispatches through fastify.inject() instead of the network. */
export function injectFetcher(app: FastifyInstance): ApiFetcher {
  return async (args: ApiFetcherArgs) => {
    // args.path is a complete URL (baseUrl + path + encoded query). inject() wants path+search.
    const u = new URL(args.path);
    const res = await app.inject({
      method: args.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      url: u.pathname + u.search,
      headers: args.headers,
      ...(args.body != null ? { payload: args.body as string } : {}),
    });
    // ts-rest reads content-type off a real Headers to pick JSON vs text parsing.
    const headers = new Headers(res.headers as Record<string, string>);
    const ct = headers.get('content-type') ?? '';
    const body = ct.includes('json') ? (res.body ? JSON.parse(res.body) : null) : res.body;
    return { status: res.statusCode, body, headers };
  };
}
