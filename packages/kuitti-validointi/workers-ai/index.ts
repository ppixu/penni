// Pelkkä läpivienti harnessille: POST /ajo {malli, syote} → env.AI.run(malli, syote).
// Kutsulaskuri ja katto ovat harnessin päässä (src/workersAi.ts), ei täällä.
interface Env {
  AI: { run(malli: string, syote: unknown): Promise<unknown> };
}

export default {
  async fetch(pyynto: Request, env: Env): Promise<Response> {
    if (pyynto.method !== 'POST' || new URL(pyynto.url).pathname !== '/ajo') {
      return new Response('POST /ajo', { status: 404 });
    }
    const { malli, syote } = (await pyynto.json()) as { malli: string; syote: unknown };
    try {
      return Response.json(await env.AI.run(malli, syote));
    } catch (e) {
      return new Response(e instanceof Error ? e.message : String(e), { status: 502 });
    }
  },
};
