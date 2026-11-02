import { Button } from '@/components/ui/button';
import {
  type CsvEsikatselu,
  type CsvSarakkeet as CsvSarakejako,
  PVM_MUODOT,
  type PvmMuoto,
  poimiCsv,
} from '@penni/engine';
import { muotoileEuro, muotoilePvm } from '@penni/euro';
import { useMemo, useState } from 'react';

/** Sarakkeen rooli valinnassa; `ei` = saraketta ei käytetä. */
type Rooli =
  | 'ei'
  | 'pvm'
  | 'maara'
  | 'debet'
  | 'kredit'
  | 'nimi'
  | 'maksaja'
  | 'saaja'
  | 'viesti'
  | 'viite'
  | 'arkistotunnus'
  | 'iban'
  | 'saldo'
  | 'valuutta';

const ROOLIT: readonly [Rooli, string][] = [
  ['ei', 'Ei käytetä'],
  ['pvm', 'Päivämäärä'],
  ['maara', 'Summa'],
  ['debet', 'Veloitus (ulos)'],
  ['kredit', 'Hyvitys (sisään)'],
  ['nimi', 'Nimi'],
  ['maksaja', 'Maksaja'],
  ['saaja', 'Saaja'],
  ['viesti', 'Viesti'],
  ['viite', 'Viite'],
  ['arkistotunnus', 'Arkistointitunnus'],
  ['iban', 'Vastapuolen IBAN'],
  ['saldo', 'Saldo'],
  ['valuutta', 'Valuutta'],
];

/** Roolit, joita voi olla useammalla sarakkeella (nimet ja viestit yhdistetään). */
const MONTA: ReadonlySet<Rooli> = new Set(['nimi', 'viesti']);

/** Yhden sarakkeen roolit sarakejaon kentissä, tässä järjestyksessä etsittyinä. */
const YKSITTAISET = [
  'pvm',
  'maara',
  'debet',
  'kredit',
  'maksaja',
  'saaja',
  'viite',
  'arkistotunnus',
  'iban',
  'saldo',
  'valuutta',
] as const;

/** Päivämuodot esimerkkipäivänä, joka on käyttäjälle muotomerkintää selvempi. */
const PVM_ESIMERKKI: Record<PvmMuoto, string> = {
  'd.m.yyyy': '31.12.2026',
  'yyyy-mm-dd': '2026-12-31',
  'yyyy/mm/dd': '2026/12/31',
  'd/m/yyyy': '31/12/2026',
};

const KENTTA =
  'rounded-[var(--radius-input)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-[12.5px] text-[var(--text)]';
const SOLU = 'max-w-[200px] truncate px-2 py-1.5 text-left';
const SOLU_OTSIKKO = 'px-2 py-1.5 text-left font-semibold text-[var(--text-subtle)]';

/** Sarakejako sarakkeittaisiksi rooleiksi. */
function rooleiksi(s: CsvSarakejako, sarakkeita: number): Rooli[] {
  return Array.from({ length: sarakkeita }, (_, i): Rooli => {
    const yksi = YKSITTAISET.find((r) => s[r] === i);
    if (yksi) return yksi;
    if (s.nimi.includes(i)) return 'nimi';
    if (s.viesti.includes(i)) return 'viesti';
    return 'ei';
  });
}

/**
 * Roolit sarakejaoksi, tai null, jos päivämäärä tai rahamäärä (summa, tai veloitus ja hyvitys)
 * puuttuu. Nimi- ja viestisarakkeet säilyttävät alkuperäisen jaon järjestyksen (ensimmäinen
 * ei-tyhjä nimi voittaa), uudet perään sarakejärjestyksessä.
 */
