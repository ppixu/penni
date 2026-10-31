import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Kuva } from './rasterointi.js';
import { OCR_KEHOTE, VisioVirhe } from './vision.js';
import {
  AI_KUTSURAJA,
  AiLaskuri,
  rakennaAiPyynto,
  tulkitseAiVastaus,
  workersAiTeksti,
} from './workersAi.js';

const kuva: Kuva = { tavut: new Uint8Array([1, 2, 3]), mime: 'image/png' };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ai-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const asetukset = (): {
  malli: string;
  url: string;
  cacheDir: string;
  laskuriPolku: string;
} => ({
  malli: '@cf/qwen/qwen3.8-27b',
  url: 'http://localhost:8799/ajo',
  cacheDir: join(dir, 'cache'),
  laskuriPolku: join(dir, 'laskuri.json'),
});

const vastaus = (runko: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    json: () => Promise.resolve(runko),
    text: () => Promise.resolve(typeof runko === 'string' ? runko : JSON.stringify(runko)),
  }) as unknown as Response;

const chat = (content: string): unknown => ({
  choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
});

describe('rakennaAiPyynto', () => {
  it('lähettää kuvan data-URI:na ja kehotteen tekstinä, lämpötila 0, ajattelu pois', () => {
    const p = rakennaAiPyynto(kuva, OCR_KEHOTE, '@cf/qwen/qwen3.8-27b') as {
      malli: string;
      syote: Record<string, unknown>;
    };
    expect(p.malli).toBe('@cf/qwen/qwen3.8-27b');
    const viesti = (p.syote.messages as { role: string; content: Record<string, unknown>[] }[])[0];
    expect(viesti?.content[0]).toEqual({ type: 'text', text: OCR_KEHOTE });
    expect(viesti?.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AQID' },
    });
    expect(p.syote.temperature).toBe(0);
    expect(p.syote.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect('reasoning_effort' in p.syote).toBe(false);
  });

  it('Kimille lisätään reasoning_effort none', () => {
    const p = rakennaAiPyynto(kuva, 'k', '@cf/moonshotai/kimi-k2.6') as {
      syote: Record<string, unknown>;
    };
    expect(p.syote.reasoning_effort).toBe('none');
  });
});

describe('tulkitseAiVastaus', () => {
  it('lukee chat-completions-muodon ja {response}-muodon, myös result-kääreen sisältä', () => {
    expect(tulkitseAiVastaus(chat('rivi 1\nrivi 2'))).toEqual({
      ok: true,
      sisalto: 'rivi 1\nrivi 2',
    });
    expect(tulkitseAiVastaus({ response: 'teksti' })).toEqual({ ok: true, sisalto: 'teksti' });
    expect(tulkitseAiVastaus({ result: { response: 'teksti' }, success: true })).toEqual({
      ok: true,
      sisalto: 'teksti',
    });
  });

  it('tyhjä sisältö + päättely tai length-katko on budjettivirhe, muuten tyhjä', () => {
    expect(
      tulkitseAiVastaus({
        choices: [{ message: { content: '', reasoning_content: 'hmm' }, finish_reason: 'stop' }],
      }),
    ).toEqual({ ok: false, syy: 'budjetti' });
    expect(
      tulkitseAiVastaus({ choices: [{ message: { content: null }, finish_reason: 'length' }] }),
    ).toEqual({ ok: false, syy: 'budjetti' });
    expect(tulkitseAiVastaus(chat('  '))).toEqual({ ok: false, syy: 'tyhja' });
    expect(tulkitseAiVastaus(null)).toEqual({ ok: false, syy: 'tyhja' });
  });
});

