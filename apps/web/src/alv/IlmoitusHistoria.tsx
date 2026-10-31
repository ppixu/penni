import { usePoistaAlvIlmoitus } from '@/app/kysely';
import { TaittuvaOtsikko } from '@/components/TaittuvaOtsikko';
import { Button } from '@/components/ui/button';
import { Luonne, type StoredTosite, type Tili, onko } from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { type AlvKausi, type KausiPituus, alvErapaiva, parsiIlmoitusOtsikko } from './alvKaudet.js';

/** Legacy-vahvistusteksti (alvsivu.cpp:158-159). */
const POISTOVAHVISTUS =
  'Haluatko todellakin poistaa valitun alv-ilmoituksen?\nPoistamisen jälkeen sinun on laadittava uusi alv-ilmoitus.';

const OTSIKKOLUOKKA =
  'pb-[7px] text-left text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

/**
 * Annetut alv-ilmoitukset (spec §6): ALVLASKELMA-tositteet pvm laskevasti. Kausi parsitaan
 * tositteen otsikosta (moottorin ainoa kirjoittaja tuottaa muodon "Arvonlisävero alku –
 * loppu"); parsinnan epäonnistuessa näytetään vain tositepäivä eikä riviä voi valita.
 * Poisto on sallittu vain uusimmalle ilmoitukselle (parsittu loppupvm === AlvIlmoitettu);
 * poisto kelaa rajan taaksepäin usePoistaAlvIlmoitus-hookissa. Kauden esikirjauksia
 * (MARGINAALILASKELMA/JARJESTELMATOSITE) ei poisteta — itsenäisiä, laillisia kirjauksia.
 */
export function IlmoitusHistoria({
  ilmoitukset,
  kausiKk,
  raja,
  tilit,
  onValitse,
}: {
  ilmoitukset: readonly StoredTosite[];
  kausiKk: KausiPituus;
  /** asetukset.AlvIlmoitettu — vain tähän päättyvän (uusimman) ilmoituksen voi poistaa. */
  raja: string | undefined;
  tilit: readonly Tili[];
  onValitse: (kausi: AlvKausi) => void;
}) {
  const { poista, virheviesti, poistaa } = usePoistaAlvIlmoitus();
  const [auki, setAuki] = useState(true);
  const sisaltoId = useId();
  // VEROVELKA-luonteiset tilit Maksettava-sarakkeen johtamiseen tilitysviennistä —
  // ei rinnakkaista rahalaskentaa, summa luetaan kirjatusta viennistä.
  const verovelkaTilit = new Set(
    tilit.filter((tili) => onko(tili.luonne, Luonne.VEROVELKA)).map((tili) => tili.numero),
  );
  const rivit = [...ilmoitukset].sort((a, b) =>
    a.pvm < b.pvm ? 1 : a.pvm > b.pvm ? -1 : b.id - a.id,
  );

  /** Tilitystositteen maksettava = VEROVELKA-tilin viennin kredit − debet; ilman
   *  VEROVELKA-vientiä (vero == vähennys) 0. */
  function maksettava(tosite: StoredTosite): Cents {
    let summa = 0;
    for (const vienti of tosite.viennit) {
      if (verovelkaTilit.has(vienti.tili)) summa += vienti.kredit - vienti.debet;
    }
    return summa as Cents;
  }

  return (
    <section aria-label="annetut-ilmoitukset" className="flex max-w-2xl flex-col gap-2">
      <h2 className="text-[15px] font-[650]">
        <TaittuvaOtsikko auki={auki} hallitsee={sisaltoId} onVaihda={() => setAuki((a) => !a)}>
          Annetut ilmoitukset
        </TaittuvaOtsikko>
      </h2>
      <div id={sisaltoId} className={auki ? 'flex flex-col gap-2' : 'hidden'}>
        {virheviesti && <p className="text-[12.5px] text-[var(--danger)]">{virheviesti}</p>}
        {rivit.length === 0 ? (
          <p className="text-[13.5px] text-[var(--text-muted)]">Ei annettuja ilmoituksia.</p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={OTSIKKOLUOKKA}>Kausi</th>
                <th className={OTSIKKOLUOKKA}>Eräpäivä</th>
                <th className={`${OTSIKKOLUOKKA} text-right`}>Maksettava</th>
                <th className={`${OTSIKKOLUOKKA} pl-6`}>Tosite</th>
                <th className={OTSIKKOLUOKKA} />
              </tr>
            </thead>
            <tbody>
              {rivit.map((tosite) => {
                const kausi =
                  tosite.otsikko === undefined ? null : parsiIlmoitusOtsikko(tosite.otsikko);
                // Sama tositepäivä-varajärjestely kuin usePoistaAlvIlmoitus-hookin rajan
                // kelauksessa (kysely.ts): jos uusimman ilmoituksen otsikko ei parsiudu,
                // loppupvm-vertailu ei saa jumiutua eikä estää poistoa ikuisesti.
                const loppupvm = kausi?.loppupvm ?? tosite.pvm;
                const uusin = raja != null && raja !== '' && loppupvm === raja;
                return (
                  <tr
                    key={tosite.id}
                    tabIndex={0}
                    onClick={() => {
                      if (kausi) onValitse(kausi);
                    }}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && kausi) {
                        e.preventDefault();
                        onValitse(kausi);
                      }
                    }}
                    className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--bg-subtle)]"
                  >
                    <td className="py-[7px] tabular-nums">
                      {kausi
                        ? `${muotoilePvm(kausi.alkupvm)} – ${muotoilePvm(kausi.loppupvm)}`
                        : muotoilePvm(tosite.pvm)}
                    </td>
                    <td className="py-[7px] tabular-nums">
                      {kausi ? muotoilePvm(alvErapaiva(kausi.loppupvm, kausiKk)) : '—'}
                    </td>
                    <td className="py-[7px] text-right tabular-nums">
                      {muotoileEuro(maksettava(tosite))}
                    </td>
                    <td className="py-[7px] pl-6">
                      <Link
                        to="/tositteet/$id"
                        params={{ id: String(tosite.id) }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[var(--accent)] hover:underline"
                      >
                        Tosite
                      </Link>
                    </td>
                    <td className="py-[7px] text-right">
                      <Button
                        variant="sec"
                        size="compact"
                        type="button"
                        disabled={!uusin || poistaa}
                        title={uusin ? undefined : 'Vain uusimman ilmoituksen voi poistaa'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!window.confirm(POISTOVAHVISTUS)) return;
                          void poista(tosite.id);
                        }}
                      >
                        Poista ilmoitus
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
