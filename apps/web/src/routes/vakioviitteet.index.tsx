import { useInit, usePoistaVakioviite, useVakioviitteet } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { VakioviiteDialog } from '@/laskutus/VakioviiteDialog';
import { type Vakioviite, lataaKartta, nimi as tilinNimi } from '@penni/engine';
import { muotoileViite } from '@penni/validator';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

export const Route = createFileRoute('/vakioviitteet/')({ component: Vakioviitteet });

function Vakioviitteet() {
  const { data: viitteet, isLoading, isError } = useVakioviitteet();
  const { data: init } = useInit();
  const { poista, virheviesti: poistoVirhe } = usePoistaVakioviite();
  const [uusi, setUusi] = useState(false);
  const [muokattava, setMuokattava] = useState<Vakioviite | null>(null);
  const [poistettava, setPoistettava] = useState<Vakioviite | null>(null);

  const tilinTeksti = useMemo(() => {
    const kartta = new Map(
      (init ? lataaKartta(init.tilit) : [])
        .filter((t) => t.otsikkotaso === 0)
        .map((t) => [t.numero, t]),
    );
    return (numero: number) => {
      const tili = kartta.get(numero);
      return tili ? `${numero} ${tilinNimi(tili)}` : String(numero);
    };
  }, [init]);
  const naytaKohdennus = (init?.kohdennukset.length ?? 0) > 0;

  async function vahvistaPoisto() {
    if (!poistettava) return;
    if (await poista(poistettava.viite)) setPoistettava(null);
  }

  const otsikot = ['Viite', 'Otsikko', 'Tili', ...(naytaKohdennus ? ['Kohdennus'] : []), ''];

  return (
    <>
      <TopBar
        otsikko="Vakioviitteet"
        toiminnot={
          <>
            <Button variant="sec" size="compact" asChild>
              <Link to="/tositteet" search={{ laji: 'tulot', valilehti: 'lahtevat' }}>
                Lähtevät
              </Link>
            </Button>
            <Button size="compact" type="button" onClick={() => setUusi(true)}>
              + Uusi vakioviite
            </Button>
          </>
        }
      />
      <section aria-label="vakioviitteet" className="flex-1 overflow-auto px-[22px] py-5">
        {isError ? (
          <p role="alert">Vakioviitteiden lataaminen epäonnistui. Kokeile uudelleen.</p>
        ) : isLoading ? (
          <output className="block">Ladataan vakioviitteitä…</output>
        ) : !viitteet || viitteet.length === 0 ? (
          <p className="text-[13.5px] text-[var(--text-muted)]">
            Ei vakioviitteitä. Vakioviitteellä maksu kohdistuu pankkiaineistossa suoraan tilille,
            esimerkiksi jäsenmaksuille tai lahjoituksille.
          </p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {otsikot.map((otsikko) => (
                  <th
                    key={otsikko || 'toiminnot'}
                    className="px-[10px] pb-[7px] text-left text-[11px] font-semibold text-[var(--text-subtle)]"
                  >
                    {otsikko}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {viitteet.map((v) => (
                <tr key={v.viite} className="border-t border-[var(--border)]">
                  <td className="px-[10px] py-[9px] tabular-nums">{muotoileViite(v.viite)}</td>
                  <td className="px-[10px] py-[9px]">{v.otsikko}</td>
                  <td className="px-[10px] py-[9px]">{tilinTeksti(v.tili)}</td>
                  {naytaKohdennus && (
                    <td className="px-[10px] py-[9px] tabular-nums">
                      {v.kohdennus ?? <span className="text-[var(--text-subtle)]">—</span>}
                    </td>
                  )}
                  <td className="px-[10px] py-[9px]">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="sec"
                        size="compact"
                        type="button"
                        onClick={() => setMuokattava(v)}
                      >
                        Muokkaa
                      </Button>
                      <Button
                        variant="sec"
                        size="compact"
                        type="button"
                        onClick={() => setPoistettava(v)}
                      >
                        Poista
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {uusi && (
        <VakioviiteDialog onPeruuta={() => setUusi(false)} onValmis={() => setUusi(false)} />
      )}
      {muokattava && (
        <VakioviiteDialog
          key={muokattava.viite}
          vakioviite={muokattava}
          onPeruuta={() => setMuokattava(null)}
          onValmis={() => setMuokattava(null)}
        />
      )}
      {poistettava && (
        <div
          // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
          role="dialog"
          aria-modal="true"
          aria-label="Poista vakioviite"
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
        >
          <div className="w-[380px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
            <h2 className="mb-4 text-[15px] font-[650]">Poista vakioviite</h2>
            <p className="text-[13px]">
              Poistetaanko vakioviite {muotoileViite(poistettava.viite)} ({poistettava.otsikko})? Jo
              kirjatut tositteet säilyvät, mutta viitteellä tulevat maksut eivät enää kohdistu
              automaattisesti.
            </p>
            {poistoVirhe && (
              <p role="alert" className="mt-3 text-[12.5px] text-[var(--danger)]">
                {poistoVirhe}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="sec" type="button" onClick={() => setPoistettava(null)}>
                Peruuta
              </Button>
              <Button type="button" onClick={() => void vahvistaPoisto()}>
                Poista
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
