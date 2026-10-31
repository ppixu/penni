import type { Env } from '../index.js';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
