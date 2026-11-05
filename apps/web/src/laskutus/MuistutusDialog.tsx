import { useInit, useKumppanit, useLuoMaksumuistutukset } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { paikallinenTanaan } from '@/tositteet/pikavalinnat';
import {
  type IsoDate,
  OLETUS_MUISTUTUSMAKSU,
  type RahavirtaRivi,
  type StoredTosite,
  lisaaPaivia,
  lueMaksuaika,
  luePeruskorko,
  oikaiseErapaiva,
} from '@penni/engine';
import { type Cents, Euro, muotoileEuro } from '@penni/euro';
import { useState } from 'react';

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA_LUOKKA =
  'rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] normal-case tracking-normal';
const VALINTA_LUOKKA = 'flex items-center gap-2 text-[13px] font-medium';

/** Korkoprosentti kentästä: tyhjä = ei annettu (moottori laskee oletuksen), muuten ≥ 0 ja
 *  enintään kaksi desimaalia; virheellinen → null. */
function lueKorko(teksti: string): number | undefined | null {
  const t = teksti.trim();
  if (t === '') return undefined;
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}

/**
 * Oletuskorko ensimmäiselle valitulle laskulle (spec §4.3): peruskorko + 7 kuluttajalle,
 * + 8 yritykselle (kumppanilla alv-tunnus), suomalaisella desimaalipilkulla. Peruskorko luetaan
 * samalla vartioidulla jäsentimellä kuin moottorissa (kelvoton → 0).
 */
function oletuskorkoTeksti(peruskorko: number, yritysasiakas: boolean): string {
  return (peruskorko + (yritysasiakas ? 8 : 7)).toFixed(2).replace('.', ',');
}

/**
 * Maksumuistutusten luonti valituille erääntyneille laskuille (spec §4.5, Web): muistutusmaksu,
 * viivästyskorko ja eräpäivä. Jokaisesta laskusta syntyy oma luonnos Lähtevät-listaan. Korkoprosentin
 * kenttä on oletuksena tyhjä; sen paikanpitäjä näyttää ensimmäisen laskun oletuskoron.
 */
