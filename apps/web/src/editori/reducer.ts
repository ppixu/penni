import { TositeTyyppi } from '@penni/engine';
import { type Cents, Euro } from '@penni/euro';
import { bruttoSyottoKoodille } from './alvOletus.js';
import type { EditoriAction, TositeEditoriTila, VientiRivi } from './types.js';

let seuraavaAvain = 0;
/** Monotonic client-side row key (stable across edits, used for React keys + focus refs). */
function uusiAvain(): string {
  seuraavaAvain += 1;
  return `rivi-${seuraavaAvain}`;
}

function tyhjaRivi(): VientiRivi {
  return {
    avain: uusiAvain(),
    debetSnt: Euro.fromCents(0),
    kreditSnt: Euro.fromCents(0),
    alvKoodi: 0,
    alvProsentti: 0,
    bruttoSyotto: true,
  };
}

/** Uusi rivi annetuin kentin ja tuorein avaimin (esim. tallennetun tositteen muokkaukseen). */
export function uusiRivi(kentat: Omit<VientiRivi, 'avain'>): VientiRivi {
  return { ...kentat, avain: uusiAvain() };
}

/** Build the initial editor state. `initial` overrides the defaults (date is required-ish). */
export function alustaTila(initial?: Partial<TositeEditoriTila>): TositeEditoriTila {
  return {
    paiva: initial?.paiva ?? '',
    tyyppi: initial?.tyyppi ?? TositeTyyppi.MENO,
    sarja: initial?.sarja ?? '',
    selite: initial?.selite ?? '',
    rows: initial?.rows && initial.rows.length > 0 ? initial.rows : [tyhjaRivi()],
    ...(initial?.tiliote ? { tiliote: initial.tiliote } : {}),
    ...(initial?.draftId !== undefined ? { draftId: initial.draftId } : {}),
  };
}

/** Map over rows, replacing the row with matching `avain`. */
function paivitaRivi(
  rows: VientiRivi[],
  avain: string,
  muutos: (r: VientiRivi) => VientiRivi,
): VientiRivi[] {
  return rows.map((r) => (r.avain === avain ? muutos(r) : r));
}

const ZERO: Cents = Euro.fromCents(0);

