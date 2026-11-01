import { useKohdennukset, useKumppanit, useTallennaMyyntilasku } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/editori/SegmentedControl';
import { useMuutosseuranta } from '@/tallentamaton/useMuutosseuranta';
import { useTallentamatonVaroitus } from '@/tallentamaton/useTallentamatonVaroitus';
import { laskuVertailuun } from '@/tallentamaton/vertailu';
import { Maksutapa, laskuSummat } from '@penni/engine';
import { muotoileEuro } from '@penni/euro';
import { useMemo, useReducer, useState } from 'react';
import { KumppaniDialog } from './KumppaniDialog.js';
import { KumppaniValitsin } from './KumppaniValitsin.js';
import { LaskuriviTaulukko } from './LaskuriviTaulukko.js';
import { alustaLaskuTila, laskuReducer } from './laskuReducer.js';
import { rakennaLaskuSyote, riviTositeRiviksi } from './rakennaLaskuSyote.js';

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA_LUOKKA =
  'rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]';

const MAKSUTAVAT = [
  { arvo: Maksutapa.LASKU, label: 'Lasku' },
  { arvo: Maksutapa.KATEINEN, label: 'Käteinen' },
  { arvo: Maksutapa.KORTTIMAKSU, label: 'Korttimaksu' },
];

/** Prosentti suomalaisella desimaalipilkulla (25.5 → '25,5'). */
function prosenttiTeksti(prosentti: number): string {
  return String(prosentti).replace('.', ',');
}

/**
 * Koko laskulomake. Live-summat lasketaan samoilla engine-funktioilla kuin syötteen
 * saama TositeRivi (laskuSummat ~ generoiLaskunViennit) — ei omaa rinnakkaista
 * rahalaskentaa. Moottori numeroi (numero, viite), generoi viennit ja kirjaa suoraan
 * KIRJANPIDOSSA-tilaan — luonnostilaa ei ole (1d-päätös).
 */
