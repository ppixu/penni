import { describe, expect, it } from 'vitest';
import { appKomennonSuunta, appKomentoKuuntelija, navigointiPaatos } from './navigointi.js';

describe('appKomennonSuunta', () => {
  it('selaimen takaisin/eteenpäin-komennot (Windowsin hiiren sivunapit, Linuxin XButtonit)', () => {
    expect(appKomennonSuunta('browser-backward')).toBe('takaisin');
    expect(appKomennonSuunta('browser-forward')).toBe('eteenpain');
  });

  it('muut app-commandit ohitetaan', () => {
    expect(appKomennonSuunta('media-play-pause')).toBeNull();
    expect(appKomennonSuunta('browser-refresh')).toBeNull();
  });
});

describe('appKomentoKuuntelija', () => {
  it('välittää vain navigointikomennot sivulle', () => {
    const lahetetyt: string[] = [];
    const kuuntelija = appKomentoKuuntelija((suunta) => lahetetyt.push(suunta));
    kuuntelija({}, 'browser-backward');
    kuuntelija({}, 'volume-up');
    kuuntelija({}, 'browser-forward');
    expect(lahetetyt).toEqual(['takaisin', 'eteenpain']);
  });
});

const ISTUNTO = 'http://127.0.0.1:53124';

describe('navigointiPaatos', () => {
  it('sallii navigoinnin kirjan istunnon originissa', () => {
    expect(navigointiPaatos('http://127.0.0.1:53124/tositteet/1', ISTUNTO)).toBe('salli');
    expect(navigointiPaatos(`${ISTUNTO}/`, ISTUNTO)).toBe('salli');
  });

  it('toinen portti tai isäntä ei ole sama origin', () => {
    expect(navigointiPaatos('http://127.0.0.1:9999/', ISTUNTO)).toBe('ulkoinen');
    expect(navigointiPaatos('http://localhost:53124/', ISTUNTO)).toBe('ulkoinen');
  });

  it('ulkoiset http(s)-linkit ohjataan kysyttäviksi', () => {
    expect(navigointiPaatos('https://example.com/kuitti', ISTUNTO)).toBe('ulkoinen');
  });

  it('estää muut skeemat, virheelliset osoitteet ja navigoinnin ilman istuntoa', () => {
    for (const url of [
      'file:///etc/passwd',
      'data:text/html,<script></script>',
      'javascript:alert(1)',
      'blob:http://127.0.0.1:53124/abc',
      'ei osoite',
    ]) {
      expect(navigointiPaatos(url, ISTUNTO)).toBe('esta');
    }
    expect(navigointiPaatos('http://127.0.0.1:53124/', undefined)).toBe('ulkoinen');
    expect(navigointiPaatos('http://127.0.0.1:53124/', 'rikki')).toBe('ulkoinen');
  });
});