function sarakejaoksi(
  roolit: readonly Rooli[],
  pvmMuoto: PvmMuoto,
  alku: CsvSarakejako,
): CsvSarakejako | null {
  const indeksi = (r: Rooli) => {
    const i = roolit.indexOf(r);
    return i < 0 ? undefined : i;
  };
  const lista = (r: 'nimi' | 'viesti') => {
    const valitut = roolit.flatMap((x, i) => (x === r ? [i] : []));
    const paikka = (i: number) => {
      const p = alku[r].indexOf(i);
      return p < 0 ? alku[r].length + i : p;
    };
    return valitut.sort((a, b) => paikka(a) - paikka(b));
  };
  const pvm = indeksi('pvm');
  if (pvm === undefined) return null;
  const s: CsvSarakejako = { pvm, pvmMuoto, nimi: lista('nimi'), viesti: lista('viesti') };
  for (const r of YKSITTAISET) {
    if (r === 'pvm') continue;
    const i = indeksi(r);
    if (i !== undefined) s[r] = i;
  }
  if (s.maara === undefined && (s.debet === undefined || s.kredit === undefined)) return null;
  return s;
}

/** CSV-solu lainattuna, jotta erotin tai lainausmerkki solussa ei riko riviä. */
const lainaa = (solu: string) => `"${solu.replace(/"/g, '""')}"`;

/**
 * Esikatselun pieni CSV otsikoista ja esimerkkiriveistä. Rivit tasataan otsikon levyisiksi,
 * ettei OP:n rivin perässä oleva erotin siirrä otsikkoriviä.
 */
function esikatselunCsv(esikatselu: CsvEsikatselu): string {
  const leveys = esikatselu.otsikot.length;
  const rivi = (solut: readonly string[]) =>
    Array.from({ length: leveys }, (_, i) => lainaa(solut[i] ?? '')).join(';');
  return [esikatselu.otsikot, ...esikatselu.esimerkit].map(rivi).join('\n');
}

/**
 * Tuntemattoman CSV-tiliotteen sarakejako: rooli jokaisen sarakkeen yläpuolella, päivämäärän
 * muoto ja esikatselu siitä, miten ensimmäiset rivit luetaan valitulla jaolla.
 */
