import { useKirjaaLuonnokset } from '@/app/kysely';
import { TositeTyyppiIkoni } from '@/components/TositeTyyppiIkoni';
import { Button } from '@/components/ui/button';
import { tositeTyyppiLabel } from '@/lib/tosite';
import type { LaskuluonnosRivi } from '@penni/engine';
import { muotoileEuro, muotoilePvm } from '@penni/euro';
import { useNavigate } from '@tanstack/react-router';
import { Fragment, useState } from 'react';

/** Luonnoksen alkuperä (jos ei käsin tehty): toistuva lasku, muistutus tai ryhmälasku. */
function alkupera(r: LaskuluonnosRivi): string | null {
  if (r.alkuperainenTosite !== undefined) return 'Muistutus';
  if (r.toisto !== undefined) return 'Toistuva';
  if (r.ryhma !== undefined) return 'Ryhmälasku';
  return null;
}

/** Näytettävä yksikkö: yksittäinen luonnos tai ryhmälaskun (vähintään kaksi luonnosta) luonnokset. */
type Yksikko =
  | { ryhma: string; rivit: LaskuluonnosRivi[] }
  | { ryhma?: undefined; rivi: LaskuluonnosRivi };

/** Samaan `ryhma`an kuuluvat luonnokset (≥ 2) kootaan ryhmän ensimmäisen rivin kohdalle. */
function yksikot(rivit: readonly LaskuluonnosRivi[]): Yksikko[] {
  const ryhmat = new Map<string, LaskuluonnosRivi[]>();
  for (const r of rivit) {
    if (r.ryhma !== undefined) ryhmat.set(r.ryhma, [...(ryhmat.get(r.ryhma) ?? []), r]);
  }
  const tulos: Yksikko[] = [];
  const kasitelty = new Set<string>();
  for (const r of rivit) {
    const jasenet = r.ryhma !== undefined ? ryhmat.get(r.ryhma) : undefined;
    if (r.ryhma === undefined || !jasenet || jasenet.length < 2) {
      tulos.push({ rivi: r });
    } else if (!kasitelty.has(r.ryhma)) {
      kasitelty.add(r.ryhma);
      tulos.push({ ryhma: r.ryhma, rivit: jasenet });
    }
  }
  return tulos;
}

/**
 * Tulot-näkymän Lähtevät-välilehti: laskuluonnokset (myyntilasku ja maksumuistutus, tila 50–99).
 * Myyntilaskuluonnos avautuu muokattavana lomakkeena ja muistutusluonnos erittelynäkymänä
 * (kumpikin `/myyntilaskut/$id`). Ryhmälaskun luonnokset näytetään yhden ryhmäotsikon alla, ja
 * "Kirjaa kaikki" kirjaa ne järjestyksessä (pysähtyy ensimmäiseen virheeseen).
 */
export function LahtevatTaulu({ rivit }: { rivit: LaskuluonnosRivi[] }) {
  const navigate = useNavigate();
  const { kirjaaKaikki, kirjaamassa } = useKirjaaLuonnokset();
  const [virhe, setVirhe] = useState<string | null>(null);

  async function kirjaaRyhma(jasenet: readonly LaskuluonnosRivi[]) {
    if (!window.confirm(`Kirjataanko ${jasenet.length} laskua? Jokainen saa oman numeronsa.`))
      return;
    setVirhe(null);
    const ajo = await kirjaaKaikki(jasenet.map((r) => r.tosite));
    if (ajo.epaonnistui) {
      const { id, viesti } = ajo.epaonnistui;
      const asiakas = jasenet.find((r) => r.tosite === id)?.asiakas ?? `luonnos ${id}`;
      setVirhe(
        `Ryhmälaskun kirjaus pysähtyi: ${asiakas} (kirjattu ${ajo.kirjattu} / ${jasenet.length}). ${viesti}`,
      );
    }
  }

  const luonnosRivi = (r: LaskuluonnosRivi, ryhmassa: boolean) => {
    const avaa = () => navigate({ to: '/myyntilaskut/$id', params: { id: String(r.tosite) } });
    const lahde = ryhmassa ? null : alkupera(r);
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
        <td className="px-[10px] py-[9px] text-right tabular-nums">{muotoileEuro(r.summa)}</td>
      </tr>
    );
  };

  return (
    <>
      {virhe && (
        <p role="alert" className="mb-2 text-[12.5px] text-[var(--danger)]">
          {virhe}
        </p>
      )}
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
          {yksikot(rivit).map((y) => {
            if (y.ryhma === undefined) return luonnosRivi(y.rivi, false);
            const nimi = y.rivit.find((r) => r.otsikko !== undefined)?.otsikko;
            return (
              <Fragment key={`ryhma-${y.ryhma}`}>
                <tr className="border-t border-[var(--border)] bg-[var(--bg-subtle)]">
                  <td colSpan={6} className="px-[10px] py-[7px]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] font-semibold">
                        {`Ryhmälasku · ${y.rivit.length} laskua${nimi ? ` · ${nimi}` : ''}`}
                      </span>
                      <Button
                        type="button"
                        variant="sec"
                        size="compact"
                        disabled={kirjaamassa}
                        onClick={() => void kirjaaRyhma(y.rivit)}
                      >
                        Kirjaa kaikki
                      </Button>
                    </div>
                  </td>
                </tr>
                {y.rivit.map((r) => luonnosRivi(r, true))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
