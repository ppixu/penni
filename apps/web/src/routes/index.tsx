import { verokausiHistoria, viimeisinIlmoitettu } from '@/alv/alvKaudet';
import { useInit, useSaldot, useTositteet } from '@/app/kysely';
import { KpiKortti } from '@/components/KpiKortti';
import { TositeSumma } from '@/components/TositeSumma';
import { TositeTyyppiIkoni } from '@/components/TositeTyyppiIkoni';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { RengasKaavio } from '@/kojelauta/RengasKaavio';
import { TulosvirtaKaavio } from '@/kojelauta/TulosvirtaKaavio';
import { type Huomio, kojelaudanHuomiot } from '@/kojelauta/huomiot';
import { tulosjako } from '@/kojelauta/tulosjako';
import { tositeTyyppiLabel } from '@/lib/tosite';
import { cn } from '@/lib/utils';
import { useValittuTilikausi } from '@/tilikausi/valittuTilikausi';
import { paikallinenTanaan } from '@/tositteet/pikavalinnat';
import { lueTositeSuodattimet, tallennaTositeSuodattimet } from '@/tositteet/suodattimet';
import { onkoTyopoyta } from '@/tuonti/silta';
import { Luonne, TositeTyyppi, lataaKartta, nimi, onko, tiliTyypilla } from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Lightbulb, OctagonAlert, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';

export const Route = createFileRoute('/')({ component: Kojelauta });

// /tositteet/uusi arrives in 0E-2b; a string-typed target (as Sidebar does for its nav) keeps
// the typed router from rejecting the not-yet-generated path.
const UUSI_TOSITE: string = '/tositteet/uusi';
const TUONTI: string = '/tuonti';

const OTSIKKO =
  'mb-2 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

/** Saldotaulun ryhmä tilinumeron ensimmäisestä numerosta (Kitsas aloitusbrowser.cpp:432-438). */
function saldoRyhma(numero: number): 'Vastaavaa' | 'Vastattavaa' | 'Tuloslaskelma' {
  const eka = String(numero)[0];
  return eka === '1' ? 'Vastaavaa' : eka === '2' ? 'Vastattavaa' : 'Tuloslaskelma';
}

