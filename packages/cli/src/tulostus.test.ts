import { describe, expect, it } from 'vitest';
import { tulostaIhmiselle } from './tulostus.js';

function io() {
  const out: string[] = [];
  return { out, io: { stdout: (s: string) => out.push(s), stderr: (_s: string) => {} } };
}

describe('tulostaIhmiselle', () => {
  it('renders the array property as a table even when other scalar keys sit beside it', () => {
    const { out, io: streams } = io();
    tulostaIhmiselle(
      'tilit_haku',
      {
        tilit: [
          { numero: 1900, nimi: 'Pankki', tyyppi: 'ARP' },
          { numero: 3000, nimi: 'Myynti', tyyppi: 'T' },
        ],
        rajattu: false,
      },
      streams,
    );
    const teksti = out.join('');
    // Table, not the array dumped inline as JSON on one line.
    expect(teksti).not.toContain('[{');
    expect(teksti).toContain('numero');
    expect(teksti).toContain('nimi');
    expect(teksti).toContain('1900');
    expect(teksti).toContain('Pankki');
    expect(teksti).toContain('3000');
    // The remaining scalar property trails as an avain: arvo line.
    expect(teksti).toContain('rajattu: false');
  });

  it('still renders a single array-of-objects result as a bare table', () => {
    const { out, io: streams } = io();
    tulostaIhmiselle(
      'tilikaudet',
      { tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31', lukittu: false }] },
      streams,
    );
    const teksti = out.join('');
    expect(teksti).toContain('alkaa');
    expect(teksti).toContain('2026-01-01');
  });

  it('falls back to avain: arvo lines when nothing is a single array-of-objects property', () => {
    const { out, io: streams } = io();
    tulostaIhmiselle('perustiedot', { nimi: 'Testi Oy', ytunnus: 'x', muoto: 'oy' }, streams);
    const teksti = out.join('');
    expect(teksti).toBe('nimi: Testi Oy\nytunnus: x\nmuoto: oy\n');
  });

  it('omits empty (null, undefined, empty string) fields from avain: arvo lines', () => {
    const { out, io: streams } = io();
    tulostaIhmiselle(
      'saldot',
      { pvm: '2026-06-30', alkupvm: null, saldot: [{ tili: 1910, eur: '1,00 €' }] },
      streams,
    );
    const teksti = out.join('');
    expect(teksti).toContain('pvm: 2026-06-30');
    expect(teksti).not.toContain('alkupvm');

    const toinen = io();
    tulostaIhmiselle('perustiedot', { nimi: 'Testi Oy', ytunnus: null, muoto: '' }, toinen.io);
    expect(toinen.out.join('')).toBe('nimi: Testi Oy\n');
  });

  it('renders several array-of-objects properties as headed tables after the scalars', () => {
    const { out, io: streams } = io();
    tulostaIhmiselle(
      'tosite',
      {
        id: 7,
        otsikko: 'Kuitti',
        kumppani: null,
        viennit: [{ tili: 4000, alvKoodi: 26 }],
        liitteet: [{ id: 1, nimi: 'kuitti.pdf', koko: 5 }],
      },
      streams,
    );
    const teksti = out.join('');
    expect(teksti).toContain('id: 7\notsikko: Kuitti\n');
    expect(teksti).not.toContain('kumppani');
    expect(teksti).toContain('\nviennit:\ntili  alvKoodi\n4000        26\n');
    expect(teksti).toContain('\nliitteet:\nid  nimi        koko\n 1  kuitti.pdf     5\n');
    expect(teksti).not.toContain('[{');
  });

  it('prints an empty array as an avain: (ei rivejä) line instead of a table', () => {
    const { out, io: streams } = io();
    tulostaIhmiselle('tosite_luonnos', { id: 3, tila: 50, varoitukset: [] }, streams);
    expect(out.join('')).toBe('id: 3\ntila: 50\nvaroitukset: (ei rivejä)\n');

    const toinen = io();
    tulostaIhmiselle('tilit_haku', { tilit: [], rajattu: false }, toinen.io);
    expect(toinen.out.join('')).toBe('tilit: (ei rivejä)\nrajattu: false\n');
  });

  it('flattens nested objects to avain=arvo pairs and primitive arrays to a comma list', () => {
    const { out, io: streams } = io();
    tulostaIhmiselle(
      'tiliote',
      {
        pankkitili: { numero: 1910, nimi: 'Pankkitili' },
        saldot: { alkusaldo: { sentit: 0, eur: '0,00 €' }, tasmaa: true, huom: null },
        luonnokset: [4, 5],
      },
      streams,
    );
    expect(out.join('')).toBe(
      'pankkitili: numero=1910, nimi=Pankkitili\nsaldot: alkusaldo=0,00 €, tasmaa=true\nluonnokset: 4, 5\n',
    );
  });
});
