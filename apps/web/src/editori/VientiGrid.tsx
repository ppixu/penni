import { type IsoDate, type Tili, TositeTyyppi } from '@penni/engine';
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
}) {
  function lisaaTasaava() {
    dispatch({ type: 'addBalancingRow', ...(pankkitili !== undefined ? { pankkitili } : {}) });
    // The new row's avain isn't known here, so focus to the new last row's Tili is requested
    // from the screen (TositeEditori) via a post-commit effect on tila.rows.length.
  }

  return (
    <table className="w-full border-collapse text-[12.5px]">
      <colgroup>
        <col className="w-[36%]" />
        <col />
        <col className="w-[110px]" />
        <col className="w-[110px]" />
        <col className="w-[64px]" />
      </colgroup>
      <thead>
        <tr>
          {['Tili', 'Selite', 'Debet', 'Kredit', 'ALV'].map((h, i) => (
            <th
              key={h}
              scope="col"
              className={`px-[10px] pb-[7px] text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)] ${
                i >= 2 ? 'text-right' : 'text-left'
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
                    const tili = chart.find((t) => t.numero === numero);
                    // Alv-oletus vain alv-velvolliselle päivälle (Kitsas: tositeviennit.cpp:291).
                    const alv =
                      tili && (onkoAlvVelvollinen?.(pvm) ?? true)
                        ? tilinAlvOletus(tili, pvm)
                        : undefined;
                    dispatch({
                      type: 'setTili',
                      avain: r.avain,
                      tili: numero,
                      ...(alv !== undefined ? { alv } : {}),
                    });
                  }}
                  // Tulo kirjataan kreditiin (ensimmäinen rivi); muuten puoli, jolla rivillä
                  // jo on summa (esim. tasaava rivi), oletuksena debet.
                  onAcceptDone={() =>
                    fokus.pyyda(
                      r.avain,
                      (i === 0 && tyyppi === TositeTyyppi.TULO) ||
                        (r.kreditSnt !== 0 && r.debetSnt === 0)
                        ? 'kredit'
                        : 'debet',
                    )
                  }
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