function Kojelauta() {
  const navigate = useNavigate();
  const { data: init } = useInit();
  const { kausi, kaudet } = useValittuTilikausi();
  const tanaan = paikallinenTanaan();
  // Kitsas: /saldot?pvm=kauden loppu — tase kumulatiivisena, tuloslaskelma kauden ajalta.
  const { data: saldot } = useSaldot({ pvm: kausi?.loppuu ?? '' }, Boolean(kausi));
  const kaudelta = kausi ? { alkupvm: kausi.alkaa, loppupvm: kausi.loppuu } : {};
  const { data: tositteet } = useTositteet(
    { bucket: 'kirjanpidossa', ...kaudelta },
    init !== undefined,
  );
  const { data: luonnokset } = useTositteet({ bucket: 'luonnos', ...kaudelta }, init !== undefined);
  const { data: alvIlmoitukset } = useTositteet({ tyyppi: TositeTyyppi.ALVLASKELMA });

  const chart = useMemo(() => (init ? lataaKartta(init.tilit) : []), [init]);
  const summa = (mask: number): Cents =>
    chart
      .filter((t) => onko(t.luonne, mask))
      .reduce((s, t) => s + (saldot?.get(t.numero) ?? 0), 0) as Cents;
  const yksi = (mask: number): Cents => {
    const t = tiliTyypilla(chart, mask);
    return (t ? (saldot?.get(t.numero) ?? 0) : 0) as Cents;
  };

  const tulos = yksi(Luonne.KAUDENTULOS);
  const pankki = summa(Luonne.PANKKITILI);
  const saatavat = summa(Luonne.MYYNTISAATAVA);
  const alvVelka = yksi(Luonne.ALVVELKA);

  // Saldotaulu: kaikki tilit, joilla on saldoa, numerojärjestyksessä ryhmittäin.
  const saldoRivit = useMemo(() => {
    const nimet = new Map(chart.map((t) => [t.numero, nimi(t)]));
    return [...(saldot ?? [])]
      .filter(([, s]) => s !== 0)
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([numero, saldo]) => ({ numero, saldo, nimi: nimet.get(numero) ?? '' }));
  }, [saldot, chart]);

  // Kaaviot: Sankey tuloslaskelman pääryhmittäin, renkaat tileittäin (suurimmat + Muut).
  const virta = useMemo(
    () => (saldot ? tulosjako(chart, saldot, 'paaryhma', 6) : undefined),
    [chart, saldot],
  );
  const tileittain = useMemo(
    () => (saldot ? tulosjako(chart, saldot, 'tili', 6) : undefined),
    [chart, saldot],
  );

  const huomiot = useMemo<Huomio[]>(() => {
    if (!init || !saldot || !luonnokset || !alvIlmoitukset) return [];
    let vastaavaa = 0;
    let vastattavaa = 0;
    for (const [numero, s] of saldot) {
      if (saldoRyhma(numero) === 'Vastaavaa') vastaavaa += s;
      else if (saldoRyhma(numero) === 'Vastattavaa') vastattavaa += s;
    }
    return kojelaudanHuomiot({
      tanaan,
      asetukset: init.asetukset,
      tilikaudet: kaudet,
      kausiKk: verokausiHistoria(init.asetukset),
      alvIlmoitettuAsti: viimeisinIlmoitettu(init.asetukset.AlvIlmoitettu, alvIlmoitukset),
      luonnoksia: luonnokset.length,
      vastaavaa,
      vastattavaa,
    });
  }, [init, saldot, luonnokset, alvIlmoitukset, kaudet, tanaan]);

  const recent = [...(tositteet ?? [])]
    .sort((a, b) => (a.pvm < b.pvm ? 1 : a.pvm > b.pvm ? -1 : b.id - a.id))
    .slice(0, 10);

  return (
    <>
      <TopBar
        otsikko="Kojelauta"
        alaotsikko={
          init && kausi
            ? `${init.asetukset.Nimi ?? ''} · Tilikausi ${muotoilePvm(kausi.alkaa)}–${muotoilePvm(kausi.loppuu)}`
            : init?.asetukset.Nimi
        }
        toiminnot={
          <>
            {/* Tuonti lukee tiedoston suoraan levyltä työpöytäsillan kautta — piilossa pelkässä
                selaimessa (sama ehto kuin itse näkymän suojauksessa, ks. tuonti/silta.ts). */}
            {onkoTyopoyta() && (
              <Button asChild variant="sec">
                <Link to={TUONTI}>Tuo Kitsas-kirjanpito</Link>
              </Button>
            )}
            <Button asChild>
              <Link to={UUSI_TOSITE}>+ Uusi tosite</Link>
            </Button>
          </>
        }
      />
      <section aria-label="kojelauta" className="flex-1 overflow-auto px-[22px] py-5">
        {huomiot.length > 0 && (
          <ul aria-label="huomiot" className="mb-4 flex flex-col gap-2">
            {huomiot.map((h) => (
              <HuomioKortti key={h.avain} huomio={h} />
            ))}
          </ul>
        )}

        <div className="mb-5 grid grid-cols-4 gap-[10px]">
          <KpiKortti otsikko="Tilikauden tulos" arvo={tulos} positiivinenVihrea />
          <KpiKortti otsikko="Pankki" arvo={pankki} />
          <KpiKortti otsikko="Myyntisaatavat" arvo={saatavat} />
          <KpiKortti otsikko="ALV-velka" arvo={alvVelka} />
        </div>

        {virta && tileittain && (
          <div className="mb-6 grid items-start gap-[10px] xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section
              aria-label="tulot ja kulut"
              className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <h2 className={OTSIKKO}>Tulot ja kulut</h2>
              <TulosvirtaKaavio jako={virta} keskiNimi={init?.asetukset.Nimi || 'Yritys'} />
            </section>
            <section
              aria-label="jakauma"
              className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <h2 className={cn(OTSIKKO, '-mb-3')}>Suurimmat erät</h2>
              <RengasKaavio otsikko="Tulot" erat={tileittain.tulot} />
              <RengasKaavio otsikko="Kulut" erat={tileittain.kulut} />
            </section>
          </div>
        )}

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            <h2 className={OTSIKKO}>Viimeisimmät tositteet</h2>
            {tositteet === undefined ? (
              <p className="text-[13.5px] text-[var(--text-muted)]">Ladataan…</p>
            ) : recent.length === 0 ? (
              <p className="text-[13.5px] text-[var(--text-muted)]">
                Ei tositteita tällä tilikaudella.
              </p>
            ) : (
              <table className="w-full border-collapse text-[12.5px]">
                <tbody>
                  {recent.map((t) => {
                    const avaa = () =>
                      void navigate({ to: '/tositteet/$id', params: { id: String(t.id) } });
                    return (
                      <tr
                        key={t.id}
                        onClick={avaa}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            avaa();
                          }
                        }}
                        tabIndex={0}
                        className="cursor-pointer border-t border-[var(--border-faint)] hover:bg-[var(--bg-subtle)]"
                      >
                        <td className="w-[88px] py-[7px] pr-3 text-[var(--text-subtle)] tabular-nums">
                          {muotoilePvm(t.pvm)}
                        </td>
                        <td className="py-[7px] pr-3">
                          <div className="flex items-center gap-[10px]">
                            <TositeTyyppiIkoni tyyppi={t.tyyppi} />
                            {tositeTyyppiLabel(t.tyyppi)}
                            {t.otsikko ? ` · ${t.otsikko}` : ''}
                          </div>
                        </td>
                        <td className="py-[7px] text-right tabular-nums">
                          <TositeSumma tosite={t} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <Link
              to="/tositteet"
              className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--accent)] hover:underline"
            >
              Kaikki tositteet
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div>
            <h2 className={OTSIKKO}>Saldot {kausi ? muotoilePvm(kausi.loppuu) : ''}</h2>
            <SaldoTaulu rivit={saldoRivit} tulos={tulos} />
          </div>
        </div>
      </section>
    </>
  );
}

