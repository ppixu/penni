import { describe, expect, it } from 'vitest';
import { onkoKumppaniViitattu } from './kumppaniViitattu.js';

describe('onkoKumppaniViitattu', () => {
  it('true kun kumppania viitataan myyntilaskulla (asiakasId)', () => {
    expect(onkoKumppaniViitattu(7, [{ asiakasId: 7 }], [])).toBe(true);
  });
  it('true kun kumppania viitataan ostolaskulla (kumppani)', () => {
    expect(onkoKumppaniViitattu(7, [], [{ kumppani: 7 }])).toBe(true);
  });
  it('false kun kumppania ei viitata kummallakaan', () => {
    expect(onkoKumppaniViitattu(7, [{ asiakasId: 3 }], [{ kumppani: 9 }])).toBe(false);
  });
  it('false tyhjillä listoilla', () => {
    expect(onkoKumppaniViitattu(7, [], [])).toBe(false);
  });
});
