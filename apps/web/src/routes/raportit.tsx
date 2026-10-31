import { useInit } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import type { Tilirajaus } from '@/raportit/raporttiProps';
import { RAPORTIT, kaavaAvain } from '@/raportit/raporttiValikko';
import {
  alaryhmanOtsikko,
  etuliitteenNumero,
  lueTiliHaku,
  ryhmanOtsikko,
} from '@/tilikartta/tilinakyma';
import { useValittuTilikausi } from '@/tilikausi/valittuTilikausi';
import { lataaKartta, nimi } from '@penni/engine';
import { muotoilePvm } from '@penni/euro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

/**
 * Osoitteen hakuparametrit: `raportti` valitsee raportin, ja pääkirjan voi rajata yhteen tiliin
 * (`tili`) tai tiliryhmään etuliitteellä (`tiliryhma=11` = tilit 1100–1199), esim. tilikartan
 * riviltä `/raportit?raportti=paakirja&tili=1910`.
 */
interface RaportitHaku {
  raportti?: string | undefined;
  tili?: number | undefined;
  tiliryhma?: number | undefined;
}

export const Route = createFileRoute('/raportit')({
  validateSearch: (haku: Record<string, unknown>): RaportitHaku => {
    const ryhma = lueTiliHaku(haku.tiliryhma);
    return {
      raportti: typeof haku.raportti === 'string' ? haku.raportti : undefined,
      tili: lueTiliHaku(haku.tili),
      tiliryhma: ryhma !== undefined && ryhma < 100 ? ryhma : undefined,
    };
  },
  component: Raportit,
});

function Raportit() {
  const { data: init } = useInit();
  const navigate = useNavigate();
  const haku = Route.useSearch();
  const valittu = haku.raportti ?? 'tase';
  // Raportin vaihto pudottaa tilirajauksen.
  function setValittu(raportti: string): void {
    void navigate({ to: '/raportit', search: { raportti }, replace: true });
  }
  // Kausi tulee sivupalkin tilikausivalinnasta (tilikausi/valittuTilikausi.ts).
  const { kausi } = useValittuTilikausi();
  // Tilikohtaiset erittelyt (Kitsas: "Tulosta tilikohtaiset erittelyt").
  const [naytaTilit, setNaytaTilit] = useState(true);

  // Kaavaraportti näkyy valikossa vain, jos kirjassa on sen lajin kaava.
  const lista = useMemo(
    () => RAPORTIT.filter((r) => !r.kaava || (init && kaavaAvain(init.asetukset, r.kaava))),
    [init],
  );
  // Oletuksena tase; jos kirjassa ei ole tasekaavaa, ensimmäinen kaavaraportti.
  const raportti = lista.find((r) => r.avain === valittu) ?? lista.find((r) => r.kaava) ?? lista[0];
  const muoto = raportti?.kaava && init ? kaavaAvain(init.asetukset, raportti.kaava) : undefined;
  const rajattava = raportti?.tilirajaus === true;
  const rajaus = useMemo<Tilirajaus | undefined>(() => {
    if (!rajattava) return undefined;
    if (haku.tili !== undefined) return { tili: haku.tili };
    if (haku.tiliryhma !== undefined) return { tiliryhma: String(haku.tiliryhma) };
    return undefined;
  }, [rajattava, haku.tili, haku.tiliryhma]);
  const rajauksenNimi = useMemo(() => {
    if (!rajaus || !init) return '';
    const kartta = lataaKartta(init.tilit);
    if ('tili' in rajaus) {
      const tili = kartta.find((t) => t.otsikkotaso === 0 && t.numero === rajaus.tili);
      return `Tili ${rajaus.tili}${tili ? ` ${nimi(tili)}` : ''}`;
    }
    const e = rajaus.tiliryhma;
    const otsikko = e.length === 1 ? ryhmanOtsikko(kartta, Number(e)) : alaryhmanOtsikko(kartta, e);
    return `Tilit ${etuliitteenNumero(e)}–${e.padEnd(4, '9')}${otsikko ? ` ${otsikko}` : ''}`;
  }, [rajaus, init]);

  return (
    <>
      <TopBar otsikko="Raportit" />
      <section aria-label="raportti" className="flex-1 overflow-auto px-[22px] py-5">
        <div className="mb-5 flex flex-wrap items-end gap-5 print:hidden">
          <label className={VALITSIN_OTSIKKO}>
            Raportti
            <select
              aria-label="Raportti"
              value={raportti?.avain ?? ''}
              onChange={(e) => setValittu(e.target.value)}
              className={VALITSIN}
            >
              {lista.map((r) => (
                <option key={r.avain} value={r.avain}>
                  {r.nimi}
                </option>
              ))}
            </select>
          </label>
          {raportti && <RaportinOhje teksti={raportti.selite} />}
          {raportti?.kaava && (
            <label className="flex items-center gap-2 pb-2 text-[12.5px] text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={naytaTilit}
                onChange={(e) => setNaytaTilit(e.target.checked)}
              />
              Näytä tilit
            </label>
          )}
          {rajaus && (
            <div className="flex items-center gap-2 pb-[3px] text-[12.5px]">
              <span className="rounded-[6px] bg-[var(--accent-soft)] px-[10px] py-[5px] font-medium text-[var(--accent)]">
                {rajauksenNimi}
              </span>
              <Button variant="sec" size="compact" onClick={() => setValittu(valittu)}>
                Kaikki tilit
              </Button>
            </div>
          )}
        </div>
        {/* Tulosteessa valitsimet piilotetaan (ks. TopBar) — yritys, raportin nimi ja kausi (tase:
            tilanne kauden lopussa) otsikoksi. */}
        {raportti && kausi && (
          <h1 className="mb-4 hidden text-[15px] font-semibold print:block">
            {[
              init?.asetukset.Nimi,
              raportti.tilanneLopussa
                ? `${raportti.nimi} ${muotoilePvm(kausi.loppuu)}`
                : `${raportti.nimi} ${muotoilePvm(kausi.alkaa)} – ${muotoilePvm(kausi.loppuu)}`,
            ]
              .filter(Boolean)
              .join(' – ')}
          </h1>
        )}
        {raportti && kausi ? (
          <raportti.Nakyma
            key={raportti.avain}
            alkupvm={kausi.alkaa}
            loppupvm={kausi.loppuu}
            naytaTilit={naytaTilit}
            {...(muoto ? { muoto } : {})}
            {...(rajaus ? { tilirajaus: rajaus } : {})}
          />
        ) : (
          <p className="text-[13px] text-[var(--text-muted)]">Ladataan…</p>
        )}
      </section>
    </>
  );
}

/**
 * "Mikä tämä on?" valitsimen vieressä: selite aukeaa heti hiiren alla tai näppäimistöllä
 * kohdistettaessa (title-vihje viivästyisi ja jäisi tyylittömäksi).
 */
function RaportinOhje({ teksti }: { teksti: string }) {
  const id = useId();
  return (
    <span className="group relative pb-2">
      <button
        type="button"
        aria-describedby={id}
        className="inline-flex items-center gap-[5px] rounded-[4px] text-[12.5px] text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Info size={14} aria-hidden />
        Mikä tämä on?
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-10 mt-[-2px] w-[340px] rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-[12px] py-[10px] text-[12.5px] leading-[1.5] text-[var(--text)] opacity-0 shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {teksti}
      </span>
    </span>
  );
}

const VALITSIN_OTSIKKO =
  'flex max-w-xs flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const VALITSIN =
  'rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] normal-case tracking-normal font-normal text-[var(--text)]';
