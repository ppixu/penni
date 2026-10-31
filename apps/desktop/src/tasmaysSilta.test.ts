import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TasmaysAineisto } from '@penni/luku';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { type TasmaysLukija, type Valitsin, tasmaysKasittelijat } from './tasmaysSilta.js';

const OSOITE = 'http://127.0.0.1:4321';

function tapahtuma(url: string | null = `${OSOITE}/tasmays`) {
  return { senderFrame: url === null ? null : { url }, sender: { send: vi.fn() } };
}

/** Dialogi, joka palauttaa annetut polut järjestyksessä — yksi per showOpenDialog-kutsu. */
function dialogi(
  ...polut: (string | null)[]
): Valitsin & { showOpenDialog: ReturnType<typeof vi.fn> } {
  const showOpenDialog = vi.fn();
  for (const polku of polut) {
    showOpenDialog.mockResolvedValueOnce(
      polku === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [polku] },
    );
  }
  return { showOpenDialog };
}

const tyhjaAineisto = {} as TasmaysAineisto;

function lukija(): TasmaysLukija & { lueAineisto: ReturnType<typeof vi.fn> } {
  return {
    lueAineisto: vi.fn().mockResolvedValue(tyhjaAineisto),
    lueTiedosto: async (polku) => new TextEncoder().encode(`luettu:${polku}`),
  };
}

// Levylle: valittu tiliote, valittu kuittikansio kuitteineen, kansion ulkopuolinen "salaisuus",
// kansion nimellä alkava sisarkansio ja kansion sisällä symlinkki ulkopuolelle.
const juuri = mkdtempSync(join(tmpdir(), 'penni-tasmaysSilta-'));
afterAll(() => rmSync(juuri, { recursive: true, force: true }));
const tiliote = join(juuri, 'Tapahtumat.pdf');
const kansio = join(juuri, 'Q3');
const kuitti = join(kansio, 'kuitti.pdf');
const salaisuus = join(juuri, 'salaisuus.txt');
const sisarkansio = join(juuri, 'Q3-vanha');
const sisarenKuitti = join(sisarkansio, 'kuitti.pdf');
const linkki = join(kansio, 'linkki.pdf');
writeFileSync(tiliote, 'tiliote');
mkdirSync(kansio);
writeFileSync(kuitti, 'kuitti');
writeFileSync(salaisuus, 'salaisuus');
mkdirSync(sisarkansio);
writeFileSync(sisarenKuitti, 'vanha');
symlinkSync(salaisuus, linkki);

/** Käsittelijät, joille tiliote ja kuittikansio on jo valittu dialogista. */
async function valitutKasittelijat(l: TasmaysLukija = lukija()) {
  const k = tasmaysKasittelijat(dialogi(tiliote, kansio), () => OSOITE, l);
  await k.valitseTiliote(tapahtuma());
  await k.valitseKuittikansio(tapahtuma());
  return k;
}

describe('tasmaysKasittelijat — valinnat', () => {
  it('palauttaa null kun tiedostovalinta perutaan', async () => {
    const k = tasmaysKasittelijat(dialogi(null), () => OSOITE);
    expect(await k.valitseTiliote(tapahtuma())).toBeNull();
  });

  it('palauttaa valitun polun', async () => {
    const d = dialogi(tiliote);
    const k = tasmaysKasittelijat(d, () => OSOITE);
    expect(await k.valitseTiliote(tapahtuma())).toBe(tiliote);
    expect(d.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ['openFile'] }),
    );
  });

  it('valitsee kuittikansion hakemistotilassa', async () => {
    const d = dialogi(kansio);
    expect(await tasmaysKasittelijat(d, () => OSOITE).valitseKuittikansio(tapahtuma())).toBe(
      kansio,
    );
    expect(d.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ['openDirectory'] }),
    );
  });
});

