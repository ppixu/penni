import { type ConformanceSeed, runResourceConformance } from '@penni/engine/conformance';
import { createSqliteStorage } from './sqlite.js';

runResourceConformance('@penni/storage-sqlite', (seed: ConformanceSeed) =>
  createSqliteStorage(seed),
);