export function reducer(tila: TositeEditoriTila, action: EditoriAction): TositeEditoriTila {
  switch (action.type) {
    case 'setPaiva':
      return { ...tila, paiva: action.pvm };
    case 'setTyyppi':
      return { ...tila, tyyppi: action.tyyppi };
    case 'setSarja':
      return { ...tila, sarja: action.sarja };
    case 'setSelite':
      return { ...tila, selite: action.selite };
    case 'setTiliote':
      return { ...tila, tiliote: action.tiliote };

    case 'setRiviSelite':
      return {
        ...tila,
        rows: paivitaRivi(tila.rows, action.avain, (r) => ({ ...r, selite: action.selite })),
      };
    case 'setTili': {
      const { alv } = action;
      return {
        ...tila,
        rows: paivitaRivi(tila.rows, action.avain, (r) => {
          // Tilin oletus esitäyttää vain rivin, jonka alv-koodia käyttäjä ei ole valinnut:
          // tyhjän (EIALV) tai aiemmin tililtä esitäytetyn. Käyttäjän valinta säilyy.
          const kayttajanValinta = r.alvKoodi !== 0 && r.alvTililta !== true;
          if (alv === undefined || kayttajanValinta) return { ...r, tili: action.tili };
          return {
            ...r,
            tili: action.tili,
            alvKoodi: alv.alvKoodi,
            alvProsentti: alv.alvProsentti,
            bruttoSyotto: bruttoSyottoKoodille(alv.alvKoodi),
            alvTililta: alv.alvKoodi !== 0,
          };
        }),
      };
    }
    case 'setDebet':
      // Mutual exclusion: a non-zero debet zeroes this row's kredit (engine rule).
      return {
        ...tila,
        rows: paivitaRivi(tila.rows, action.avain, (r) => ({
          ...r,
          debetSnt: action.snt,
          kreditSnt: action.snt !== 0 ? ZERO : r.kreditSnt,
        })),
      };
    case 'setKredit':
      return {
        ...tila,
        rows: paivitaRivi(tila.rows, action.avain, (r) => ({
          ...r,
          kreditSnt: action.snt,
          debetSnt: action.snt !== 0 ? ZERO : r.debetSnt,
        })),
      };
    case 'setAlvKoodi':
      return {
        ...tila,
        rows: paivitaRivi(tila.rows, action.avain, (r) => ({
          ...r,
          alvKoodi: action.alvKoodi,
          alvProsentti: action.alvProsentti,
          // Käänteinen alv: syötetty summa on veroton (muuten vienti ei täsmää vastatiliin).
          bruttoSyotto: bruttoSyottoKoodille(action.alvKoodi),
          alvTililta: false,
        })),
      };
    case 'setBruttoSyotto':
      return {
        ...tila,
        rows: paivitaRivi(tila.rows, action.avain, (r) => ({ ...r, bruttoSyotto: action.brutto })),
      };

    case 'addRow': {
      const uusi = tyhjaRivi();
      if (action.afterAvain === undefined) return { ...tila, rows: [...tila.rows, uusi] };
      const i = tila.rows.findIndex((r) => r.avain === action.afterAvain);
      const rows = [...tila.rows];
      rows.splice(i < 0 ? rows.length : i + 1, 0, uusi);
      return { ...tila, rows };
    }

    case 'addBalancingRow': {
      // Ehdotettu tasapaino lasketaan RAAOISTA riveistä (ei laskeSummat: se vaatii nyt
      // tilikartan ja alv-rivi heittäisi ilman sitä). Tämä on vain UI-mukavuus syötetyistä.
      let debetYht = Euro.fromCents(0);
      let kreditYht = Euro.fromCents(0);
      for (const r of tila.rows) {
        debetYht = Euro.add(debetYht, r.debetSnt);
        kreditYht = Euro.add(kreditYht, r.kreditSnt);
      }
      const erotus = Euro.sub(debetYht, kreditYht);
      const uusi = tyhjaRivi();
      if (erotus > 0) {
        // Debet-heavy → the new row's KREDIT mirrors the deficit.
        uusi.kreditSnt = Euro.fromCents(erotus);
        uusi.ehdotettu = true;
      } else if (erotus < 0) {
        // Kredit-heavy → the new row's DEBET mirrors |deficit|.
        uusi.debetSnt = Euro.abs(erotus);
        uusi.ehdotettu = true;
      }
      // erotus === 0 → a plain blank row (no ehdotettu flag).
      // Meno/Tulo: vastapuoli on pankki (kuten Kitsaksessa), ellei jokin rivi jo käytä sitä.
      const { pankkitili } = action;
      if (
        pankkitili !== undefined &&
        (tila.tyyppi === TositeTyyppi.MENO || tila.tyyppi === TositeTyyppi.TULO) &&
        !tila.rows.some((r) => r.tili === pankkitili)
      )
        uusi.tili = pankkitili;
      return { ...tila, rows: [...tila.rows, uusi] };
    }

    case 'removeRow': {
      if (tila.rows.length <= 1) {
        // Never drop below one row — clear the last row instead.
        return { ...tila, rows: [tyhjaRivi()] };
      }
      return { ...tila, rows: tila.rows.filter((r) => r.avain !== action.avain) };
    }

    case 'reset':
      // Keep date+series (rapid sequential vouchers), clear selite/draftId/rows.
      return alustaTila({
        paiva: action.initial?.paiva ?? tila.paiva,
        tyyppi: action.initial?.tyyppi ?? tila.tyyppi,
        sarja: action.initial?.sarja ?? tila.sarja,
      });

    case 'korvaa':
      return action.tila;
  }
}