export function CsvSarakkeet({
  esikatselu,
  alku,
  onVahvista,
  onPeru,
}: {
  esikatselu: CsvEsikatselu;
  alku: CsvSarakejako;
  onVahvista: (sarakkeet: CsvSarakejako) => void;
  onPeru: () => void;
}): React.ReactElement {
  const { otsikot, esimerkit } = esikatselu;
  const [roolit, setRoolit] = useState<Rooli[]>(() => rooleiksi(alku, otsikot.length));
  const [pvmMuoto, setPvmMuoto] = useState<PvmMuoto>(alku.pvmMuoto);

  const sarakkeet = useMemo(() => sarakejaoksi(roolit, pvmMuoto, alku), [roolit, pvmMuoto, alku]);
  const teksti = useMemo(() => esikatselunCsv(esikatselu), [esikatselu]);
  const luettu = useMemo(() => {
    if (!sarakkeet) return null;
    try {
      return { tapahtumat: poimiCsv(teksti, sarakkeet).tapahtumat };
    } catch (e) {
      // Rivinumero viittaa esikatselun CSV:hen, jonka rivi 1 on otsikko.
      const viesti = (e instanceof Error ? e.message : String(e)).replace(
        /\(rivi (\d+)\)$/,
        (_, n: string) => `(esimerkkirivi ${Number(n) - 1})`,
      );
      return { virhe: viesti };
    }
  }, [teksti, sarakkeet]);

  function valitse(sarake: number, rooli: Rooli) {
    setRoolit((nyt) =>
      nyt.map((r, i) => {
        if (i === sarake) return rooli;
        if (rooli === 'ei' || MONTA.has(rooli)) return r;
        // Yksittäinen rooli siirtyy; summa ja veloitus/hyvitys sulkevat toisensa pois.
        if (r === rooli) return 'ei';
        if (rooli === 'maara' && (r === 'debet' || r === 'kredit')) return 'ei';
        if ((rooli === 'debet' || rooli === 'kredit') && r === 'maara') return 'ei';
        return r;
      }),
    );
  }

  const nimi = (i: number) => otsikot[i] || `${i + 1}`;

  return (
    <section aria-label="sarakejako" className="flex max-w-full flex-col gap-4">
      <div>
        <h3 className="mb-1 text-[14px] font-semibold">Mitä sarakkeet sisältävät?</h3>
        <p className="text-[13px] text-[var(--text-muted)]">
          {esikatselu.pankki ? '' : 'Penni ei tunnistanut pankkia tiedoston otsikkorivistä. '}
          Valitse, mikä sarake on päivä, summa ja nimi. Valinta muistetaan saman pankin seuraavia
          tiedostoja varten.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-[12.5px]">
          <caption className="sr-only">Tiedoston ensimmäiset rivit</caption>
          <thead>
            <tr>
              {otsikot.map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: sarakkeet ovat kiinteät
                <th key={i} className="px-2 pb-2 text-left font-normal">
                  <select
                    aria-label={`Sarake ${nimi(i)}`}
                    value={roolit[i] ?? 'ei'}
                    onChange={(e) => valitse(i, e.target.value as Rooli)}
                    className={KENTTA}
                  >
                    {ROOLIT.map(([arvo, teksti]) => (
                      <option key={arvo} value={arvo}>
                        {teksti}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
            <tr className="border-b border-[var(--border)]">
              {otsikot.map((o, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: sarakkeet ovat kiinteät
                <th key={i} className={SOLU_OTSIKKO}>
                  {o}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {esimerkit.map((rivi, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: esimerkkirivit ovat kiinteät
              <tr key={r} className="border-t border-[var(--border-faint)]">
                {otsikot.map((_, i) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: sarakkeet ovat kiinteät
                    key={i}
                    className={`${SOLU} ${roolit[i] === 'ei' ? 'text-[var(--text-subtle)]' : ''}`}
                  >
                    {rivi[i] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
        <span aria-hidden="true">Päivämäärän muoto</span>
        <select
          aria-label="Päivämäärän muoto"
          value={pvmMuoto}
          onChange={(e) => setPvmMuoto(e.target.value as PvmMuoto)}
          className={KENTTA}
        >
          {PVM_MUODOT.map((m) => (
            <option key={m} value={m}>
              {PVM_ESIMERKKI[m]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--text-subtle)]">
          Näin rivit luetaan
        </h4>
        {!sarakkeet && (
          <p className="text-[12.5px] text-[var(--text-muted)]">
            Valitse päivämäärä ja summa (tai veloitus ja hyvitys).
          </p>
        )}
        {luettu && 'virhe' in luettu && (
          <p className="text-[12.5px] text-[var(--danger)]">{luettu.virhe}</p>
        )}
        {luettu && 'tapahtumat' in luettu && (
          <table className="w-full max-w-[560px] border-collapse text-[12.5px]">
            <caption className="sr-only">Näin tiliote luetaan</caption>
            <thead>
              <tr>
                <th className={SOLU_OTSIKKO}>Päivä</th>
                <th className={SOLU_OTSIKKO}>Nimi</th>
                <th className={`${SOLU_OTSIKKO} text-right`}>Summa</th>
              </tr>
            </thead>
            <tbody>
              {luettu.tapahtumat.map((t, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: esikatselun rivit ovat kiinteät
                <tr key={i} className="border-t border-[var(--border-faint)]">
                  <td className="w-[90px] px-2 py-1.5 tabular-nums text-[var(--text-subtle)]">
                    {muotoilePvm(t.pvm)}
                  </td>
                  <td className="max-w-[300px] truncate px-2 py-1.5">{t.nimi}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{muotoileEuro(t.maara)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex gap-3">
        <Button
          type="button"
          disabled={!sarakkeet}
          onClick={() => sarakkeet && onVahvista(sarakkeet)}
        >
          Lue tiliote
        </Button>
        <Button type="button" variant="sec" onClick={onPeru}>
          Peru
        </Button>
      </div>
    </section>
  );
}