const HUOMIO_TYYLI = {
  virhe: {
    ikoni: OctagonAlert,
    luokka: 'border-[var(--danger)] bg-[var(--danger-soft)]',
    vari: 'text-[var(--danger)]',
  },
  varoitus: {
    ikoni: TriangleAlert,
    luokka: 'border-[var(--border)] bg-[var(--surface)]',
    vari: 'text-[var(--warning)]',
  },
  vinkki: {
    ikoni: Lightbulb,
    luokka: 'border-[var(--border)] bg-[var(--surface)]',
    vari: 'text-[var(--accent)]',
  },
} as const;

function HuomioKortti({ huomio }: { huomio: Huomio }) {
  const tyyli = HUOMIO_TYYLI[huomio.taso];
  const Ikoni = tyyli.ikoni;
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-[var(--radius-card)] border px-[14px] py-[10px]',
        tyyli.luokka,
      )}
    >
      <Ikoni className={cn('mt-[1px] h-4 w-4 shrink-0', tyyli.vari)} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[var(--text)]">{huomio.otsikko}</div>
        <div className="text-[12.5px] text-[var(--text-muted)]">{huomio.teksti}</div>
      </div>
      <Link
        to={huomio.linkki.to}
        // Luonnokset avautuvat tositelistan Luonnokset-välilehdelle (muistettu valinta).
        onClick={
          huomio.avain === 'luonnokset'
            ? () => tallennaTositeSuodattimet({ ...lueTositeSuodattimet(), bucket: 'luonnos' })
            : undefined
        }
        className="shrink-0 self-center text-[12.5px] font-medium text-[var(--accent)] hover:underline"
      >
        {huomio.linkki.label}
      </Link>
    </li>
  );
}

/**
 * Kitsaksen aloitussivun saldotaulu (aloitusbrowser.cpp:383-454): saldolliset tilit ryhmittäin
 * Vastaavaa / Vastattavaa / Tuloslaskelma ja lopuksi tilikauden tulos. Rivi avaa tilin
 * tilikartassa.
 */
function SaldoTaulu({
  rivit,
  tulos,
}: {
  rivit: readonly { numero: number; nimi: string; saldo: Cents }[];
  tulos: Cents;
}) {
  if (rivit.length === 0) {
    return <p className="text-[13.5px] text-[var(--text-muted)]">Ei saldoja.</p>;
  }
  let edellinen: string | null = null;
  return (
    <table aria-label="saldot" className="w-full border-collapse text-[12.5px]">
      <tbody>
        {rivit.flatMap((r) => {
          const ryhma = saldoRyhma(r.numero);
          const otsikko = ryhma !== edellinen;
          edellinen = ryhma;
          return [
            otsikko && (
              <tr key={`o-${ryhma}`}>
                <th
                  colSpan={2}
                  className="pb-1 pt-3 text-left text-[11.5px] font-semibold text-[var(--text)] first:pt-0"
                >
                  {ryhma}
                </th>
              </tr>
            ),
            <tr key={r.numero} className="border-t border-[var(--border-faint)]">
              <td className="py-[5px] pr-3">
                <Link
                  to="/tilikartta"
                  search={{ nakyma: 'kaikki', tili: r.numero }}
                  className="text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline"
                >
                  <span className="tabular-nums">{r.numero}</span> {r.nimi}
                </Link>
              </td>
              <td
                className={cn(
                  'py-[5px] text-right tabular-nums',
                  r.saldo < 0 && 'text-[var(--text-muted)]',
                )}
              >
                {muotoileEuro(r.saldo)}
              </td>
            </tr>,
          ];
        })}
        <tr className="border-t border-[var(--border-strong)]">
          <td className="pt-2 font-semibold">Tilikauden tulos</td>
          <td
            className={cn(
              'pt-2 text-right font-semibold tabular-nums',
              tulos >= 0 ? 'text-[var(--positive)]' : 'text-[var(--danger)]',
            )}
          >
            {muotoileEuro(tulos)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