describe('AiLaskuri', () => {
  it('laskee, säilyy levyllä ja kieltäytyy rajan täyttyessä', () => {
    const polku = join(dir, 'ala', 'laskuri.json');
    const l = new AiLaskuri(polku, 2);
    expect(l.luku()).toBe(0);
    expect(l.varaa()).toBe(1);
    expect(new AiLaskuri(polku, 2).luku()).toBe(1); // uusi instanssi lukee levyltä
    expect(l.varaa()).toBe(2);
    expect(() => l.varaa()).toThrow(/kutsukatto 2 täynnä/);
    expect(l.luku()).toBe(2); // kieltäytyminen ei kasvata laskuria
  });

  it('viimeinen sallittu kutsu menee läpi ja seuraava kielletään (raja 60)', () => {
    const polku = join(dir, 'l.json');
    writeFileSync(polku, '{"kutsuja":59}');
    const l = new AiLaskuri(polku);
    expect(l.varaa()).toBe(60);
    expect(() => l.varaa()).toThrow(/60/);
    expect(AI_KUTSURAJA).toBe(60);
  });
});

describe('workersAiTeksti', () => {
  it('kutsuu, kirjaa laskurin ja kirjoittaa välimuistiin; toinen kutsu ei maksa mitään', async () => {
    const hae = vi.fn().mockResolvedValue(vastaus(chat('KUITTI\nYHTEENSÄ 5,00')));
    const a = asetukset();
    const l = new AiLaskuri(a.laskuriPolku);
    expect(await workersAiTeksti(kuva, a, l, hae)).toBe('KUITTI\nYHTEENSÄ 5,00');
    expect(await workersAiTeksti(kuva, a, l, hae)).toBe('KUITTI\nYHTEENSÄ 5,00');
    expect(hae).toHaveBeenCalledTimes(1);
    expect(l.luku()).toBe(1);
    expect(readdirSync(a.cacheDir).filter((n) => n.endsWith('.txt'))).toHaveLength(1);
  });

  it('eri malli tai eri kuva on eri välimuistiavain', async () => {
    const hae = vi.fn().mockResolvedValue(vastaus(chat('x')));
    const a = asetukset();
    const l = new AiLaskuri(a.laskuriPolku);
    await workersAiTeksti(kuva, a, l, hae);
    await workersAiTeksti(kuva, { ...a, malli: '@cf/moonshotai/kimi-k2.6' }, l, hae);
    await workersAiTeksti({ ...kuva, tavut: new Uint8Array([9]) }, a, l, hae);
    expect(hae).toHaveBeenCalledTimes(3);
    expect(l.luku()).toBe(3);
  });

  it('kieltäytyy kutsumasta kun katto on täynnä', async () => {
    const hae = vi.fn();
    const a = asetukset();
    writeFileSync(a.laskuriPolku, `{"kutsuja":${AI_KUTSURAJA}}`);
    await expect(workersAiTeksti(kuva, a, new AiLaskuri(a.laskuriPolku), hae)).rejects.toThrow(
      /kutsukatto/,
    );
    expect(hae).not.toHaveBeenCalled();
  });

  it('HTTP-virhe on kutsu-virhe, kuluttaa kiintiötä eikä jätä välimuistia', async () => {
    const hae = vi.fn().mockResolvedValue(vastaus('model unavailable', false, 502));
    const a = asetukset();
    const l = new AiLaskuri(a.laskuriPolku);
    const virhe = await workersAiTeksti(kuva, a, l, hae).catch((e: unknown) => e);
    expect(virhe).toBeInstanceOf(VisioVirhe);
    expect((virhe as VisioVirhe).syy).toBe('kutsu');
    expect(l.luku()).toBe(1);
    expect(readdirSync(a.cacheDir).filter((n) => n.endsWith('.txt'))).toHaveLength(0);
  });

  it('tyhjä vastaus ei päädy välimuistiin', async () => {
    const hae = vi.fn().mockResolvedValue(vastaus(chat('')));
    const a = asetukset();
    const virhe = await workersAiTeksti(kuva, a, new AiLaskuri(a.laskuriPolku), hae).catch(
      (e: unknown) => e,
    );
    expect((virhe as VisioVirhe).syy).toBe('tyhja');
    expect(
      existsSync(a.cacheDir) ? readdirSync(a.cacheDir).filter((n) => n.endsWith('.txt')) : [],
    ).toHaveLength(0);
    expect(readFileSync(a.laskuriPolku, 'utf8')).toContain('1');
  });
});
