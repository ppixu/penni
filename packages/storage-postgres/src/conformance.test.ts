import {
  type ConformanceSeed,
  runKohdennusConformance,
  runResourceConformance,
} from '@penni/engine/conformance';
import { luoPglite } from './ajuri.js';
import { createPostgresStorage } from './postgres.js';

runResourceConformance('@penni/storage-postgres', async (seed: ConformanceSeed) =>
  createPostgresStorage(await luoPglite(), seed),
);

runKohdennusConformance('@penni/storage-postgres', async (seed: ConformanceSeed) =>
  createPostgresStorage(await luoPglite(), seed),
);
