import { describe, expect, it } from 'vitest';
import type { SqliteAjuri } from './ajuri.js';

describe('@penni/storage-sqlite-core', () => {
  it('vie SqliteAjuri-tyypin', () => {
    const tyyppi: keyof SqliteAjuri = 'run';
    expect(tyyppi).toBe('run');
  });
});
