import type { AlvLaskelmaTulos } from '@penni/engine';
import { muotoileEuro } from '@penni/euro';
import { koodiRivit } from './alvKoodit.js';

/**
 * Kauden alv-laskelma OmaVero-koodeittain: koodi | nimi | summa. RaporttiTaulu-idiomin
 * tyylit (border-collapse, border-faint, tabular-nums), mutta oma komponentti — laskelman
 * riviperusmuoto (harva koodikartta + kiinteä järjestys + 308 aina lihavana) ei istu
 * raportti-DSL:n riveihin. Kaikki summat tulevat moottorin laskelmasta (ei omaa laskentaa).
 */
export function AlvLaskelmaTaulu({
  laskelma,
}: {
  laskelma: Pick<AlvLaskelmaTulos, 'koodit' | 'maksettava'>;
}) {
  return (
    <table aria-label="alv-laskelma" className="w-full max-w-2xl border-collapse text-[13px]">
      <tbody>
        {koodiRivit(laskelma).map((rivi) => (
          <tr key={rivi.koodi} className="border-b border-[var(--border-faint)]">
            <td className="w-[44px] py-[5px] tabular-nums text-[var(--text-subtle)]">
              {rivi.koodi}
            </td>
            <td className={`py-[5px] ${rivi.lihava ? 'font-semibold' : ''}`}>{rivi.nimi}</td>
            <td
              className={`py-[5px] text-right tabular-nums ${rivi.lihava ? 'font-semibold' : ''}`}
            >
              {muotoileEuro(rivi.arvo)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
