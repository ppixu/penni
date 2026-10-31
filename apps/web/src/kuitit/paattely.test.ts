import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TULKINNAN_AIKARAJA_MS,
  jaettuPaattelija,
  lukumalliPaattelijasta,
  luoPaattelija,
} from './paattely.js';

class TestiWorker extends EventTarget {
  postMessage = vi.fn();
  terminate = vi.fn();
}

function workerAsetelma() {
  const workers: TestiWorker[] = [];
  vi.stubGlobal(
    'Worker',
    class extends TestiWorker {
      constructor() {
        super();
        workers.push(this);
      }
    },
  );
  return workers;
}

afterEach(() => vi.unstubAllGlobals());

describe('päättelytyöntekijän elinkaari', () => {
  it.each(['error', 'messageerror'])(
    'hylkää odottavat ja uudet kutsut tapahtuman %s jälkeen',
    async (tapahtuma) => {
      const workers = workerAsetelma();
      const p = luoPaattelija();
      const odottava = expect(p.saatavilla()).rejects.toThrow();
      workers[0]?.dispatchEvent(new Event(tapahtuma));
      await odottava;
      await expect(p.saatavilla()).rejects.toThrow();
      expect(workers[0]?.postMessage).toHaveBeenCalledTimes(1);
      expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    },
  );

  it('luo seuraavalle kuitille uuden yhteisen työntekijän kaatumisen jälkeen', async () => {
    const workers = workerAsetelma();
    const ensimmainen = jaettuPaattelija();
    expect(jaettuPaattelija()).toBe(ensimmainen);
    workers[0]?.dispatchEvent(new Event('error'));
    const toinen = jaettuPaattelija();
    expect(toinen).not.toBe(ensimmainen);
    const vastaus = toinen.saatavilla();
    workers[1]?.dispatchEvent(
      new MessageEvent('message', { data: { id: 1, ok: true, arvo: true } }),
    );
    await expect(vastaus).resolves.toBe(true);
    toinen.sulje();
  });

  it('sulkeminen hylkää keskeneräiset kutsut ja vapauttaa yhteisen työntekijän', async () => {
    const workers = workerAsetelma();
    const p = jaettuPaattelija();
    const odottava = expect(p.saatavilla()).rejects.toThrow('suljettiin');
    p.sulje();
    await odottava;
    await expect(p.saatavilla()).rejects.toThrow('suljettiin');
    const uusi = jaettuPaattelija();
    expect(uusi).not.toBe(p);
    expect(workers).toHaveLength(2);
    uusi.sulje();
  });
});

describe('lukumalliPaattelijasta', () => {
  function testiPaattelija(tulkitse: () => Promise<string>) {
    return {
      saatavilla: vi.fn().mockResolvedValue(true),
      lataa: vi.fn().mockResolvedValue(undefined),
      tulkitse: vi.fn(tulkitse),
      lataaTeksti: vi.fn(),
      tulkitseTeksti: vi.fn(),
      sulje: vi.fn(),
    };
  }
  const KUVA = new Blob(['png'], { type: 'image/png' });

  afterEach(() => vi.useRealTimers());

  it('välittää latauksen asetukset eikä aikarajoita latausta', async () => {
    vi.useFakeTimers();
    let valmis = () => {};
    const p = testiPaattelija(async () => 'teksti');
    p.lataa.mockImplementation(
      () =>
        new Promise<void>((r) => {
          valmis = r;
        }),
    );
    const m = lukumalliPaattelijasta(p, { selainValimuisti: false });
    const edistyi = vi.fn();
    const lataus = m.lataa(edistyi);
    expect(p.lataa).toHaveBeenCalledWith(edistyi, { selainValimuisti: false });
    await vi.advanceTimersByTimeAsync(TULKINNAN_AIKARAJA_MS * 10);
    valmis();
    await expect(lataus).resolves.toBeUndefined();
    expect(p.sulje).not.toHaveBeenCalled();
  });

  it('palauttaa ajoissa valmistuneen tulkinnan sulkematta työntekijää', async () => {
    vi.useFakeTimers();
    const p = testiPaattelija(async () => 'teksti');
    const m = lukumalliPaattelijasta(p, { selainValimuisti: true });
    await expect(m.tulkitse(KUVA, 'kehote')).resolves.toBe('teksti');
    await vi.advanceTimersByTimeAsync(TULKINNAN_AIKARAJA_MS);
    expect(p.sulje).not.toHaveBeenCalled();
  });

  it('jumittunut tulkinta katkaistaan aikarajalla ja työntekijä suljetaan', async () => {
    vi.useFakeTimers();
    const p = testiPaattelija(() => new Promise<string>(() => {}));
    const m = lukumalliPaattelijasta(p, { selainValimuisti: true });
    const tulos = expect(m.tulkitse(KUVA, 'kehote')).rejects.toThrow('aikaraja');
    await vi.advanceTimersByTimeAsync(TULKINNAN_AIKARAJA_MS - 1);
    expect(p.sulje).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await tulos;
    expect(p.sulje).toHaveBeenCalledOnce();
  });

  it('kaatunut tulkinta sulkee työntekijän, jotta seuraava kuitti saa uuden', async () => {
    vi.useFakeTimers();
    const p = testiPaattelija(async () => {
      throw new Error('GPU-laite menetettiin');
    });
    const m = lukumalliPaattelijasta(p, { selainValimuisti: true });
    await expect(m.tulkitse(KUVA, 'kehote')).rejects.toThrow('GPU-laite menetettiin');
    expect(p.sulje).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
