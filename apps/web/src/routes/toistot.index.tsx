import {
  useKumppanit,
  useLuoErantyneetToistot,
  usePoistaToisto,
  useTallennaToisto,
  useToistot,
} from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { ToistoMuokkausDialog } from '@/laskutus/ToistoMuokkausDialog';
import { paikallinenTanaan } from '@/tositteet/pikavalinnat';
import type { ErantyneetToistot, Toisto } from '@penni/engine';
import { muotoilePvm } from '@penni/euro';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/toistot/')({ component: ToistuvatLaskut });

/** Toisto on päättynyt, kun päättymispäivä on ohitettu (moottori kytkee silloin aktiivisuuden pois). */
function onPaattynyt(t: Toisto): boolean {
  return !t.aktiivinen && t.loppuu !== undefined && t.seuraava > t.loppuu;
}

function tilaTeksti(t: Toisto): string {
  if (onPaattynyt(t)) return 'Päättynyt';
  return t.aktiivinen ? 'Aktiivinen' : 'Keskeytetty';
}

/** Käsin ajetun luonnin tulos käyttäjälle. */
function tulosTeksti(t: ErantyneetToistot): string {
  if (t.ohitettu === 'EITILIKAUTTA') return 'Tälle päivälle ei ole tilikautta, luontia ei tehty';
  if (t.ohitettu === 'LUKITTU') return 'Päivä on lukitussa tilikaudessa, luontia ei tehty';
  if (t.luodut.length === 0) return 'Ei erääntyneitä toistoja';
  return t.luodut.length === 1
    ? '1 toistuva lasku odottaa Lähtevissä'
    : `${t.luodut.length} toistuvaa laskua odottaa Lähtevissä`;
}

function ToistuvatLaskut() {
  const { data: toistot, isLoading, isError } = useToistot();
  const { data: kumppanit } = useKumppanit();
  const { tallenna, virheviesti: tallennusVirhe } = useTallennaToisto();
  const { poista, virheviesti: poistoVirhe } = usePoistaToisto();
  const { luo, virheviesti: luontiVirhe, luomassa } = useLuoErantyneetToistot();
  const [poistettava, setPoistettava] = useState<Toisto | null>(null);
  const [muokattava, setMuokattava] = useState<Toisto | null>(null);
  const [tulos, setTulos] = useState<ErantyneetToistot | null>(null);

  const asiakas = (t: Toisto) =>
    t.kumppani === undefined ? undefined : kumppanit?.find((k) => k.id === t.kumppani)?.nimi;

  async function luoNyt() {
    setTulos(null);
    const t = await luo(paikallinenTanaan());
    if (t) setTulos(t);
  }

  async function vahvistaPoisto() {
    if (!poistettava) return;
    if (await poista(poistettava.id)) setPoistettava(null);
  }

  const virhe = tallennusVirhe ?? luontiVirhe;

  return (
    <>
      <TopBar
        otsikko="Toistuvat laskut"
        toiminnot={
          <>
            <Button variant="sec" size="compact" asChild>
              <Link to="/tositteet" search={{ laji: 'tulot', valilehti: 'lahtevat' }}>
                Lähtevät
              </Link>
            </Button>
            <Button size="compact" type="button" disabled={luomassa} onClick={() => void luoNyt()}>
              Luo erääntyneet nyt
            </Button>
          </>
        }
      />
      <section aria-label="toistuvat laskut" className="flex-1 overflow-auto px-[22px] py-5">
        {tulos && (
          <output className="mb-3 flex items-center gap-3 text-[12.5px]">
            <span>{tulosTeksti(tulos)}</span>
            {tulos.luodut.length > 0 && (
              <Link
                to="/tositteet"
                search={{ laji: 'tulot', valilehti: 'lahtevat' }}
                className="font-semibold text-[var(--accent)]"
              >
                Avaa Lähtevät
              </Link>
            )}
          </output>
        )}
        {virhe && (
          <p role="alert" className="mb-3 text-[12.5px] text-[var(--danger)]">
            {virhe}
          </p>
        )}
        {isError ? (
          <p role="alert">Toistuvien laskujen lataaminen epäonnistui. Kokeile uudelleen.</p>
        ) : isLoading ? (
          <output className="block">Ladataan toistuvia laskuja…</output>
        ) : !toistot || toistot.length === 0 ? (
          <p className="text-[13.5px] text-[var(--text-muted)]">
            Ei toistuvia laskuja. Toiston voi luoda kirjatun myyntilaskun sivulta painikkeella
            Toista.
          </p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Asiakas', 'Väli', 'Seuraava', 'Päättyy', 'Tila', ''].map((otsikko) => (
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
              {toistot.map((t) => (
                <tr key={t.id} className="border-t border-[var(--border)]">
                  <td className="px-[10px] py-[9px]">
                    {asiakas(t) ?? <span className="text-[var(--text-subtle)]">—</span>}
                    {t.nimi && (
                      <div className="text-[11.5px] text-[var(--text-muted)]">{t.nimi}</div>
                    )}
                  </td>
                  <td className="px-[10px] py-[9px] tabular-nums">{t.kuukausia} kk</td>
                  <td className="px-[10px] py-[9px] tabular-nums">{muotoilePvm(t.seuraava)}</td>
                  <td className="px-[10px] py-[9px] tabular-nums">
                    {t.loppuu ? (
                      muotoilePvm(t.loppuu)
                    ) : (
                      <span className="text-[var(--text-subtle)]">—</span>
                    )}
                  </td>
                  <td className="px-[10px] py-[9px]">{tilaTeksti(t)}</td>
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
                      {!onPaattynyt(t) && (
                        <Button
                          variant="sec"
                          size="compact"
                          type="button"
                          onClick={() => void tallenna({ ...t, aktiivinen: !t.aktiivinen })}
                        >
                          {t.aktiivinen ? 'Keskeytä' : 'Jatka'}
                        </Button>
                      )}
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
      </section>

      {muokattava && (
        <ToistoMuokkausDialog
          key={muokattava.id}
          toisto={muokattava}
          onPeruuta={() => setMuokattava(null)}
          onValmis={() => setMuokattava(null)}
        />
      )}
      {poistettava && (
        <div
          // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
          role="dialog"
          aria-modal="true"
          aria-label="Poista toisto"
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
        >
          <div className="w-[380px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
            <h2 className="mb-4 text-[15px] font-[650]">Poista toisto</h2>
            <p className="text-[13px]">
              Poistetaanko toistuva lasku
              {asiakas(poistettava) ? ` (${asiakas(poistettava)})` : ''}? Jo luodut luonnokset ja
              kirjatut laskut säilyvät, mutta uusia ei enää synny.
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
