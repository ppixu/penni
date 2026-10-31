import { useInit, useOstolaskut, useTosite } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { SuoritusDialog } from '@/laskutus/SuoritusDialog';
import { type LaskunTila, laskuTila } from '@/laskutus/laskuTila';
import { EdellinenSeuraava, useLaskuNaapurit } from '@/tositteet/EdellinenSeuraava.js';
import { lataaKartta, nimi, tiliAsetuksesta } from '@penni/engine';
import { Euro, muotoileEuro, muotoilePvm } from '@penni/euro';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { HyvitaVahvistus } from './HyvitaVahvistus.js';

const TILA_LABEL: Record<LaskunTila, string> = {
  avoin: 'Avoin',
  maksettu: 'Maksettu',
  eraantynyt: 'Erääntynyt',
};

/**
 * Ostolaskun luku-vain-näkymä: otsikkotiedot, tila (summa/maksettu/avoin + tilamerkki,
 * sama styling-idiomi kuin ostolaskulistalla) ja tositteen viennit taulukkona, sekä
 * suorituksen kirjaus (SuoritusDialog, sama proppien käyttö kuin myyntilaskulistalla).
 *
 * Data tulee kahdesta lähteestä: useTosite (viennit) ja useOstolaskut (avoin/summa/
 * toimittaja/tila-laskentaan tarvittavat kentät) — molemmat invalidoituvat suorituksen
 * kirjauksesta (useTallennaSuoritus invalidoi sekä 'ostolaskut' että 'tositteet').
 *
 * Tyyppisuojaus (spec §4): listaaOstolaskut-funktion sisäinen OSTOTYYPIT-joukko ei ole
 * julkinen, joten tarkistus tehdään ekvivalentisti rivihaun kautta: jos tosite on
 * olemassa mutta ostolaskulistalta ei löydy sille riviä, se ei ole ostolasku -> ohjaa
 * tositelistan Menot-rajaukseen (sama idiomi kuin myyntilaskun näytöllä, joka ohjaa vieraan
 * tositetyypin tositenäkymään). Kohde on '/tositteet?laji=menot' suoraan eikä '/ostolaskut'
 * tai '/menot' — ne ovat nykyään pelkkiä uudelleenohjausreittejä sinne, joten kohdistus
 * suoraan välttää turhat ylimääräiset hypyt.
 */
