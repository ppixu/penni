import {
  useBudjetoidutKohdennukset,
  useInit,
  useKohdennukset,
  usePoistaKohdennus,
  useTallennaKohdennus,
} from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { jarjesta, nykyisenTilikaudenIndeksi, paikallinenTanaan } from '@/tositteet/pikavalinnat';
import {
  type KohdennusKaytolla,
  KohdennusTyyppi,
  ResourceError,
  kohdennuksenNimi,
  kohdennuksenPolku,
} from '@penni/engine';
import { type ReactNode, useState } from 'react';
import { KohdennusLomake } from './KohdennusLomake';
import { kohdennusTyyppiNimi, kohdennustenRyhmat, voimassaTeksti } from './kohdennusTeksti';

type Muokkaus =
  | { tila: 'uusi'; tyyppi: 1 | 2 | 3 }
  | { tila: 'muokkaa'; kohdennus: KohdennusKaytolla };

function virheTeksti(e: unknown): string | null {
  if (e === null || e === undefined) return null;
  return e instanceof ResourceError && e.message ? e.message : 'Tallennus epäonnistui.';
}

/** Miksi poisto on estetty (tooltip); undefined = sallittu. Peilaa engineen `poistaKohdennus`. */
function poistonEste(
  k: KohdennusKaytolla,
  kaikki: readonly KohdennusKaytolla[],
): string | undefined {
  if (k.lkm > 0) return `Käytössä ${k.lkm} viennillä`;
  if (k.tyyppi === KohdennusTyyppi.KUSTANNUSPAIKKA && kaikki.some((x) => x.kuuluu === k.id))
    return 'Kustannuspaikalla on projekteja';
  return undefined;
}

const OHJE =
  'Kohdennuksilla seuraat, mihin toimintaan tulot ja menot kuuluvat. Kustannuspaikka on toiminto tai paikka, esim. Nuorisotoiminta tai Kerhotalo. Projekti on yksittäinen hanke, joka kuuluu kustannuspaikkaan tai Yleiseen, esim. Kesäleiri nuorisotoiminnan alla. Merkkaus on tunniste, joka kulkee kustannuspaikkojen läpi, esim. Avustus; yhdellä rivillä voi olla useita merkkauksia. Voit katsoa kustannuspaikkojen ja projektien tuloslaskelmat Raportit-sivulta ja vertailla niitä budjettiin.';

