import { renderReitittimessa } from '@/test/renderReitittimessa';
import { type AlvErittely, type AlvErittelyRivi, lataaKartta } from '@penni/engine';
import { type Cents, Euro } from '@penni/euro';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AlvLaskelmaDokumentti,
  kitsasPvm,
  muotoileKanta,
  muotoileSumma,
} from './AlvLaskelmaDokumentti.js';

const c = (n: number): Cents => Euro.fromCents(n);
const KAUSI = { alkupvm: '2026-03-01', loppupvm: '2026-03-31' };
const TILIT = lataaKartta([
  { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
]);

const rivi = (
  osa: Pick<AlvErittelyRivi, 'alvKoodi' | 'tili' | 'summa'> & Partial<AlvErittelyRivi>,
): AlvErittelyRivi => ({
  kanta: 2550,
  pvm: '2026-03-10',
  tosite: 7,
  tositeNumero: '1',
  tositePvm: '2026-03-10',
  kumppani: 'Asiakas Oy',
  selite: 'Asiakas Oy',
  ...osa,
});

const ERITTELY: AlvErittely = {
  alkupvm: '2026-03-01',
  loppupvm: '2026-03-31',
  rivit: [
    rivi({ alvKoodi: 11, tili: 3000, summa: c(20000) }), // selite == kumppani -> tyhjä
    rivi({
      alvKoodi: 11,
      tili: 3000,
      summa: c(-5000),
      tosite: 8,
      tositeNumero: '2',
      pvm: '2026-03-12',
      selite: 'Hyvitys',
    }),
    rivi({ alvKoodi: 111, tili: 2939, summa: c(5100) }),
    {
      alvKoodi: 112,
      kanta: 2400,
      tili: 2939,
      pvm: '2026-03-31',
      tositeNumero: '',
      tositePvm: '2026-03-31',
      kumppani: '',
      selite: 'Bruttomyyntien oikaisu',
      summa: c(2400),
    },
  ],
};

const LASKELMA = {
  koodit: new Map<number, Cents>([
    [301, c(7500)],
    [308, c(7500)],
  ]),
  maksettava: c(7500),
};

function renderoi(erittely: AlvErittely = ERITTELY, nimi: string | null = 'Demo Oy') {
  return renderReitittimessa(
    <AlvLaskelmaDokumentti
      nimi={nimi ?? undefined}
      kausi={KAUSI}
      laskelma={LASKELMA}
      erittely={erittely}
      tilit={TILIT}
      auki={{ laskelma: true, erittely: true }}
      onVaihda={() => {}}
    />,
  );
}

describe('AlvLaskelmaDokumentti', () => {
  it('otsikko, yritys ja kausi; sarakeotsikot molemmissa taulukoissa', async () => {
    await renderoi();
    const doc = await screen.findByRole('article', { name: 'arvonlisäverolaskelma' });
    expect(within(doc).getByRole('heading', { name: 'Arvonlisäverolaskelma' })).toBeInTheDocument();
    expect(within(doc).getByText('Demo Oy')).toBeInTheDocument();
    expect(within(doc).getByText('01.03.2026 – 31.03.2026')).toBeInTheDocument();
    for (const nimi of ['alv-laskelma', 'alv-erittely']) {
      const taulu = within(doc).getByLabelText(nimi);
      expect(
        within(taulu)
          .getAllByRole('columnheader')
          .map((th) => th.textContent),
      ).toEqual(['Pvm', 'Tosite', 'Asiakas/Toimittaja', 'Selite', '%', '€']);
    }
  });

  it('ilmoituksen tiedot: koodi, nimi ja summa ilman €-merkkiä, 308 lihavoituna', async () => {
    await renderoi();
    const taulu = await screen.findByLabelText('alv-laskelma');
    expect(within(taulu).getByText('Arvonlisäveroilmoituksen tiedot')).toBeInTheDocument();
    const r301 = within(taulu)
      .getByText('Suoritettava 24% / 25,5%:n vero kotimaan myynnistä')
      .closest('tr');
    expect(r301).toHaveTextContent('301');
    expect(r301).toHaveTextContent('75,00');
    expect(r301).not.toHaveTextContent('€');
    expect(within(taulu).getByText('Maksettava vero / Palautukseen oikeuttava vero')).toHaveClass(
      'font-semibold',
    );
  });

  it('erittely: ryhmä-, tili-, vienti- ja välisummarivit Kitsaksen järjestyksessä', async () => {
    await renderoi();
    const taulu = await screen.findByLabelText('alv-erittely');
    expect(
      within(taulu)
        .getAllByRole('row')
        .map((r) => r.textContent),
    ).toEqual([
      'PvmTositeAsiakas/ToimittajaSelite%€',
      'Erittely',
      'Verollinen myynti (netto)25,50150,00',
      '3000 Myynti',
      '10.03.20261Asiakas Oy25,50200,00',
      '12.03.20262Asiakas OyHyvitys25,50−50,00',
      '25,50150,00',
      'VERON MÄÄRÄ Verollinen myynti (netto)25,5051,00',
      '2939 Alv-velka',
      '10.03.20261Asiakas Oy25,5051,00',
      '25,5051,00',
      'VERON MÄÄRÄ Verollinen myynti (brutto)24,0024,00',
      '2939 Alv-velka',
      '31.03.2026Bruttomyyntien oikaisu24,0024,00',
      '24,0024,00',
    ]);
    expect(within(taulu).getByText('Verollinen myynti (netto)').closest('tr')).toHaveClass(
      'font-semibold',
    );
    const hyvitys = within(taulu).getByText('Hyvitys').closest('tr') as HTMLElement;
    expect(within(hyvitys).getByRole('link', { name: '2' })).toHaveAttribute(
      'href',
      '/tositteet/8',
    );
    // Oikaisurivillä ei ole tositetta eikä linkkiä.
    const oikaisu = within(taulu).getByText('Bruttomyyntien oikaisu').closest('tr') as HTMLElement;
    expect(within(oikaisu).queryByRole('link')).not.toBeInTheDocument();
  });

  it('pitkä selite ja kumppani rivittyvät kokonaisina eikä typisty', async () => {
    const selite = 'Bruttomyyntien oikaisu 3000 Myynti BRUTTO 124,00 €, NETTO 100,00 €';
    const kumppani = 'Erittäin Pitkä Asiakasyhtiö Osakeyhtiö Suomen Haaraliike';
    await renderoi({
      ...ERITTELY,
      rivit: [rivi({ alvKoodi: 112, tili: 2939, summa: c(2400), selite, kumppani })],
    });
    const taulu = await screen.findByLabelText('alv-erittely');
    for (const teksti of [selite, kumppani]) {
      const solu = within(taulu).getByText(teksti);
      expect(solu).toHaveClass('break-words');
      expect(solu).not.toHaveClass('truncate');
    }
  });

  it('tulosteessa ryhmä- ja tilin otsikkorivi pysyy yhdessä ensimmäisen rivinsä kanssa', async () => {
    await renderoi();
    const taulu = await screen.findByLabelText('alv-erittely');
    const rivi = (teksti: string) =>
      within(taulu).getAllByText(teksti)[0]?.closest('tr') as HTMLElement;
    expect(rivi('Verollinen myynti (netto)')).toHaveClass('print:break-after-avoid');
    expect(rivi('3000 Myynti')).toHaveClass('print:break-after-avoid');
    // Vientirivi ei ole otsikko.
    expect(rivi('Hyvitys')).not.toHaveClass('print:break-after-avoid');
  });

  it('tyhjä erittely ja puuttuva yritysnimi', async () => {
    await renderoi({ ...ERITTELY, rivit: [] }, null);
    const doc = await screen.findByRole('article', { name: 'arvonlisäverolaskelma' });
    expect(
      within(doc).getByText('Kaudella ei ole arvonlisäverollisia vientejä.'),
    ).toBeInTheDocument();
    expect(within(doc).queryByText('Demo Oy')).not.toBeInTheDocument();
  });

  it('tilikartasta puuttuva tili näkyy pelkkänä numerona', async () => {
    await renderoi({ ...ERITTELY, rivit: [rivi({ alvKoodi: 21, tili: 4000, summa: c(1000) })] });
    expect(await screen.findByText('4000')).toBeInTheDocument();
  });
});

describe('dokumentin muotoilut', () => {
  it('kitsasPvm etunollin', () => {
    expect(kitsasPvm('2026-03-01')).toBe('01.03.2026');
    expect(kitsasPvm('')).toBe('');
  });
  it('muotoileKanta kahdella desimaalilla kokonaisluvuista', () => {
    expect(muotoileKanta(2550)).toBe('25,50');
    expect(muotoileKanta(1350)).toBe('13,50');
    expect(muotoileKanta(1000)).toBe('10,00');
    expect(muotoileKanta(0)).toBe('0,00');
  });
  it('muotoileSumma ilman €-merkkiä', () => {
    expect(muotoileSumma(c(123456))).toBe('1 234,56');
    expect(muotoileSumma(c(-2400))).toBe('−24,00');
  });
});
