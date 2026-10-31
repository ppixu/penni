import { Linkki } from '@/components/Linkki';
import { Paivakirja } from '@/raportit/Paivakirja';
import { InProcessClient } from '@penni/asiakas';
import { Euro, muotoileEuro } from '@penni/euro';
import { createMemoryStorage } from '@penni/storage-memory';
import { useQuery } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { luoArkistonQueryClient, renderoiKerran, renderoiStaattiseksi } from './staattinen';

const TILIT = [
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
];

async function luoKirja() {
  const client = new InProcessClient(
    createMemoryStorage({
      tilit: TILIT,
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false' },
    }),
    () => '2026-06-01T00:00:00.000Z',
  );
  await client.luoTosite({
    pvm: '2026-03-01',
    tyyppi: 200,
    sarja: '',
    tila: 100,
    viennit: [
      {
        tili: 1900,
        debet: Euro.fromCents(100_000),
        kredit: Euro.fromCents(0),
        pvm: '2026-03-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili: 3000,
        debet: Euro.fromCents(0),
        kredit: Euro.fromCents(100_000),
        pvm: '2026-03-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
    ],
  });
  return client;
}

/** Komponentti, joka kaatuu renderöitäessä (ei virherajaa). */
function KaatuvaSivu(): never {
  throw new Error('rikki');
}

/** Kysely, jonka asiakaskutsu hylätään. */
function EpaonnistuvaKysely() {
  const { data, isError } = useQuery({
    queryKey: ['epaonnistuva'],
    queryFn: () => Promise.reject(new Error('yhteys katkesi')),
  });
  return <p>{isError ? 'Lataus epäonnistui' : (data ?? 'Ladataan…')}</p>;
}

/** Kysely, joka ei koskaan valmistu. */
function IkuinenLataus() {
  const { data } = useQuery({
    queryKey: ['ikuinen'],
    queryFn: () => new Promise<string>(() => {}),
  });
  return <p>{data ?? 'Ladataan…'}</p>;
}

/** Propseilla toimiva sivu (kuten tositesivu): ei kyselyitä, linkki arkiston kontekstista. */
function PropsiSivu({ id }: { id: number }) {
  return (
    <p>
      <Linkki to="/tositteet/$id" params={{ id: String(id) }}>
        Tosite {id}
      </Linkki>
    </p>
  );
}

describe('renderoiStaattiseksi', () => {
  // Arkisto renderöi selaimessa act()-ympäristön ulkopuolella; Testing Library kytkee lipun
  // päälle, joten se poistetaan näiden testien ajaksi (muuten React varoittaa act():sta).
  const lippu = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
  let aiempi: boolean | undefined;
  beforeAll(() => {
    aiempi = lippu.IS_REACT_ACT_ENVIRONMENT;
    lippu.IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterAll(() => {
    lippu.IS_REACT_ACT_ENVIRONMENT = aiempi;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renderöi raporttikomponentin dataa myöten staattiseksi HTML:ksi arkistolinkein', async () => {
    const client = await luoKirja();
    const html = await renderoiStaattiseksi(
      <Paivakirja alkupvm="2026-01-01" loppupvm="2026-12-31" naytaTilit />,
      {
        client,
        queryClient: luoArkistonQueryClient(),
        linkit: (k) => (k.to === '/tositteet/$id' ? `../tositteet/T${k.params?.id}.html` : null),
      },
      'päiväkirja',
    );
    expect(html).toContain('aria-label="Päiväkirja"');
    expect(html).toContain('<table');
    // innerHTML sarjallistaa muotoileEuron sitovat välilyönnit muotoon &nbsp;.
    expect(html).toContain(muotoileEuro(Euro.fromCents(100_000)).replace(/\u00a0/g, '&nbsp;'));
    expect(html).toContain('1&nbsp;000,00');
    expect(html).toContain('href="../tositteet/T');
    expect(html).not.toContain('href="/');
  });

  it('hylkää sivun nimellä, kun renderöinti ei valmistu aikarajassa', async () => {
    const client = await luoKirja();
    await expect(
      renderoiStaattiseksi(
        <IkuinenLataus />,
        { client, queryClient: luoArkistonQueryClient(), linkit: () => null, aikaraja: 200 },
        'ikuinen sivu',
      ),
    ).rejects.toThrow('Arkistosivun "ikuinen sivu" renderöinti ei valmistunut');
  });

  it('hylkää sivun nimellä, kun komponentti kaatuu renderöitäessä', async () => {
    const client = await luoKirja();
    await expect(
      renderoiStaattiseksi(
        <KaatuvaSivu />,
        { client, queryClient: luoArkistonQueryClient(), linkit: () => null },
        'kaatuva sivu',
      ),
    ).rejects.toThrow('Arkistosivun "kaatuva sivu" renderöinti epäonnistui: rikki');
  });

  it('hylkää sivun nimellä, kun sen kysely epäonnistuu', async () => {
    const client = await luoKirja();
    await expect(
      renderoiStaattiseksi(
        <EpaonnistuvaKysely />,
        { client, queryClient: luoArkistonQueryClient(), linkit: () => null },
        'virhesivu',
      ),
    ).rejects.toThrow('Arkistosivun "virhesivu" kysely epäonnistui: yhteys katkesi');
  });
  it('ei kaadu aikarajaan, kun välilehti on piilossa (ajastimet harvenevat), vaan vasta näkyvissä', async () => {
    const client = await luoKirja();
    const tila = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    let hylatty = false;
    const kesken = renderoiStaattiseksi(
      <IkuinenLataus />,
      { client, queryClient: luoArkistonQueryClient(), linkit: () => null, aikaraja: 50 },
      'piilossa',
    ).catch((virhe: unknown) => {
      hylatty = true;
      throw virhe;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(hylatty).toBe(false);
    tila.mockReturnValue('visible');
    await expect(kesken).rejects.toThrow('Arkistosivun "piilossa" renderöinti ei valmistunut');
  });
});

describe('renderoiKerran', () => {
  const lippu = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
  let aiempi: boolean | undefined;
  beforeAll(() => {
    aiempi = lippu.IS_REACT_ACT_ENVIRONMENT;
    lippu.IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterAll(() => {
    lippu.IS_REACT_ACT_ENVIRONMENT = aiempi;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renderöi propseilla toimivan sivun synkronisesti ilman ajastimia, arkistolinkein', async () => {
    const client = await luoKirja();
    vi.useFakeTimers();
    const html = renderoiKerran(
      <PropsiSivu id={7} />,
      {
        client,
        queryClient: luoArkistonQueryClient(),
        linkit: (k) => (k.to === '/tositteet/$id' ? `../tositteet/T${k.params?.id}.html` : null),
      },
      'tosite 7',
    );
    expect(vi.getTimerCount()).toBe(0);
    expect(html).toBe('<p><a href="../tositteet/T7.html">Tosite 7</a></p>');
  });

  it('hylkää sivun nimellä, kun komponentti kaatuu renderöitäessä', async () => {
    const client = await luoKirja();
    expect(() =>
      renderoiKerran(
        <KaatuvaSivu />,
        { client, queryClient: luoArkistonQueryClient(), linkit: () => null },
        'kaatuva tosite',
      ),
    ).toThrow('Arkistosivun "kaatuva tosite" renderöinti epäonnistui: rikki');
  });
});
