import { useKumppanit, useTallennaOstolasku } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { KumppaniDialog } from '@/laskutus/KumppaniDialog';
import { KumppaniValitsin } from '@/laskutus/KumppaniValitsin';
import { LaskuriviTaulukko } from '@/laskutus/LaskuriviTaulukko';
import { riviTositeRiviksi } from '@/laskutus/rakennaLaskuSyote';
import { useMuutosseuranta } from '@/tallentamaton/useMuutosseuranta';
import { useTallentamatonVaroitus } from '@/tallentamaton/useTallentamatonVaroitus';
import { ostolaskuVertailuun } from '@/tallentamaton/vertailu';
import { muotoileEuro } from '@penni/euro';
import { useMemo, useReducer, useState } from 'react';
import { OSTOKOODIT, alustaOstolaskuTila, ostolaskuReducer } from './ostolaskuReducer.js';
import { ostolaskuSummat } from './ostolaskuSummat.js';
import { rakennaOstolaskuSyote } from './rakennaOstolaskuSyote.js';

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA_LUOKKA =
  'rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]';

/**
 * Koko ostolaskulomake. Peilaa LaskuLomake.tsx-rakennetta (myyntilasku): live-summat
 * lasketaan samalla engine-rivimuunnoksella (riviTositeRiviksi), moottori numeroi ja
 * kirjaa suoraan KIRJANPIDOSSA-tilaan. Ostolaskulla ei ole maksutapaa (avaa aina
 * ostovelan erän) — sen tilalla on toimittajan vapaa viite-teksti. Toimittaja on
 * valinnainen: ostovelka syntyy kumppanittakin (vrt. myyntilaskun LASKU-vaatimus).
 */
export function OstolaskuLomake({
  alkupaiva,
  alvVelvollinen,
  onTallennettu,
}: {
  alkupaiva: string;
  alvVelvollinen: boolean;
  onTallennettu: (id: number) => void;
}) {
  const [tila, dispatch] = useReducer(
    ostolaskuReducer,
    { laskupvm: alkupaiva, alvVelvollinen },
    alustaOstolaskuTila,
  );
  const { data: kumppanit } = useKumppanit();
  const { tallenna, virheviesti, tallentaa } = useTallennaOstolasku();
  const [dialogiAuki, setDialogiAuki] = useState(false);
  const { onkoLikainen, asetaPohja } = useMuutosseuranta(tila, ostolaskuVertailuun);
  const varoitus = useTallentamatonVaroitus(onkoLikainen);

  const summat = useMemo(() => ostolaskuSummat(tila.rivit.map(riviTositeRiviksi)), [tila.rivit]);

  // Estosääntö (brief): ei summallista riviä TAI kesken. Toimittajaa ei vaadita.
  const eiSummaa = !tila.rivit.some((r) => r.aNettoSnt !== 0);
  const estetty = eiSummaa || tallentaa;

  async function lahetaTallennus() {
    const stored = await tallenna(rakennaOstolaskuSyote(tila));
    if (!stored) return;
    asetaPohja(tila); // puhdas ennen navigointia, ettei tallennus laukaise varoitusta
    onTallennettu(stored.id);
  }

  return (
    <>
      <TopBar otsikko="Uusi ostolasku" />
      <section
        aria-label="ostolaskulomake"
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
          <label className={LABEL_LUOKKA}>
            Viite
            <input
              type="text"
              aria-label="Viite"
              value={tila.viite}
              onChange={(e) => dispatch({ type: 'setViite', viite: e.target.value })}
              className={KENTTA_LUOKKA}
            />
          </label>
        </div>
        <div className="grid max-w-3xl grid-cols-2 gap-3">
          <div className={LABEL_LUOKKA}>
            Toimittaja
            <KumppaniValitsin
              kumppanit={kumppanit ?? []}
              arvo={tila.kumppani}
              ariaLabel="Toimittaja"
              onValitse={(id) => dispatch({ type: 'setKumppani', kumppani: id })}
              onUusiAsiakas={() => setDialogiAuki(true)}
            />
          </div>
        </div>

        <LaskuriviTaulukko
          rivit={tila.rivit}
          pvm={tila.laskupvm}
          dispatch={dispatch}
          koodit={OSTOKOODIT}
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
              <span>Veroton</span>
              <span>{muotoileEuro(summat.veroton)}</span>
            </div>
            <div className="flex justify-between gap-8 text-[var(--text-muted)]">
              <span>Vähennettävä ALV</span>
              <span>{muotoileEuro(summat.vahennettavaAlv)}</span>
            </div>
            {summat.kaannettyAlv > 0 ? (
              <div className="flex justify-between gap-8 text-[var(--text-muted)]">
                <span>Käännetty ALV</span>
                <span>{muotoileEuro(summat.kaannettyAlv)}</span>
              </div>
            ) : null}
            <div className="flex justify-between gap-8 font-[650]">
              <span>Maksettava</span>
              <span>{muotoileEuro(summat.maksettava)}</span>
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
