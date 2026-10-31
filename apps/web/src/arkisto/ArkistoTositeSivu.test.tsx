import { ArkistoLinkitContext, type ArkistoLinkkiKohde } from '@/components/Linkki';
import { AlvKoodi, type StoredTosite, type Tili, lataaKartta } from '@penni/engine';
import { Euro } from '@penni/euro';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type ArkistoLiite, ArkistoTositeSivu } from './ArkistoTositeSivu';

const kartta = (k: ArkistoLinkkiKohde) =>
  k.to === '/tilikartta' ? `../raportit/paakirja.html#tili-${String(k.search?.tili)}` : null;

const TILIT: ReadonlyMap<number, Tili> = new Map(
  lataaKartta([
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 4000, tyyppi: 'BC', nimi: { fi: 'Ostot' } },
  ]).map((t) => [t.numero, t]),
);

const LIITTEET: ArkistoLiite[] = [
  { nimi: 'kuitti.pdf', tyyppi: 'application/pdf', tiedosto: '2025--00000007_01.pdf' },
  { nimi: 'kuva.jpg', tyyppi: 'image/jpeg', tiedosto: '2025--00000007_02.jpg' },
];

function tosite(muutokset: Partial<StoredTosite> = {}): StoredTosite {
  return {
    id: 7,
    pvm: '2025-03-01',
    tyyppi: 0,
    tila: 100,
    otsikko: 'Kahvi <&>',
    sarja: '',
    tunniste: 7,
    viennit: [
      {
        tili: 1900,
        debet: Euro.fromCents(1240),
        kredit: Euro.fromCents(0),
        pvm: '2025-03-01',
        alvKoodi: AlvKoodi.EIALV,
        alvProsentti: 0,
        selite: 'Kahvi',
      },
      {
        tili: 4000,
        debet: Euro.fromCents(0),
        kredit: Euro.fromCents(1240),
        pvm: '2025-03-01',
        alvKoodi: AlvKoodi.OSTOT_NETTO,
        alvProsentti: 24,
      },
    ],
    ...muutokset,
  };
}

function piirra(t: StoredTosite, alv = false, liitteet: readonly ArkistoLiite[] = LIITTEET) {
  return render(
    <ArkistoLinkitContext.Provider value={kartta}>
      <ArkistoTositeSivu
        tosite={t}
        tilit={TILIT}
        kumppanit={new Map([[3, 'Kahvila Oy']])}
        tyyppiNimi="Kulu"
        liitteet={liitteet}
        alv={alv}
        jsonTiedosto="2025--00000007.json"
      />
    </ArkistoLinkitContext.Provider>,
  ).container;
}

describe('ArkistoTositeSivu', () => {
  it('näyttää otsikkotiedot ja ensimmäisen pdf/kuva-liitteen iframessa', () => {
    const c = piirra(tosite({ kumppani: 3 }));
    expect(c.textContent).toContain('Kahvi <&>');
    expect(c.textContent).toContain('1.3.2025');
    expect(c.textContent).toContain('Kulu');
    expect(c.textContent).toContain('7');
    expect(c.textContent).toContain('Kahvila Oy');
    const iframe = c.querySelector('iframe[name=liite]');
    expect(iframe?.getAttribute('src')).toBe('../liitteet/2025--00000007_01.pdf');
  });

  it('ei pidä iframea, ellei liitteissä ole pdf:ää tai kuvaa', () => {
    const c = piirra(tosite(), false, [
      { nimi: 'data.csv', tyyppi: 'text/csv', tiedosto: '2025--00000007_01.csv' },
    ]);
    expect(c.querySelector('iframe')).toBeNull();
    const nimi = Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'data.csv');
    expect(nimi).toBeUndefined();
    expect(c.textContent).toContain('data.csv');
    const avaa = Array.from(c.querySelectorAll('a')).filter((a) => a.textContent === 'Avaa');
    expect(avaa[0]?.getAttribute('href')).toBe('../liitteet/2025--00000007_01.csv');
  });

  it('listaa liitteet target="liite" -linkkeinä ja Avaa-linkkeinä ilman targetia', () => {
    const c = piirra(tosite());
    const nimet = Array.from(c.querySelectorAll('a[target=liite]'));
    expect(nimet.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['kuitti.pdf', '../liitteet/2025--00000007_01.pdf'],
      ['kuva.jpg', '../liitteet/2025--00000007_02.jpg'],
    ]);
    const avaa = Array.from(c.querySelectorAll('a')).filter((a) => a.textContent === 'Avaa');
    expect(avaa.map((a) => a.getAttribute('href'))).toEqual([
      '../liitteet/2025--00000007_01.pdf',
      '../liitteet/2025--00000007_02.jpg',
    ]);
    expect(avaa.every((a) => !a.hasAttribute('target'))).toBe(true);
  });

  it('linkittää tilin pääkirjan ankkuriin ja näyttää loppusummat', () => {
    const c = piirra(tosite());
    const linkki = Array.from(c.querySelectorAll('a')).find((a) =>
      a.textContent?.startsWith('1900'),
    );
    expect(linkki?.getAttribute('href')).toBe('../raportit/paakirja.html#tili-1900');
    expect(linkki?.textContent).toBe('1900 Pankkitili');
    const summat = Array.from(c.querySelectorAll('tfoot td')).map((td) => td.textContent);
    expect(summat.filter((s) => s === '12,40 €')).toHaveLength(2);
  });

  it('näyttää Alv-sarakkeen vain alv-velvolliselle', () => {
    expect(piirra(tosite(), false).textContent).not.toContain('Alv');
    const c = piirra(tosite(), true);
    expect(Array.from(c.querySelectorAll('th')).map((th) => th.textContent)).toContain('Alv');
    expect(c.textContent).toContain('24 %');
  });

  it('näyttää laskun kentät vain kun ne on annettu ja laskupvm vain jos se poikkeaa pvm:stä', () => {
    expect(piirra(tosite()).textContent).not.toContain('Eräpäivä');
    expect(piirra(tosite()).textContent).not.toContain('Laskun numero');
    const c = piirra(
      tosite({
        numero: '1001',
        laskupvm: '2025-03-01',
        erapvm: '2025-03-15',
        viite: '1234561',
      }),
    );
    const t = c.textContent ?? '';
    expect(t).toContain('Laskun numero');
    expect(t).toContain('1001');
    expect(t).not.toContain('Laskun päivämäärä');
    expect(t).toContain('Eräpäivä');
    expect(t).toContain('15.3.2025');
    expect(t).toContain('Viite');
    expect(t).toContain('1234561');
    expect(piirra(tosite({ laskupvm: '2025-02-20' })).textContent).toContain('Laskun päivämäärä');
  });

  it('linkittää tositteen täydet tiedot .json-tiedostoon', () => {
    const c = piirra(tosite());
    const a = Array.from(c.querySelectorAll('a')).find(
      (x) => x.textContent === 'Tositteen täydet tiedot',
    );
    expect(a?.getAttribute('href')).toBe('2025--00000007.json');
  });
});
