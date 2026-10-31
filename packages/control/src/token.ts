import { createHash, randomBytes } from 'node:crypto';

/** Läpinäkymätön sessiotoken. Palautetaan asiakkaalle vain kerran. */
export function luoToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Kantaan talletetaan vain tokenin SHA-256 (kantavuoto ≠ elävät sessiot). */
export function tiivistaToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
