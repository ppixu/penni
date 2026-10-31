import type { Liite, LiiteMeta, UusiLiite } from '@penni/engine';
import { base64ToBytes, bytesToBase64 } from '../wire/base64.js';

function numeroi(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}

/** Wire -> rich metadata (no blob). Coerces id/tosite to numbers. */
export function decodeLiiteMeta(w: Record<string, unknown>): LiiteMeta {
  const { id: _wireId, data: _data, ...rest } = w;
  const meta = { ...rest, tosite: numeroi(w.tosite) } as LiiteMeta;
  if (w.id != null) meta.id = numeroi(w.id);
  return meta;
}

/** Wire -> rich full record: metadata + base64-decoded data. */
export function decodeLiite(w: Record<string, unknown>): Liite {
  const meta = decodeLiiteMeta(w);
  return {
    ...meta,
    id: meta.id ?? 0,
    data: base64ToBytes(typeof w.data === 'string' ? w.data : ''),
  };
}

/** Rich metadata -> wire (identity; already wire-shaped). */
export function encodeLiiteMeta(l: LiiteMeta): Record<string, unknown> {
  return { ...l };
}

/** Rich full record -> wire: metadata + base64 data. */
export function encodeLiite(l: Liite | UusiLiite): Record<string, unknown> {
  const { data, ...meta } = l;
  return { ...meta, data: bytesToBase64(data) };
}
