import { AsyncLocalStorage } from 'node:async_hooks';

/** Pyyntökohtainen tunnistuskonteksti. Vahti asettaa userId:n, reititin lukee sen ResourceEnviin. */
export const tunnistusALS = new AsyncLocalStorage<{ userId: number }>();
