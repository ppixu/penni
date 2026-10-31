import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  kausiTunnus,
  liitePaate,
  liiteTiedosto,
  tositeTiedosto,
  turvallinenNimi,
} from './polut';

describe('kausiTunnus', () => {
  it('käyttää pelkkää vuotta kalenterivuodelle', () => {
    expect(kausiTunnus('2025-01-01')).toBe('2025');
  });
  it('käyttää vuotta ja kuukautta kuun alusta alkavalle kaudelle', () => {
    expect(kausiTunnus('2025-07-01')).toBe('2025-07');
  });
  it('käyttää koko päivämäärää muulloin', () => {
    expect(kausiTunnus('2025-07-15')).toBe('2025-07-15');
  });
});

describe('tositeTiedosto', () => {
  it('täyttää tunnisteen kahdeksaan numeroon', () => {
    expect(tositeTiedosto('2025', '', 7)).toBe('2025--00000007');
    expect(tositeTiedosto('2025', 'M', 123)).toBe('2025-M-00000123');
  });
});

describe('liitePaate', () => {
  it('ottaa päätteen nimestä pienaakkosina', () => {
    expect(liitePaate('Kuitti.PDF', 'application/pdf')).toBe('pdf');
    expect(liitePaate('a.tar.gz', 'application/gzip')).toBe('gz');
  });
  it('ottaa päätteen MIME-alatyypistä kun nimessä ei ole', () => {
    expect(liitePaate('kuitti', 'image/jpeg')).toBe('jpeg');
  });
  it('putoaa päätteeseen bin', () => {
    expect(liitePaate('x', 'application/octet-stream')).toBe('bin');
  });
  it('hylkää liian pitkän tai kelvottoman nimipäätteen', () => {
    expect(liitePaate('x.abcdefghi', 'image/png')).toBe('png');
    expect(liitePaate('x.', 'image/png')).toBe('png');
    expect(liitePaate('x.p-g', 'image/png')).toBe('png');
  });
});

describe('liiteTiedosto', () => {
  it('yhdistää tositetiedoston, järjestyksen ja päätteen', () => {
    expect(liiteTiedosto('2025', '', 7, 1, 'k.pdf', 'application/pdf')).toBe(
      '2025--00000007_01.pdf',
    );
  });
});

describe('turvallinenNimi', () => {
  it('korvaa sallimattomat merkit alaviivalla', () => {
    expect(turvallinenNimi('Ääkkönen & Co / Oy')).toBe('Ääkkönen _ Co _ Oy');
  });
  it('putoaa nimeen kirjanpito kun tyhjä', () => {
    expect(turvallinenNimi('   ')).toBe('kirjanpito');
    expect(turvallinenNimi('')).toBe('kirjanpito');
  });
});

describe('escapeHtml', () => {
  it('pakenee erikoismerkit', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});
