import { describe, expect, it } from 'vitest';
import { type EtusivunTiedot, etusivuHtml, varmenneHtml } from './ArkistoEtusivu';

const HASH = 'ab'.repeat(32);

function tiedot(muutokset: Partial<EtusivunTiedot> = {}): EtusivunTiedot {
  return {
    nimi: 'A&B Oy',
    ytunnus: '1234567-8',
    kausi: { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    arkistoitu: new Date(2026, 0, 5, 9, 7, 3).toISOString(),
    versio: '0.1.0',
    juuriTiiviste: HASH,
    vahvistettu: '2026-02-01',
    raportit: [
      { nimi: 'Tase', polku: 'raportit/tase.html' },
      { nimi: 'Tuloslaskelma', polku: 'raportit/tuloslaskelma.html' },
    ],
    alv: [{ nimi: 'Tammikuu 2025', polku: 'alv/alv-2025-01-01_2025-01-31.html' }],
    tositteita: 42,
    liitteita: 17,
    varoitukset: [],
    ...muutokset,
  };
}

describe('etusivuHtml', () => {
  const html = etusivuHtml(tiedot());

  it('on kokonainen skriptitön dokumentti, jossa nimi on escapattu', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('A&amp;B Oy');
    expect(html).not.toContain('A&B Oy');
    expect(html).not.toContain('<script');
    expect(html).toContain('1234567-8');
    expect(html).toContain('1.1.2025');
    expect(html).toContain('31.12.2025');
  });

  it('linkittää kaikki raportit, alv-ilmoitukset ja kirjanpidon sivut suhteellisesti', () => {
    for (const polku of [
      'raportit/tase.html',
      'raportit/tuloslaskelma.html',
      'alv/alv-2025-01-01_2025-01-31.html',
      'raportit/tilinpaatos.html',
      'raportit/taseerittely.html',
      'raportit/paakirja.html',
      'raportit/paivakirja.html',
      'raportit/tositeluettelo.html',
      'raportit/tililuettelo.html',
    ])
      expect(html).toContain(`href="${polku}"`);
    expect(html).not.toContain('href="/');
  });

  it('näyttää tositemäärän, juuritiivisteen code-elementissä ja varmennelinkin', () => {
    expect(html).toContain('42 tositetta, 17 liitettä.');
    expect(html).toContain(`<code>${HASH}</code>`);
    expect(html).toContain('href="arkistovarmenne.html"');
    expect(html).toContain('0.1.0');
  });

  it('käyttää yksikköä yhdelle tositteelle ja liitteelle', () => {
    expect(etusivuHtml(tiedot({ tositteita: 1, liitteita: 1 }))).toContain('1 tosite, 1 liite.');
    expect(etusivuHtml(tiedot({ tositteita: 0, liitteita: 0 }))).toContain(
      '0 tositetta, 0 liitettä.',
    );
  });

  it('kertoo vahvistamattomasta tilinpäätöksestä vain kun vahvistusta ei ole', () => {
    expect(html).not.toContain('Tilinpäätös vahvistamatta');
    expect(etusivuHtml(tiedot({ vahvistettu: null }))).toContain('Tilinpäätös vahvistamatta');
  });

  it('listaa varoitukset escapattuina ja jättää osion pois, kun niitä ei ole', () => {
    expect(html).not.toContain('Varoitukset');
    const v = etusivuHtml(tiedot({ varoitukset: ['Liite <x> ei täsmää'] }));
    expect(v).toContain('Varoitukset');
    expect(v).toContain('<li>Liite &lt;x&gt; ei täsmää</li>');
  });

  it('jättää alv-osion pois, kun ilmoituksia ei ole, ja y-tunnuksen, kun sitä ei ole', () => {
    const { ytunnus: _pois, ...ilmanYtunnusta } = tiedot({ alv: [] });
    const v = etusivuHtml(ilmanYtunnusta);
    expect(v).not.toContain('Arvonlisävero');
    expect(v).not.toContain('Y-tunnus');
  });
});

describe('varmenneHtml', () => {
  const html = varmenneHtml(tiedot());

  it('sisältää kauden, arkistointiajan paikallisena, tiivisteen ja tarkistusohjeen', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('A&amp;B Oy');
    expect(html).toContain('1.1.2025');
    expect(html).toContain('05.01.2026 09.07.03');
    expect(html).toContain(HASH);
    expect(html).toContain('sha256sum -c arkisto.sha256');
    expect(html).toContain('sha256sum arkisto.sha256');
    expect(html).toContain('<code>shasum -a 256 -c arkisto.sha256</code>');
    expect(html).toContain('<code>shasum -a 256 arkisto.sha256</code>');
    expect(html).toContain('<code>Get-FileHash arkisto.sha256 -Algorithm SHA256</code>');
    expect(html).not.toContain('<script');
  });

  it('linkittää takaisin etusivulle', () => {
    expect(html).toContain('href="index.html"');
  });
});