export function LaskuLomake({
  alkupaiva,
  alvVelvollinen,
  onTallennettu,
}: {
  alkupaiva: string;
  alvVelvollinen: boolean;
  onTallennettu: (id: number) => void;
}) {
  const [tila, dispatch] = useReducer(
    laskuReducer,
    { laskupvm: alkupaiva, alvVelvollinen },
    alustaLaskuTila,
  );
  const { data: kumppanit } = useKumppanit();
  const { data: kohdennukset } = useKohdennukset();
  const { tallenna, virheviesti, tallentaa } = useTallennaMyyntilasku();
  const [dialogiAuki, setDialogiAuki] = useState(false);
  const { onkoLikainen, asetaPohja } = useMuutosseuranta(tila, laskuVertailuun);
  const varoitus = useTallentamatonVaroitus(onkoLikainen);

  const summat = useMemo(() => laskuSummat(tila.rivit.map(riviTositeRiviksi)), [tila.rivit]);

  // Estosäännöt (spec §3.3): ei summallista riviä TAI LASKU ilman asiakasta TAI kesken.
  // Kumppania ei vaadita käteis-/korttimyynnille (kuitti, ei saatavaa) — UI-tason sääntö.
  // Sama koskee eräpäivää: tyhjäksi tyhjennetty <input type="date"> (tila.erapvm === '')
  // estää tallennuksen LASKU-maksutavalla — muuten rakennaLaskuSyote jättäisi eräpäivän
  // pois tallennettavasta laskusta huomaamatta (ks. rakennaLaskuSyote.ts). Käteis-/
  // korttikuitilla eräpäivää ei tarvita, joten se saa jäädä tyhjäksi.
  const eiSummaa = !tila.rivit.some((r) => r.aNettoSnt !== 0);
  const asiakasPuuttuu = tila.maksutapa === Maksutapa.LASKU && tila.kumppani === undefined;
  const erapvmPuuttuu = tila.maksutapa === Maksutapa.LASKU && tila.erapvm === '';
  const estetty = eiSummaa || asiakasPuuttuu || erapvmPuuttuu || tallentaa;

  async function lahetaTallennus() {
    const stored = await tallenna(rakennaLaskuSyote(tila));
    if (!stored) return;
    asetaPohja(tila); // puhdas ennen navigointia, ettei tallennus laukaise varoitusta
    onTallennettu(stored.id);
  }

  return (
    <>
      <TopBar otsikko="Uusi lasku" />
      <section
        aria-label="laskulomake"
        className="flex flex-1 flex-col gap-4 overflow-auto px-[22px] py-5"
      >
        <div className="grid max-w-3xl grid-cols-[160px_160px_auto] items-end gap-3">
          <label className={LABEL_LUOKKA}>
            Laskun päivämäärä
            <input
              type="date"
              aria-label="Laskun päivämäärä"
              value={tila.laskupvm}
              onChange={(e) => dispatch({ type: 'setLaskupvm', pvm: e.target.value })}
              className={`${KENTTA_LUOKKA} tabular-nums`}
            />
          </label>
          <label className={LABEL_LUOKKA}>
            Eräpäivä
            <input
              type="date"
              aria-label="Eräpäivä"
              value={tila.erapvm}
              onChange={(e) => dispatch({ type: 'setErapvm', pvm: e.target.value })}
              className={`${KENTTA_LUOKKA} tabular-nums`}
            />
          </label>
          <SegmentedControl
            nimi="Maksutapa"
            vaihtoehdot={MAKSUTAVAT}
            arvo={tila.maksutapa}
            onMuutos={(m) => dispatch({ type: 'setMaksutapa', maksutapa: m })}
          />
        </div>
        <div className="grid max-w-3xl grid-cols-2 gap-3">
          <div className={LABEL_LUOKKA}>
            Asiakas
            <KumppaniValitsin
              kumppanit={kumppanit ?? []}
              arvo={tila.kumppani}
              ariaLabel="Asiakas"
              onValitse={(id) => dispatch({ type: 'setKumppani', kumppani: id })}
              onUusiAsiakas={() => setDialogiAuki(true)}
            />
          </div>
          <label className={LABEL_LUOKKA}>
            Otsikko
            <input
              type="text"
              aria-label="Otsikko"
              value={tila.otsikko}
              onChange={(e) => dispatch({ type: 'setOtsikko', otsikko: e.target.value })}
              className={KENTTA_LUOKKA}
            />
          </label>
        </div>

        <LaskuriviTaulukko
          rivit={tila.rivit}
          pvm={tila.laskupvm}
          dispatch={dispatch}
          kohdennukset={kohdennukset}
        />

        {virheviesti ? (
          <p role="alert" className="text-[12.5px] text-[var(--danger)]">
            {virheviesti}
          </p>
        ) : null}

        <div
          aria-label="summat"
          className="mt-auto flex items-end justify-between border-t border-[var(--border)] pt-4"
        >
          <div className="flex w-[280px] flex-col gap-1 text-[13px] tabular-nums">
            <div className="flex justify-between gap-8">
              <span>Yhteensä veroton</span>
              <span>{muotoileEuro(summat.netto)}</span>
            </div>
            {summat.erittely.map((e) => (
              <div
                key={e.prosentti}
                className="flex justify-between gap-8 text-[var(--text-muted)]"
              >
                <span>Alv {prosenttiTeksti(e.prosentti)} %</span>
                <span>{muotoileEuro(e.vero)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-8 font-[650]">
              <span>Verollinen yhteensä</span>
              <span>{muotoileEuro(summat.brutto)}</span>
            </div>
          </div>
          <Button type="button" disabled={estetty} onClick={() => void lahetaTallennus()}>
            Tallenna
          </Button>
        </div>

        {dialogiAuki && (
          <KumppaniDialog
            onValittu={(id) => {
              dispatch({ type: 'setKumppani', kumppani: id });
              setDialogiAuki(false);
            }}
            onPeruuta={() => setDialogiAuki(false)}
          />
        )}
        {varoitus}
      </section>
    </>
  );
}
