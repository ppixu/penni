import { KohdennusValitsin, kohdennusSoluKaytossa } from '@/kohdennukset/KohdennusValitsin';
import { kohdennusSolunTeksti } from '@/kohdennukset/kohdennusTeksti';
import { type IsoDate, type Kohdennus, type Tili, TositeTyyppi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import type { Dispatch } from 'react';
import { AlvValitsin } from './AlvValitsin.js';
import { EuroInput } from './EuroInput.js';
import { TiliValitsin } from './TiliValitsin.js';
import { tilinAlvOletus } from './alvOletus.js';
import type { EditoriAction, VientiRivi } from './types.js';
import type { useGridFocus } from './useGridFocus.js';

type Fokus = ReturnType<typeof useGridFocus>;

export function VientiGrid({
  rows,
  chart,
  pvm,
  dispatch,
  fokus,
  onkoAlvVelvollinen,
  tyyppi,
  pankkitili,
  kohdennukset: ladatut,
}: {
  rows: readonly VientiRivi[];
  chart: readonly Tili[];
  pvm: IsoDate;
  dispatch: Dispatch<EditoriAction>;
  fokus: Fokus;
  /** Kirjanpidon alv-velvollisuus päivälle; puuttuu = velvollinen (tilin alv-oletus käytössä). */
  onkoAlvVelvollinen?: ((pvm: IsoDate) => boolean) | undefined;
  /** Tositteen tyyppi (TositeTyyppi): Tulo-tositteen ensimmäinen rivi kirjataan kreditiin. */
  tyyppi?: number | undefined;
  /** Kirjanpidon pankkitili Meno/Tulo-tositteen tasaavalle riville. */
  pankkitili?: number | undefined;
  /** Kirjanpidon kohdennukset: Kohdennus-sarake näkyy, kun niitä on ainakin yksi tai jollakin
   *  rivillä on kohdennus tai merkkauksia (esim. tuotu tuntematon id, "Tuntematon (n)").
   *  undefined = ei (vielä) ladattu: rivien kohdennuksia ei näytetä, jottei tunnettu kohdennus
   *  välähdä tuntemattomana. */
  kohdennukset?: readonly Kohdennus[] | undefined;
}) {
  const kohdennukset = ladatut ?? [];
  const kohdennusSarake =
    kohdennukset.length > 0 ||
    (ladatut !== undefined &&
      rows.some((r) => (r.kohdennus ?? 0) !== 0 || (r.merkkaukset?.length ?? 0) > 0));
  const otsikot = kohdennusSarake
    ? ['Tili', 'Selite', 'Kohdennus', 'Debet', 'Kredit', 'ALV']
    : ['Tili', 'Selite', 'Debet', 'Kredit', 'ALV'];
  /** Ensimmäinen summasarake (Debet), josta oikealle tasataan. */
  const summienAlku = kohdennusSarake ? 3 : 2;

  function lisaaTasaava() {
    dispatch({ type: 'addBalancingRow', ...(pankkitili !== undefined ? { pankkitili } : {}) });
    // The new row's avain isn't known here, so focus to the new last row's Tili is requested
    // from the screen (TositeEditori) via a post-commit effect on tila.rows.length.
  }

  return (
    <table className="w-full border-collapse text-[12.5px]">
      <colgroup>
        <col className={kohdennusSarake ? 'w-[28%]' : 'w-[36%]'} />
        <col />
        {kohdennusSarake ? <col className="w-[22%]" /> : null}
        <col className="w-[110px]" />
        <col className="w-[110px]" />
        <col className="w-[64px]" />
      </colgroup>
      <thead>
        <tr>
          {otsikot.map((h, i) => (
            <th
              key={h}
              scope="col"
              className={`px-[10px] pb-[7px] text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)] ${
                i >= summienAlku ? 'text-right' : 'text-left'
              }`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const nro = i + 1;
          const setDebet = (snt: Cents) => dispatch({ type: 'setDebet', avain: r.avain, snt });
          const setKredit = (snt: Cents) => dispatch({ type: 'setKredit', avain: r.avain, snt });
          const tili = chart.find((t) => t.numero === r.tili);
          // Tulo kirjataan kreditiin (ensimmäinen rivi); muuten puoli, jolla rivillä jo on
          // summa (esim. tasaava rivi), oletuksena debet.
          const summaSolu =
            (i === 0 && tyyppi === TositeTyyppi.TULO) || (r.kreditSnt !== 0 && r.debetSnt === 0)
              ? 'kredit'
              : 'debet';
          const onRiviEnter = (e: React.KeyboardEvent) => {
            // Picker owns Enter while open (cmdk preventDefaults a selection); a row-cell Enter
            // (picker closed → not defaultPrevented) adds the balancing row.
            if (e.key === 'Enter' && !e.defaultPrevented) {
              e.preventDefault();
              lisaaTasaava();
            }
          };
          return (
            <tr key={r.avain} className="border-t border-[var(--border)]">
              <td className="px-[10px] py-[7px]">
                <TiliValitsin
                  tilit={chart}
                  arvo={r.tili}
                  ariaLabel={`Tili, rivi ${nro}`}
                  inputRef={fokus.setRef(r.avain, 'tili')}
                  onValitse={(numero) => {
                    const uusi = chart.find((t) => t.numero === numero);
                    // Alv-oletus vain alv-velvolliselle päivälle (Kitsas: tositeviennit.cpp:291).
                    const alv =
                      uusi && (onkoAlvVelvollinen?.(pvm) ?? true)
                        ? tilinAlvOletus(uusi, pvm)
                        : undefined;
                    dispatch({
                      type: 'setTili',
                      avain: r.avain,
                      tili: numero,
                      ...(alv !== undefined ? { alv } : {}),
                    });
                  }}
                  // Kohdennus ohitetaan tässä: kirjaus etenee tilistä suoraan summaan.
                  onAcceptDone={() => fokus.pyyda(r.avain, summaSolu)}
                />
              </td>
              <td className="px-[10px] py-[7px]">
                <input
                  type="text"
                  aria-label={`Selite, rivi ${nro}`}
                  ref={fokus.setRef(r.avain, 'selite')}
                  value={r.selite ?? ''}
                  onChange={(e) =>
                    dispatch({ type: 'setRiviSelite', avain: r.avain, selite: e.target.value })
                  }
                  onKeyDown={onRiviEnter}
                  className="w-full bg-transparent outline-none"
                />
              </td>
              {kohdennusSarake ? (
                <td className="px-[10px] py-[7px]" onKeyDown={onRiviEnter}>
                  {kohdennusSoluKaytossa(tili) ? (
                    <KohdennusValitsin
                      kohdennukset={kohdennukset}
                      pvm={pvm}
                      arvo={{
                        ...(r.kohdennus !== undefined ? { kohdennus: r.kohdennus } : {}),
                        ...(r.merkkaukset !== undefined ? { merkkaukset: r.merkkaukset } : {}),
                      }}
                      onMuuta={(arvo) =>
                        dispatch({ type: 'setKohdennus', avain: r.avain, ...arvo })
                      }
                      ariaLabel={`Kohdennus, rivi ${nro}`}
                      inputRef={fokus.setRef(r.avain, 'kohdennus')}
                      onAcceptDone={() => fokus.pyyda(r.avain, summaSolu)}
                    />
                  ) : (
                    // Taseen tilillä solu ei ole muokattava eikä fokusoitava (Kitsas), mutta
                    // tilin vaihdossa säilynyt kohdennus näkyy, jottei se tallennu huomaamatta.
                    <span className="text-[var(--text-subtle)]">
                      {kohdennusSolunTeksti(r.kohdennus, r.merkkaukset, kohdennukset)}
                    </span>
                  )}
                </td>
              ) : null}
              <td className="px-[10px] py-[7px] text-right" onKeyDown={onRiviEnter}>
                <EuroInput
                  aria-label={`Debet, rivi ${nro}`}
                  arvo={r.debetSnt}
                  onCommit={setDebet}
                  inputRef={fokus.setRef(r.avain, 'debet')}
                />
              </td>
              <td className="px-[10px] py-[7px] text-right" onKeyDown={onRiviEnter}>
                <EuroInput
                  aria-label={`Kredit, rivi ${nro}`}
                  arvo={r.kreditSnt}
                  onCommit={setKredit}
                  inputRef={fokus.setRef(r.avain, 'kredit')}
                />
              </td>
              <td className="px-[10px] py-[7px] text-right" onKeyDown={onRiviEnter}>
                <AlvValitsin
                  rivi={nro}
                  alvKoodi={r.alvKoodi}
                  alvProsentti={r.alvProsentti}
                  pvm={pvm}
                  ariaLabel={`ALV, rivi ${nro}`}
                  onValitse={(alvKoodi, alvProsentti) =>
                    dispatch({ type: 'setAlvKoodi', avain: r.avain, alvKoodi, alvProsentti })
                  }
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
