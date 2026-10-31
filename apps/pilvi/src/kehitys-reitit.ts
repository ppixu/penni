// Kehitysreitit /api/kirjat/:kirjaId/kehitys/* (vain paikallinen kehitys ja mittaus). Kutsutaan
// jäsenyystarkistuksen jälkeen, joten kuten muutkin kirjareitit nämä vaativat kirjautuneen jäsenen.
import { laskuritPaalla, nollaaWorkerLaskurit, tuontiPaalla, workerLaskurit } from './kehitys.js';
import type { KehitysEnv } from './kehitys.js';
import type { KirjaDO, TuotuLiiteRivi } from './kirja-do.js';

const EI_LOYDY = (): Response =>
  Response.json({ virhe: 'Reittiä ei löydy', koodi: 'EI_LOYDY' }, { status: 404 });

/** Liiterivin metatieto kulkee otsakkeessa (URI-koodattu JSON), tavut pyynnön runkona. */
export const LIITE_RIVI_OTSAKE = 'x-liite-rivi';

export async function kehitysReitti(
  request: Request,
  env: KehitysEnv,
  kirja: DurableObjectStub<KirjaDO>,
  kirjaId: string,
  loppu: string,
): Promise<Response> {
  try {
    return await reitti(request, env, kirja, kirjaId, loppu);
  } catch (e) {
    // Kehitysreitit ovat vain mittausskriptille: virhe näytetään sellaisenaan (ei lokimelua).
    return Response.json(
      { virhe: e instanceof Error ? e.message : String(e), koodi: 'KEHITYS_VIRHE' },
      { status: 400 },
    );
  }
}

async function reitti(
  request: Request,
  env: KehitysEnv,
  kirja: DurableObjectStub<KirjaDO>,
  kirjaId: string,
  loppu: string,
): Promise<Response> {
  const polku = loppu.split('?')[0] ?? '';
  const metodi = request.method;
  const tuonti = tuontiPaalla(env);
  const laskurit = laskuritPaalla(env);

  if (tuonti && metodi === 'POST' && polku === '/kehitys/tuonti/rivit') {
    const { taulu, sarakkeet, rivit } = (await request.json()) as {
      taulu: string;
      sarakkeet: string[];
      rivit: (string | number | null)[][];
    };
    return Response.json({ tuotu: await kirja.kehitysTuoRivit(taulu, sarakkeet, rivit) });
  }
  if (tuonti && metodi === 'POST' && polku === '/kehitys/tuonti/liite') {
    const rivi = JSON.parse(
      decodeURIComponent(request.headers.get(LIITE_RIVI_OTSAKE) ?? 'null'),
    ) as TuotuLiiteRivi;
    await kirja.kehitysTuoLiite(kirjaId, rivi, await request.arrayBuffer());
    return Response.json({ tuotu: 1 });
  }
  if (tuonti && metodi === 'GET' && polku === '/kehitys/yhteenveto') {
    return Response.json(await kirja.kehitysYhteenveto());
  }
  if (tuonti && metodi === 'POST' && polku === '/kehitys/lokimaarat') {
    const { ids } = (await request.json()) as { ids: number[] };
    return Response.json(await kirja.kehitysLokimaarat(ids));
  }
  if (laskurit && polku === '/kehitys/laskurit' && (metodi === 'GET' || metodi === 'POST')) {
    const nollaa = metodi === 'POST';
    const kirjaLaskurit = await kirja.kehitysLaskurit(nollaa);
    return Response.json({
      worker: nollaa ? nollaaWorkerLaskurit() : workerLaskurit,
      kirja: kirjaLaskurit,
    });
  }
  return EI_LOYDY();
}
