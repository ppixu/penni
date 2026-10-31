import { luoPglite } from './ajuri.js';
import { runControlConformance } from './conformance.js';
import { luoPostgresControlStore } from './postgres.js';

runControlConformance('@penni/control postgres', async () =>
  luoPostgresControlStore(await luoPglite()),
);