export function OstolaskuDetalji({ id }: { id: number }) {
  const navigate = useNavigate();
  const { data: tosite, isLoading: tositeLataa } = useTosite(id);
  const { data: rivit, isLoading: rivitLataa } = useOstolaskut({});
  const { data: init } = useInit();
  const [maksuAuki, setMaksuAuki] = useState(false);
  const [hyvitysAuki, setHyvitysAuki] = useState(false);
  const naapurit = useLaskuNaapurit(rivit, id);

  const rivi = rivit?.find((r) => r.tosite === id);
  const vieras = tosite != null && rivit != null && !rivi;
  useEffect(() => {
    if (vieras) void navigate({ to: '/tositteet', search: { laji: 'menot' }, replace: true });
  }, [vieras, navigate]);

  if (tositeLataa || rivitLataa || !init)
    return <p className="px-[22px] py-5 text-[var(--text-muted)]">Ladataan…</p>;
  if (!tosite)
    return (
      <>
        <TopBar otsikko="Ostolaskua ei löytynyt" />
        <section className="flex-1 px-[22px] py-5 text-[var(--text-muted)]">
          Ostolaskua {id} ei ole.
        </section>
      </>
    );
  if (!rivi) return null; // vieras tositetyyppi: uudelleenohjaus käynnissä (ks. yllä)

  const kartta = lataaKartta(init.tilit);
  const oletusRahatili = tiliAsetuksesta(init.asetukset, 'LaskuMaksutili');
  const tanaan = new Date().toISOString().slice(0, 10);
  const tila = laskuTila(rivi, tanaan);
  const maksettu = Euro.sub(rivi.summa, rivi.avoin);
  const tilaLuokka =
    tila === 'maksettu'
      ? 'text-[var(--text-subtle)]'
      : tila === 'eraantynyt'
        ? 'text-[var(--danger)]'
        : '';

  return (
    <>
      <TopBar
        otsikko={`Ostolasku ${rivi.viite ?? tosite.tunniste}`}
        toiminnot={
          <>
            <EdellinenSeuraava
              kohde="lasku"
              naapurit={naapurit}
              onSiirry={(seuraavaId) =>
                void navigate({ to: '/ostolaskut/$id', params: { id: String(seuraavaId) } })
              }
            />
            <Button
              variant="sec"
              type="button"
              disabled={rivi.avoin !== rivi.summa}
              onClick={() => setHyvitysAuki(true)}
            >
              Hyvitä
            </Button>
            <Button type="button" disabled={rivi.avoin <= 0} onClick={() => setMaksuAuki(true)}>
              Kirjaa suoritus
            </Button>
          </>
        }
      />
      <section aria-label="ostolaskunäkymä" className="flex-1 overflow-auto px-[22px] py-5">
        <div className="flex flex-wrap gap-8">
          <dl className="flex flex-col gap-1 text-[13px]">
            <div className="flex justify-between gap-4">
              <dt className="font-semibold">Toimittaja</dt>
              <dd>{rivi.toimittaja ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-semibold">Viite</dt>
              <dd>{rivi.viite ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-semibold">Laskun päivämäärä</dt>
              <dd>{muotoilePvm(rivi.pvm ?? '')}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-semibold">Eräpäivä</dt>
              <dd>{muotoilePvm(rivi.erapvm ?? '')}</dd>
            </div>
          </dl>

          <dl className="flex flex-col gap-1 text-[13px]">
            <div className="flex justify-between gap-4">
              <dt className="font-semibold">Summa</dt>
              <dd>{muotoileEuro(rivi.summa)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-semibold">Maksettu</dt>
              <dd>{muotoileEuro(maksettu)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-semibold">Avoinna</dt>
              <dd>{muotoileEuro(rivi.avoin)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-semibold">Tila</dt>
              <dd className={tilaLuokka} data-tila={tila}>
                {TILA_LABEL[tila]}
              </dd>
            </div>
          </dl>
        </div>

        <table className="mt-6 w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {['Tili', 'Selite', 'Debet', 'Kredit'].map((h, i) => (
                <th
                  key={h}
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
            {tosite.viennit.map((v, i) => {
              const tili = kartta.find((t) => t.numero === v.tili);
              return (
                <tr
                  // Vienneillä ei ole omaa id:tä; rivijärjestys on vakaa ja näkymä read-only.
                  // biome-ignore lint/suspicious/noArrayIndexKey: vakaa järjestys, read-only näyttö
                  key={i}
                  className="border-t border-[var(--border)]"
                >
                  <td className="px-[10px] py-[9px]">
                    {tili ? `${v.tili} ${nimi(tili)}` : v.tili}
                  </td>
                  <td className="px-[10px] py-[9px] text-[var(--text-muted)]">{v.selite ?? '—'}</td>
                  <td className="px-[10px] py-[9px] text-right tabular-nums">
                    {v.debet ? muotoileEuro(v.debet) : '—'}
                  </td>
                  <td className="px-[10px] py-[9px] text-right tabular-nums">
                    {v.kredit ? muotoileEuro(v.kredit) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {maksuAuki && (
        <SuoritusDialog
          lasku={rivi}
          tilit={kartta}
          oletusRahatili={oletusRahatili}
          onPeruuta={() => setMaksuAuki(false)}
          onSuljeJaPaivita={() => setMaksuAuki(false)}
        />
      )}

      {hyvitysAuki && (
        <HyvitaVahvistus
          tosite={id}
          onPeruuta={() => setHyvitysAuki(false)}
          onValmis={() => setHyvitysAuki(false)}
        />
      )}
    </>
  );
}
