import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';

describe('@penni/engine', () => {
  it('can use @penni/euro', () => {
    expect(Euro.toString(Euro.fromCents(12345))).toBe('123.45');
  });
});