describe('tasmaysKasittelijat — lueTiedosto', () => {
  it('sallii kuitin valitun kansion sisältä ja valitun tiliotteen', async () => {
    const k = await valitutKasittelijat();
    expect(new TextDecoder().decode(await k.lueTiedosto(tapahtuma(), kuitti))).toContain(
      'kuitti.pdf',
    );
    await expect(k.lueTiedosto(tapahtuma(), tiliote)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('lukee oikeasti levyltä oletuslukijalla', async () => {
    const k = tasmaysKasittelijat(dialogi(kansio), () => OSOITE);
    await k.valitseKuittikansio(tapahtuma());
    expect(new TextDecoder().decode(await k.lueTiedosto(tapahtuma(), kuitti))).toBe('kuitti');
  });

  it('hylkää kaiken ennen kuin mitään on valittu', async () => {
    const k = tasmaysKasittelijat(dialogi(), () => OSOITE);
    await expect(k.lueTiedosto(tapahtuma(), kuitti)).rejects.toThrow(/Pääsy estetty/);
  });

  it('hylkää kansion ulkopuolisen tiedoston', async () => {
    const k = await valitutKasittelijat();
    await expect(k.lueTiedosto(tapahtuma(), salaisuus)).rejects.toThrow(/Pääsy estetty/);
    await expect(k.lueTiedosto(tapahtuma(), '/etc/passwd')).rejects.toThrow(/Pääsy estetty/);
  });

  it('hylkää ../-kierron kansiosta ulos', async () => {
    const k = await valitutKasittelijat();
    await expect(k.lueTiedosto(tapahtuma(), join(kansio, '..', 'salaisuus.txt'))).rejects.toThrow(
      /Pääsy estetty/,
    );
    await expect(k.lueTiedosto(tapahtuma(), `${kansio}/../salaisuus.txt`)).rejects.toThrow(
      /Pääsy estetty/,
    );
  });

  it('sallii ../-polun joka palaa takaisin kansion sisään', async () => {
    const k = await valitutKasittelijat();
    await expect(k.lueTiedosto(tapahtuma(), `${kansio}/../Q3/kuitti.pdf`)).resolves.toBeInstanceOf(
      Uint8Array,
    );
  });

  it('hylkää kansion nimellä alkavan sisarkansion (etuliite ilman erotinta)', async () => {
    const k = await valitutKasittelijat();
    await expect(k.lueTiedosto(tapahtuma(), sisarenKuitti)).rejects.toThrow(/Pääsy estetty/);
  });

  it('hylkää kansion sisällä olevan symlinkin joka osoittaa ulos', async () => {
    const k = await valitutKasittelijat();
    await expect(k.lueTiedosto(tapahtuma(), linkki)).rejects.toThrow(/Pääsy estetty/);
  });

  it('hylkää olemattoman polun samalla viestillä', async () => {
    const k = await valitutKasittelijat();
    await expect(k.lueTiedosto(tapahtuma(), join(kansio, 'ei-ole.pdf'))).rejects.toThrow(
      /Pääsy estetty/,
    );
  });

  it('uusi kansiovalinta korvaa edellisen', async () => {
    const k = tasmaysKasittelijat(dialogi(kansio, sisarkansio), () => OSOITE, lukija());
    await k.valitseKuittikansio(tapahtuma());
    await k.valitseKuittikansio(tapahtuma());
    await expect(k.lueTiedosto(tapahtuma(), sisarenKuitti)).resolves.toBeInstanceOf(Uint8Array);
    await expect(k.lueTiedosto(tapahtuma(), kuitti)).rejects.toThrow(/Pääsy estetty/);
  });
});

describe('tasmaysKasittelijat — lueAineisto', () => {
  it('lukee valitun tiliotteen ja kansion ja välittää edistymisen lähettäjälle', async () => {
    const l = lukija();
    l.lueAineisto.mockImplementation(async (_t, _k, edistyminen) => {
      edistyminen({ vaihe: 'tiliote', valmiina: 1, yhteensa: 1, tiedosto: tiliote });
      return tyhjaAineisto;
    });
    const k = await valitutKasittelijat(l);
    const t = tapahtuma();
    expect(await k.lueAineisto(t, tiliote, kansio)).toBe(tyhjaAineisto);
    expect(l.lueAineisto).toHaveBeenCalledWith(tiliote, kansio, expect.any(Function));
    expect(t.sender.send).toHaveBeenCalledWith(
      'tasmays:edistyminen',
      expect.objectContaining({ vaihe: 'tiliote' }),
    );
  });

  it('sallii tiliotteen ilman kuittikansiota', async () => {
    const l = lukija();
    const k = tasmaysKasittelijat(dialogi(tiliote), () => OSOITE, l);
    await k.valitseTiliote(tapahtuma());
    await k.lueAineisto(tapahtuma(), tiliote, null);
    expect(l.lueAineisto).toHaveBeenCalledWith(tiliote, null, expect.any(Function));
  });

  it('hylkää valitsemattoman tiliotteen eikä lue mitään', async () => {
    const l = lukija();
    const k = await valitutKasittelijat(l);
    await expect(k.lueAineisto(tapahtuma(), salaisuus, null)).rejects.toThrow(/Pääsy estetty/);
    expect(l.lueAineisto).not.toHaveBeenCalled();
  });

  it('hylkää valitsemattoman kansion ja ../-kierron kansiosta ylös', async () => {
    const l = lukija();
    const k = await valitutKasittelijat(l);
    await expect(k.lueAineisto(tapahtuma(), tiliote, sisarkansio)).rejects.toThrow(/Pääsy estetty/);
    await expect(k.lueAineisto(tapahtuma(), tiliote, join(kansio, '..'))).rejects.toThrow(
      /Pääsy estetty/,
    );
    expect(l.lueAineisto).not.toHaveBeenCalled();
  });
});

describe('tasmaysKasittelijat — lähettäjän alkuperä', () => {
  const vieraat: [string, string | null][] = [
    ['eri portti', 'http://127.0.0.1:9999/tasmays'],
    ['vieras sivusto', 'https://hyokkaaja.example/'],
    ['file:-sivu', 'file:///tmp/x.html'],
    ['kehys puuttuu', null],
  ];

  it.each(vieraat)('hylkää lueTiedosto-kutsun: %s', async (_nimi, url) => {
    const k = await valitutKasittelijat();
    await expect(k.lueTiedosto(tapahtuma(url), kuitti)).rejects.toThrow(/IPC-kutsu hylättiin/);
  });

  it.each(vieraat)('hylkää lueAineisto-kutsun: %s', async (_nimi, url) => {
    const l = lukija();
    const k = await valitutKasittelijat(l);
    await expect(k.lueAineisto(tapahtuma(url), tiliote, kansio)).rejects.toThrow(
      /IPC-kutsu hylättiin/,
    );
    expect(l.lueAineisto).not.toHaveBeenCalled();
  });

  it('hylkää valinnat vieraalta lähettäjältä avaamatta dialogia', async () => {
    const d = dialogi(tiliote, kansio);
    const k = tasmaysKasittelijat(d, () => OSOITE);
    await expect(k.valitseTiliote(tapahtuma('https://hyokkaaja.example/'))).rejects.toThrow(
      /IPC-kutsu hylättiin/,
    );
    await expect(k.valitseKuittikansio(tapahtuma(null))).rejects.toThrow(/IPC-kutsu hylättiin/);
    expect(d.showOpenDialog).not.toHaveBeenCalled();
  });

  it('hylkää kaiken kun kirjaa ei ole auki (ei sallittua osoitetta)', async () => {
    const k = tasmaysKasittelijat(dialogi(tiliote), () => null);
    await expect(k.valitseTiliote(tapahtuma())).rejects.toThrow(/IPC-kutsu hylättiin/);
  });
});
