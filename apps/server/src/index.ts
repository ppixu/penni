import { createSqliteStorage } from '@penni/storage-sqlite';
import { luoPalvelin } from './palvelin.js';

export { luoPalvelin } from './palvelin.js';
export type { PalvelinOptions } from './palvelin.js';

/** Bootstrap: a self-hostable local-first server on storage-sqlite. PORT / PENNI_DB / PENNI_LAHDEKOODI_URL from env. */
function kaynnista(): void {
  const portti = Number(process.env.PORT ?? 3000);
  const tiedosto = process.env.PENNI_DB;
  const storage = createSqliteStorage({}, tiedosto ? { tiedosto } : {});
  const lahdekoodiUrl = process.env.PENNI_LAHDEKOODI_URL;
  const app = luoPalvelin(storage, { logger: true, ...(lahdekoodiUrl ? { lahdekoodiUrl } : {}) });

  app
    .listen({ port: portti, host: '0.0.0.0' })
    .then((osoite) => app.log.info(`Penni-palvelin kuuntelee: ${osoite}`))
    .catch((virhe) => {
      app.log.error(virhe);
      process.exit(1);
    });
}

// Run the bootstrap only when launched directly (node dist/index.js); importing the package as a
// library (e.g. the web conformance harness importing luoPalvelin) must NOT bind a socket.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  kaynnista();
}
