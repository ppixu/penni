import { useInit, usePoistaTuote, useTuotteet } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { muotoileAlvProsentti } from '@/editori/AlvValitsin';
import { TuoteDialog } from '@/laskutus/TuoteDialog';
import { type Tuote, lataaKartta, nimi as tilinNimi } from '@penni/engine';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

export const Route = createFileRoute('/tuotteet/')({ component: Tuotteet });

const hintaMuoto = new Intl.NumberFormat('fi-FI', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function Tuotteet() {
  const { data: tuotteet, isLoading, isError } = useTuotteet();
  const { data: init } = useInit();
  const { poista, virheviesti: poistoVirhe } = usePoistaTuote();
  const [haku, setHaku] = useState('');
  const [uusi, setUusi] = useState(false);
  const [muokattava, setMuokattava] = useState<Tuote | null>(null);
  const [poistettava, setPoistettava] = useState<Tuote | null>(null);

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

  const nakyvat = useMemo(() => {
    const hakusana = haku.trim().toLocaleLowerCase('fi');
    return [...(tuotteet ?? [])]
      .filter(
        (t) =>
          hakusana === '' ||
          t.nimike.toLocaleLowerCase('fi').includes(hakusana) ||
          (t.koodi ?? '').toLocaleLowerCase('fi').includes(hakusana),
      )
      .sort((a, b) => a.nimike.localeCompare(b.nimike, 'fi'));
  }, [tuotteet, haku]);

  async function vahvistaPoisto() {
    if (!poistettava) return;
    if (await poista(poistettava.id)) setPoistettava(null);
  }

  const otsikot = ['Nimike', 'Koodi', 'Hinta (alv 0)', 'Alv', 'Tili', ''];

  return (
    <>
      <TopBar
        otsikko="Tuotteet"
        toiminnot={
          <>
            <Button variant="sec" size="compact" asChild>
              <Link to="/tositteet" search={{ laji: 'tulot', valilehti: 'lahtevat' }}>
                Lähtevät
              </Link>
            </Button>
            <Button size="compact" type="button" onClick={() => setUusi(true)}>
              + Uusi tuote
            </Button>
          </>
        }
      />
      <section aria-label="tuotteet" className="flex-1 overflow-auto px-[22px] py-5">
        {isError ? (
          <p role="alert">Tuotteiden lataaminen epäonnistui. Kokeile uudelleen.</p>
        ) : isLoading ? (
          <output className="block">Ladataan tuotteita…</output>
        ) : !tuotteet || tuotteet.length === 0 ? (
          <p className="text-[13.5px] text-[var(--text-muted)]">
            Ei tuotteita. Tuoterekisterin tuotteet ehdotetaan laskun selitekentässä kirjoitettaessa,
            ja valittu tuote täyttää rivin hinnan, alv:n ja tilin.
          </p>
        ) : (
          <>
            <input
              type="search"
              aria-label="Hae tuotteita"
              placeholder="Hae nimikkeellä tai koodilla"
              value={haku}
              onChange={(e) => setHaku(e.target.value)}
              className="mb-3 w-[300px] rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]"
            />
            {nakyvat.length === 0 ? (
              <p className="text-[13.5px] text-[var(--text-muted)]">
                Ei hakua vastaavia tuotteita.
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
                  {nakyvat.map((t) => (
                    <tr key={t.id} className="border-t border-[var(--border)]">
                      <td className="px-[10px] py-[9px]">{t.nimike}</td>
                      <td className="px-[10px] py-[9px]">
                        {t.koodi ?? <span className="text-[var(--text-subtle)]">—</span>}
                      </td>
                      <td className="px-[10px] py-[9px] tabular-nums">
                        {hintaMuoto.format(t.aNetto)}
                      </td>
                      <td className="px-[10px] py-[9px] tabular-nums">
                        {muotoileAlvProsentti(t.alvProsentti)}
                      </td>
                      <td className="px-[10px] py-[9px]">
                        {t.tili !== undefined ? (
                          tilinTeksti(t.tili)
                        ) : (
                          <span className="text-[var(--text-subtle)]">—</span>
                        )}
                      </td>
                      <td className="px-[10px] py-[9px]">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="sec"
                            size="compact"
                            type="button"
                            onClick={() => setMuokattava(t)}
                          >
                            Muokkaa
                          </Button>
                          <Button
                            variant="sec"
                            size="compact"
                            type="button"
                            onClick={() => setPoistettava(t)}
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
          </>
        )}
      </section>

      {uusi && <TuoteDialog onPeruuta={() => setUusi(false)} onValmis={() => setUusi(false)} />}
      {muokattava && (
        <TuoteDialog
          key={muokattava.id}
          tuote={muokattava}
          onPeruuta={() => setMuokattava(null)}
          onValmis={() => setMuokattava(null)}
        />
      )}
      {poistettava && (
        <div
          // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
          role="dialog"
          aria-modal="true"
          aria-label="Poista tuote"
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
        >
          <div className="w-[380px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
            <h2 className="mb-4 text-[15px] font-[650]">Poista tuote</h2>
            <p className="text-[13px]">
              Poistetaanko tuote {poistettava.nimike}? Laskuille jo kopioidut rivit säilyvät
              ennallaan.
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
