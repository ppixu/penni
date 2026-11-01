import { TositeTyyppiIkoni } from '@/components/TositeTyyppiIkoni';
import { tositeTyyppiLabel } from '@/lib/tosite';
import type { LaskuluonnosRivi } from '@penni/engine';
import { muotoileEuro, muotoilePvm } from '@penni/euro';
import { useNavigate } from '@tanstack/react-router';

/** Luonnoksen alkuperä (jos ei käsin tehty): toistuva lasku, muistutus tai ryhmälasku. */
function alkupera(r: LaskuluonnosRivi): string | null {
  if (r.alkuperainenTosite !== undefined) return 'Muistutus';
  if (r.toisto !== undefined) return 'Toistuva';
  if (r.ryhma !== undefined) return 'Ryhmälasku';
  return null;
}

/**
 * Tulot-näkymän Lähtevät-välilehti: laskuluonnokset (myyntilasku ja maksumuistutus, tila 50–99).
 * Myyntilaskuluonnos avautuu muokattavana lomakkeena (`/myyntilaskut/$id`); muistutusluonnos
 * ohjautuu sieltä tositenäkymään.
 */
export function LahtevatTaulu({ rivit }: { rivit: LaskuluonnosRivi[] }) {
  const navigate = useNavigate();

  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr>
          {['Pvm', 'Tyyppi', 'Asiakas', 'Selite', 'Eräpvm', 'Summa'].map((otsikko, i) => (
            <th
              key={otsikko}
              className={`px-[10px] pb-[7px] text-[11px] font-semibold text-[var(--text-subtle)] ${
                i >= 4 ? 'text-right' : 'text-left'
              }`}
            >
              {otsikko}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rivit.map((r) => {
          const avaa = () =>
            navigate({ to: '/myyntilaskut/$id', params: { id: String(r.tosite) } });
          const lahde = alkupera(r);
          return (
            <tr
              key={r.tosite}
              onClick={avaa}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  avaa();
                }
              }}
              tabIndex={0}
              className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--bg-subtle)]"
            >
              <td className="px-[10px] py-[9px] tabular-nums">{muotoilePvm(r.pvm)}</td>
              <td className="px-[10px] py-[9px]">
                <span className="inline-flex items-center gap-2">
                  <TositeTyyppiIkoni tyyppi={r.tyyppi} className="h-5 w-5" />
                  {tositeTyyppiLabel(r.tyyppi)}
                  {lahde && (
                    <span className="rounded-[4px] bg-[var(--track)] px-1.5 py-[1px] text-[10.5px] font-semibold text-[var(--text-muted)]">
                      {lahde}
                    </span>
                  )}
                </span>
              </td>
              <td className="px-[10px] py-[9px]">{r.asiakas ?? '—'}</td>
              <td className="px-[10px] py-[9px]">{r.otsikko ?? '—'}</td>
              <td className="px-[10px] py-[9px] text-right tabular-nums">
                {r.erapvm ? muotoilePvm(r.erapvm) : '—'}
              </td>
              <td className="px-[10px] py-[9px] text-right tabular-nums">
                {muotoileEuro(r.summa)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
