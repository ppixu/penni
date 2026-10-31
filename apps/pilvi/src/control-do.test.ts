import { env } from 'cloudflare:test';
import { runControlConformance } from '@penni/control/conformance';
import { describe, expect, it } from 'vitest';
import { kontrolliStubista } from './control-do.js';

/** Tuore Control DO jokaiselle tapaukselle; kutsut kulkevat RPC:n yli kuten Workerissa. */
const tuore = () => kontrolliStubista(env.CONTROL.get(env.CONTROL.newUniqueId()));

// 5a:n jaettu ControlStore-orakkeli (sama kuin muisti- ja Postgres-adaptereille).
runControlConformance('ControlDO (DO SQLite, RPC)', tuore);

describe('ControlDO: jäsenyys', () => {
  it('kirjaa jäsenyyden idempotentisti ja erottaa käyttäjät ja kirjat', async () => {
    const control = tuore();
    const aika = '2026-06-01T00:00:00.000Z';
    const a = await control.luoKayttaja({ email: 'a@esimerkki.fi', salasanaHash: 'h', aika });
    const b = await control.luoKayttaja({ email: 'b@esimerkki.fi', salasanaHash: 'h', aika });
    await control.lisaaJasenyys(a.id, 'kirja-1');
    await control.lisaaJasenyys(a.id, 'kirja-1');
    expect(await control.onJasen(a.id, 'kirja-1')).toBe(true);
    expect(await control.onJasen(a.id, 'kirja-2')).toBe(false);
    expect(await control.onJasen(b.id, 'kirja-1')).toBe(false);
  });
});
