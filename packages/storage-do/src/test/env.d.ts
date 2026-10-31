import type { KirjaDO } from '../kirja-do.js';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    KIRJA: DurableObjectNamespace<KirjaDO>;
    /** Testi-R2 (ei KirjaDO:n LIITTEET, ks. vitest.config.ts). */
    LIITETESTI: R2Bucket;
  }
}