export function MuistutusDialog({
  laskut,
  onPeruuta,
  onValmis,
}: {
  laskut: readonly RahavirtaRivi[];
  onPeruuta: () => void;
  onValmis: (luodut: StoredTosite[]) => void;
}) {
  const { data: init } = useInit();
  const { data: kumppanit } = useKumppanit();
  const { luo, virheviesti, luomassa } = useLuoMaksumuistutukset();

  // "Tänään" luetaan avattaessa paikallisena kalenteripäivänä (UTC-päivä olisi klo 0–3 eilinen).
  const [pvm] = useState<IsoDate>(() => paikallinenTanaan());
  const maksuaika = lueMaksuaika(init?.asetukset ?? {});
  const [erapvm, setErapvm] = useState<IsoDate | null>(null);
  const oletusErapvm = oikaiseErapaiva(lisaaPaivia(pvm, maksuaika));
  const [maksuPaalla, setMaksuPaalla] = useState(true);
  const [maksuTeksti, setMaksuTeksti] = useState(() =>
    muotoileEuro(OLETUS_MUISTUTUSMAKSU).replace(/\s?€$/, '').trim(),
  );
  const [korkoPaalla, setKorkoPaalla] = useState(true);
  const [korkoTeksti, setKorkoTeksti] = useState('');
  const [lomakevirhe, setLomakevirhe] = useState<string | null>(null);

  const ensimmainen = laskut[0];
  const yritysasiakas =
    ensimmainen?.kumppani !== undefined &&
    !!kumppanit?.find((k) => k.id === ensimmainen.kumppani)?.alvtunnus;
  const korkoOletus = oletuskorkoTeksti(luePeruskorko(init?.asetukset ?? {}), yritysasiakas);

  async function laheta() {
    setLomakevirhe(null);
    let maksu: Cents = 0 as Cents;
    if (maksuPaalla) {
      try {
        maksu = Euro.fromString(maksuTeksti);
      } catch {
        maksu = -1 as Cents;
      }
      // Negatiivista maksua ei käännetä hiljaa positiiviseksi: se on kirjoitusvirhe.
      if (maksu < 0) {
        setLomakevirhe('Tarkista muistutusmaksun summa');
        return;
      }
    }
    if (erapvm === '') {
      setLomakevirhe('Valitse muistutuksen eräpäivä');
      return;
    }
    const viivkorko = korkoPaalla ? lueKorko(korkoTeksti) : undefined;
    if (viivkorko === null) {
      setLomakevirhe('Tarkista korkoprosentti (enintään kaksi desimaalia)');
      return;
    }
    const luodut = await luo({
      tositteet: laskut.map((l) => l.tosite),
      pvm,
      erapvm: erapvm ?? oletusErapvm,
      maksu,
      korko: korkoPaalla,
      ...(viivkorko !== undefined ? { viivkorko } : {}),
    });
    if (luodut) onValmis(luodut);
  }

  const virhe = lomakevirhe ?? virheviesti;

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
      role="dialog"
      aria-modal="true"
      aria-label="Maksumuistutus"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-[420px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
        <h2 className="mb-1 text-[15px] font-[650]">Maksumuistutus</h2>
        <p className="mb-4 text-[12.5px] text-[var(--text-muted)]">
          {laskut.length === 1
            ? 'Luodaan muistutusluonnos valitusta laskusta.'
            : `Luodaan ${laskut.length} muistutusluonnosta, yksi jokaisesta valitusta laskusta.`}
        </p>
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <label className={VALINTA_LUOKKA}>
              <input
                type="checkbox"
                aria-label="Muistutusmaksu"
                checked={maksuPaalla}
                onChange={(e) => setMaksuPaalla(e.target.checked)}
              />
              Muistutusmaksu
            </label>
            <input
              type="text"
              inputMode="decimal"
              aria-label="Muistutusmaksun summa"
              value={maksuTeksti}
              disabled={!maksuPaalla}
              onChange={(e) => setMaksuTeksti(e.target.value)}
              className={`${KENTTA_LUOKKA} w-[110px] text-right tabular-nums`}
            />
            <span className="pb-2 text-[13px] text-[var(--text-muted)]">€</span>
          </div>
          <div className="flex items-end gap-3">
            <label className={VALINTA_LUOKKA}>
              <input
                type="checkbox"
                aria-label="Viivästyskorko"
                checked={korkoPaalla}
                onChange={(e) => setKorkoPaalla(e.target.checked)}
              />
              Viivästyskorko
            </label>
            <input
              type="text"
              inputMode="decimal"
              aria-label="Korkoprosentti"
              value={korkoTeksti}
              placeholder={korkoOletus}
              disabled={!korkoPaalla}
              onChange={(e) => setKorkoTeksti(e.target.value)}
              className={`${KENTTA_LUOKKA} w-[110px] text-right tabular-nums`}
            />
            <span className="pb-2 text-[13px] text-[var(--text-muted)]">%</span>
          </div>
          <label className={LABEL_LUOKKA}>
            Eräpäivä
            <input
              type="date"
              aria-label="Eräpäivä"
              value={erapvm ?? oletusErapvm}
              onChange={(e) => setErapvm(e.target.value)}
              className={`${KENTTA_LUOKKA} tabular-nums`}
            />
          </label>
          {virhe && (
            <p role="alert" className="text-[12.5px] text-[var(--danger)]">
              {virhe}
            </p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="sec" type="button" onClick={onPeruuta}>
            Peruuta
          </Button>
          <Button type="button" disabled={luomassa || !init} onClick={() => void laheta()}>
            Luo muistutukset
          </Button>
        </div>
      </div>
    </div>
  );
}