export function KohdennuksetSivu() {
  const { data: kohdennukset, isLoading } = useKohdennukset();
  const { data: init } = useInit();
  const tallenna = useTallennaKohdennus();
  const poista = usePoistaKohdennus();
  const [muokkaus, setMuokkaus] = useState<Muokkaus | null>(null);
  const [poistettava, setPoistettava] = useState<number | null>(null);

  const kaikki = kohdennukset ?? [];
  const ryhmat = kohdennustenRyhmat(kaikki);

  // Määräaikaisuuden oletus: tilikausi, jolla tänään on (lähin, jos tänään on kausien ulkopuolella).
  const kaudet = jarjesta(init?.tilikaudet ?? []);
  const oletusKausi = kaudet[nykyisenTilikaudenIndeksi(kaudet, paikallinenTanaan())];
  // Budjetoidun kohdennuksen tyyppi lukitaan (moottori estää vaihdon).
  const budjetoidut = useBudjetoidutKohdennukset(kaudet.map((k) => k.alkaa));

  function avaa(m: Muokkaus) {
    tallenna.reset();
    poista.reset();
    setPoistettava(null);
    setMuokkaus(m);
  }

  function rivi(k: KohdennusKaytolla, taso: 0 | 1) {
    const polku = kohdennuksenPolku(k, kaikki);
    const este = poistonEste(k, kaikki);
    const voimassa = voimassaTeksti(k);
    return (
      <li
        key={k.id}
        data-taso={taso}
        className="flex items-center gap-4 border-t border-[var(--border)] py-[6px] text-[12.5px] hover:bg-[var(--bg-subtle)]"
      >
        <button
          type="button"
          aria-label={`Muokkaa ${polku}`}
          onClick={() => avaa({ tila: 'muokkaa', kohdennus: k })}
          style={{ paddingLeft: taso * 22 }}
          className="min-w-[200px] flex-1 text-left font-[550] text-[var(--text)] hover:text-[var(--accent)]"
        >
          {kohdennuksenNimi(k)}
        </button>
        <span className="w-[120px] text-[var(--text-muted)]">{kohdennusTyyppiNimi(k.tyyppi)}</span>
        <span className="w-[210px] tabular-nums text-[var(--text-muted)]">{voimassa}</span>
        <span
          className="w-[50px] text-right tabular-nums text-[var(--text-muted)]"
          title="Kohdennusta käyttävät viennit"
        >
          {k.lkm > 0 ? k.lkm : '—'}
        </span>
        <span className="flex w-[190px] justify-end gap-2" title={este}>
          {poistettava === k.id ? (
            <>
              <Button
                size="compact"
                aria-label={`Vahvista poisto: ${polku}`}
                disabled={poista.isPending}
                onClick={() =>
                  poista.mutate(k.id, {
                    onSuccess: () => {
                      setPoistettava(null);
                      setMuokkaus(null);
                    },
                  })
                }
              >
                Poista
              </Button>
              <Button size="compact" variant="sec" onClick={() => setPoistettava(null)}>
                Peruuta
              </Button>
            </>
          ) : (
            <Button
              size="compact"
              variant="sec"
              aria-label={`Poista ${polku}`}
              disabled={este !== undefined}
              title={este}
              onClick={() => {
                poista.reset();
                setPoistettava(k.id);
              }}
            >
              Poista
            </Button>
          )}
        </span>
      </li>
    );
  }

  function ryhma(otsikko: string, children: ReactNode) {
    return (
      <section key={otsikko} aria-label={otsikko} className="mb-6">
        <h2 className="mb-1 text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
          {otsikko}
        </h2>
        <ul className="flex flex-col">{children}</ul>
      </section>
    );
  }

  const lomakkeenVirhe = virheTeksti(tallenna.error);
  const poistoVirhe = virheTeksti(poista.error);

  return (
    <>
      <TopBar
        otsikko="Kohdennukset"
        toiminnot={
          <>
            <Button size="compact" onClick={() => avaa({ tila: 'uusi', tyyppi: 1 })}>
              Uusi kustannuspaikka
            </Button>
            <Button size="compact" onClick={() => avaa({ tila: 'uusi', tyyppi: 2 })}>
              Uusi projekti
            </Button>
            <Button size="compact" onClick={() => avaa({ tila: 'uusi', tyyppi: 3 })}>
              Uusi merkkaus
            </Button>
          </>
        }
      />
      <section aria-label="kohdennukset" className="flex-1 overflow-auto px-[22px] py-5">
        <details className="mb-5 max-w-[640px] text-[12.5px] leading-[1.5]">
          <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text)]">
            Mikä tämä on?
          </summary>
          <p className="mt-2">{OHJE}</p>
        </details>

        {muokkaus && (
          <KohdennusLomake
            // Uusi lomake aina, kun avataan eri kohdennus tai uusi tyyppi: kenttätila alkaa puhtaana.
            key={muokkaus.tila === 'muokkaa' ? muokkaus.kohdennus.id : `uusi-${muokkaus.tyyppi}`}
            alkuarvo={muokkaus.tila === 'muokkaa' ? muokkaus.kohdennus : undefined}
            tyyppi={muokkaus.tila === 'uusi' ? muokkaus.tyyppi : undefined}
            kaikki={kaikki}
            budjetoitu={
              muokkaus.tila === 'muokkaa' && (budjetoidut?.has(muokkaus.kohdennus.id) ?? false)
            }
            oletusKausi={oletusKausi}
            tallentaa={tallenna.isPending}
            virhe={lomakkeenVirhe}
            onPeruuta={() => setMuokkaus(null)}
            onTallenna={(syote) => tallenna.mutate(syote, { onSuccess: () => setMuokkaus(null) })}
          />
        )}

        {poistoVirhe && (
          <p role="alert" className="mb-3 text-[12.5px] text-[var(--danger)]">
            {poistoVirhe}
          </p>
        )}

        {!isLoading && kaikki.length === 0 ? (
          <p className="text-[13.5px] text-[var(--text-muted)]">Ei kohdennuksia.</p>
        ) : (
          <>
            {ryhmat.kustannuspaikat.length > 0 &&
              ryhma(
                'Kustannuspaikat',
                ryhmat.kustannuspaikat.flatMap((r) => [
                  rivi(r.kustannuspaikka, 0),
                  ...r.projektit.map((p) => rivi(p, 1)),
                ]),
              )}
            {ryhmat.yleiset.length > 0 &&
              ryhma(
                'Yleinen',
                ryhmat.yleiset.map((p) => rivi(p, 1)),
              )}
            {ryhmat.merkkaukset.length > 0 &&
              ryhma(
                'Merkkaukset',
                ryhmat.merkkaukset.map((m) => rivi(m, 0)),
              )}
          </>
        )}
      </section>
    </>
  );
}
