import type { TilinpaatosDoc } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { decodeTilinpaatosDoc, encodeTilinpaatosDoc } from './tilinpaatos.js';

describe('tilinpaatos codec', () => {
  it('round-trips a document (report rows carry cents money)', () => {
    const doc: TilinpaatosDoc = {
      tilikausi: { alkaa: '2026-01-01', loppuu: '2026-12-31' },
      muoto: 'yleinen',
      tuloslaskelma: [
        { teksti: 'Liikevaihto', sisennys: 0, lihava: false, arvo: Euro.fromCents(100_000) },
      ],
      tase: [{ teksti: 'Pankkitili', sisennys: 0, lihava: false, arvo: Euro.fromCents(100_000) }],
      liitetiedot: 'Yhtiö...',
      vahvistettu: '2027-01-10',
    };
    const back = decodeTilinpaatosDoc(encodeTilinpaatosDoc(doc));
    expect(back.tuloslaskelma[0]?.arvo).toBe(Euro.fromCents(100_000));
    expect(back.vahvistettu).toBe('2027-01-10');
    expect(back.liitetiedot).toBe('Yhtiö...');
    expect(back.muoto).toBe('yleinen');
  });

  it('round-trips a null vahvistettu', () => {
    const doc: TilinpaatosDoc = {
      tilikausi: { alkaa: '2026-01-01', loppuu: '2026-12-31' },
      muoto: 'yleinen',
      tuloslaskelma: [],
      tase: [],
      liitetiedot: '',
      vahvistettu: null,
    };
    expect(decodeTilinpaatosDoc(encodeTilinpaatosDoc(doc)).vahvistettu).toBeNull();
  });
});
