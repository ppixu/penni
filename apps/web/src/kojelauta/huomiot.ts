import { type KausiPituus, alvErapaiva, seuraavaAlvKausi } from '@/alv/alvKaudet';
import { type Asetukset, type Tilikausi, onkoAlvVelvollinen } from '@penni/engine';
import { muotoilePvm } from '@penni/euro';

export type HuomionTaso = 'virhe' | 'varoitus' | 'vinkki';

export interface Huomio {
  avain: string;
  taso: HuomionTaso;
  otsikko: string;
  teksti: string;
  linkki: { to: string; label: string };
}

export interface HuomioSyote {
  tanaan: string;
  asetukset: Asetukset;
  /** Tilikaudet nousevassa järjestyksessä. */
  tilikaudet: readonly Tilikausi[];
  kausiKk: KausiPituus;
  /** Viimeinen ilmoitettu alv-päivä (alv/alvKaudet.ts:n viimeisinIlmoitettu). */
  alvIlmoitettuAsti: string | undefined;
  /** Valitun kauden luonnosten määrä (Kitsas: "Tiliöinti on kesken N tositteessa"). */
  luonnoksia: number;
  /** Taseen puolet valitun kauden lopussa (luokka 1 ja luokka 2, kuten Kitsas). */
  vastaavaa: number;
  vastattavaa: number;
}

/** Päivien määrä a → b (ISO-päivät, UTC). */
function paivia(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const kausivali = (k: { alkaa: string; loppuu: string }) =>
  `${muotoilePvm(k.alkaa)}–${muotoilePvm(k.loppuu)}`;

/**
 * Kojelaudan huomiot Kitsaksen aloitussivun vinkkien mukaan (aloitusbrowser.cpp:132-336):
 * tase ei täsmää, alv-ilmoitus myöhässä tai pian erääntymässä, keskeneräiset tositteet,
 * tilikauden päättyminen ja tilinpäätöksen laatiminen. Vakavin ensin.
 */
export function kojelaudanHuomiot(s: HuomioSyote): Huomio[] {
  const tulos: Huomio[] = [];

  // aloitusbrowser.cpp:390-408 — vakava virhe, aina ylimpänä.
  if (s.vastaavaa !== s.vastattavaa) {
    tulos.push({
      avain: 'tase',
      taso: 'virhe',
      otsikko: 'Tase ei täsmää',
      teksti:
        'Kirjanpidon debet- ja kredit-kirjaukset eivät täsmää. Tämä tarkoittaa aina, ettei kirjanpito ole kunnossa.',
      linkki: { to: '/raportit', label: 'Avaa raportit' },
    });
  }

  // aloitusbrowser.cpp:227-299: seuraava ilmoittamaton kausi; myöhässä tai alle 12 pv eräpäivään.
  const alv = seuraavaAlvKausi(s.alvIlmoitettuAsti, s.kausiKk, s.asetukset.AlvAlkaa, s.tilikaudet);
  if (alv && onkoAlvVelvollinen(s.asetukset, alv.alkupvm)) {
    const erapvm = alvErapaiva(alv.loppupvm, s.kausiKk);
    const jaljella = paivia(s.tanaan, erapvm);
    const kausi = `${muotoilePvm(alv.alkupvm)}–${muotoilePvm(alv.loppupvm)}`;
    if (jaljella < 0) {
      tulos.push({
        avain: 'alv',
        taso: 'varoitus',
        otsikko: 'Arvonlisäveroilmoitus myöhässä',
        teksti: `Ilmoitus kaudelta ${kausi} olisi pitänyt antaa ${muotoilePvm(erapvm)} mennessä.`,
        linkki: { to: '/alv', label: 'Tee alv-tilitys' },
      });
    } else if (jaljella < 12) {
      tulos.push({
        avain: 'alv',
        taso: 'vinkki',
        otsikko: 'Tee arvonlisäverotilitys',
        teksti: `Ilmoitus kaudelta ${kausi} on annettava ${muotoilePvm(erapvm)} mennessä.`,
        linkki: { to: '/alv', label: 'Tee alv-tilitys' },
      });
    }
  }

  // aloitusbrowser.cpp:132-139 — Pennissä keskeneräinen tosite on luonnos.
  if (s.luonnoksia > 0) {
    tulos.push({
      avain: 'luonnokset',
      taso: 'vinkki',
      otsikko:
        s.luonnoksia === 1
          ? 'Yksi tosite on luonnoksena'
          : `${s.luonnoksia} tositetta on luonnoksena`,
      teksti: 'Luonnokset eivät vielä näy kirjanpidossa eivätkä raporteissa.',
      linkki: { to: '/tositteet', label: 'Näytä luonnokset' },
    });
  }

  // aloitusbrowser.cpp:302-312 — alle 30 pv viimeisen tilikauden loppuun.
  const viimeinen = s.tilikaudet.at(-1);
  if (viimeinen && paivia(s.tanaan, viimeinen.loppuu) < 30) {
    tulos.push({
      avain: 'uusikausi',
      taso: 'vinkki',
      otsikko: 'Aloita uusi tilikausi',
      teksti: `Tilikausi päättyy ${muotoilePvm(viimeinen.loppuu)}. Sen jälkeiselle ajalle ei voi kirjata ennen kuin uusi tilikausi on aloitettu.`,
      linkki: { to: '/asetukset', label: 'Avaa asetukset' },
    });
  }

  // aloitusbrowser.cpp:315-334 — 2 pv … 5 kk kauden päättymisestä eikä kautta ole lukittu.
  const lukittuAsti = s.asetukset.TilitPaatetty ?? '';
  for (const k of s.tilikaudet) {
    const kulunut = paivia(k.loppuu, s.tanaan);
    if (kulunut > 1 && kulunut < 150 && lukittuAsti < k.loppuu) {
      tulos.push({
        avain: `tilinpaatos-${k.alkaa}`,
        taso: 'vinkki',
        otsikko: `Aika laatia tilinpäätös tilikaudelle ${kausivali(k)}`,
        teksti:
          'Tee loppuun kaikki tilikaudelle kuuluvat kirjaukset ja laadi sen jälkeen tilinpäätös.',
        linkki: { to: '/tilinpaatos', label: 'Avaa tilinpäätös' },
      });
    }
  }

  return tulos;
}
