import { useKohdennukset, usePoistaTili, useTallennaTili, useViennit } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { kohdennusSolunTeksti } from '@/kohdennukset/kohdennusTeksti';
import {
  KohdennusTyyppi,
  Luonne,
  type Tili,
  type TiliData,
  kohdennuksenPolku,
  onko,
  nimi as tiliNimi,
  tyyppiKoodilla,
} from '@penni/engine';
import { useMemo, useState } from 'react';
import {
  onVaroTyyppi,
  tarkistaNumero,
  tarvitseekoVahvistuksen,
  tyyppiSuodatin,
} from './tilikartta.js';

/** Edit (existing leaf) or add (no `tili`). On success the parent closes the dialog. */
export function TiliEditori({
  tili,
  kartta,
  onSuljeJaPaivita,
  onPeruuta,
}: {
  tili?: Tili | undefined;
  kartta: readonly Tili[];
  onSuljeJaPaivita: () => void;
  onPeruuta: () => void;
}) {
  const muokkaa = tili !== undefined;
  const { tallenna, virheviesti, tallentaa } = useTallennaTili();
  const { poista, virheviesti: poistoVirhe, poistaa } = usePoistaTili();
  // Only fetch postings in edit mode; in add mode the account has no number yet.
  const { data: viennit } = useViennit(muokkaa ? tili.numero : 0, muokkaa);
  const onVientejä = (viennit?.length ?? 0) > 0;
  const varo = muokkaa && onVaroTyyppi(tili.tyyppiKoodi);
  const poistoEstetty = onVientejä || varo;
  const poistoSyy = varo
    ? 'Erityistiliä ei voi poistaa.'
    : onVientejä
      ? 'Tilillä on vientejä, joten sitä ei voi poistaa.'
      : null;

  async function lahetaPoisto() {
    if (!muokkaa || poistoEstetty) return;
    const ok = await poista(tili.numero);
    if (ok) onSuljeJaPaivita();
  }

  const [numero, setNumero] = useState(muokkaa ? String(tili.numero) : '');
  const [nimi, setNimi] = useState(muokkaa ? tiliNimi(tili) : '');
  const [tyyppi, setTyyppi] = useState(muokkaa ? tili.tyyppiKoodi : '');
  const [ohje, setOhje] = useState(
    muokkaa && typeof tili.data.ohje === 'string' ? tili.data.ohje : '',
  );
  // Tilin oletuskohdennus (data.kohdennus): '' = ei oletusta, muuten kohdennuksen id.
  const [oletusKohdennus, setOletusKohdennus] = useState(() => {
    const id = muokkaa ? tili.data.kohdennus : undefined;
    return typeof id === 'number' && Number.isInteger(id) && id >= 1 ? String(id) : '';
  });
  const { data: kohdennukset } = useKohdennukset();
  const valittavat = useMemo(
    () =>
      (kohdennukset ?? [])
        .filter((k) => k.tyyppi !== KohdennusTyyppi.MERKKAUS)
        .map((k) => ({ id: k.id, teksti: kohdennuksenPolku(k, kohdennukset ?? []) }))
        .sort((a, b) => a.teksti.localeCompare(b.teksti, 'fi')),
    [kohdennukset],
  );
  const [paikallinenVirhe, setPaikallinenVirhe] = useState<string | null>(null);

  const tyypit = useMemo(() => tyyppiSuodatin(numero), [numero]);
  // Oletuskohdennus kuuluu vain tulostilille, ja valinta näytetään vasta kun kirjanpidossa on
  // kustannuspaikka tai projekti (Kitsas tilinmuokkausdialog.cpp:280-281).
  const tulostili = tyyppi !== '' && onko(tyyppiKoodilla(tyyppi).luonne, Luonne.TULOS);
  const naytaOletusKohdennus = tulostili && valittavat.length > 0;
  // Tallentamaton (tai merkkaukseksi jäänyt) id pidetään valittavana, ettei se katoa huomaamatta.
  const tuntematonId =
    oletusKohdennus !== '' && !valittavat.some((k) => String(k.id) === oletusKohdennus)
      ? Number(oletusKohdennus)
      : undefined;

  async function lahetaTallennus() {
    setPaikallinenVirhe(null);
    const n = Number(numero);

    if (!muokkaa) {
      const virhe = tarkistaNumero(n, kartta);
      if (virhe) {
        setPaikallinenVirhe(virhe);
        return;
      }
    }
    if (nimi.trim() === '') {
      setPaikallinenVirhe('Anna tilin nimi.');
      return;
    }
    if (tyyppi === '') {
      setPaikallinenVirhe('Valitse tilin tyyppi.');
      return;
    }
    const vanhaKoodi = muokkaa ? tili.tyyppiKoodi : '';
    if (tarvitseekoVahvistuksen(vanhaKoodi, tyyppi)) {
      const ok = window.confirm(
        'Valittu tilityyppi vaikuttaa erityisellä tavalla kirjanpidon toimintaan. Jatketaanko?',
      );
      if (!ok) return;
    }

    // Preserve existing chart keys when editing; set ohje conditionally (exactOptionalPropertyTypes).
    // Oletuskohdennus: pois, kun tili ei ole tulostili tai "Ei oletusta"; valitsimen ollessa
    // piilossa (kohdennuksia ei ole tai ne latautuvat) avain säilyy ennallaan.
    const { kohdennus: vanhaKohdennus, ...muuData } = muokkaa ? tili.data : {};
    const kohdennus = naytaOletusKohdennus
      ? oletusKohdennus !== ''
        ? Number(oletusKohdennus)
        : undefined
      : tulostili
        ? vanhaKohdennus
        : undefined;
    const data: TiliData = {
      ...muuData,
      numero: n,
      tyyppi,
      nimi: { fi: nimi.trim() },
      ...(ohje.trim() !== '' ? { ohje: ohje.trim() } : {}),
      ...(kohdennus !== undefined ? { kohdennus } : {}),
    };
    const ok = await tallenna(n, data);
    if (ok) onSuljeJaPaivita();
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
      role="dialog"
      aria-modal="true"
      aria-label={muokkaa ? 'Muokkaa tiliä' : 'Uusi tili'}
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-[420px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
        <h2 className="mb-4 text-[15px] font-[650]">{muokkaa ? 'Muokkaa tiliä' : 'Uusi tili'}</h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
            Tilinumero
            <input
              aria-label="Tilinumero"
              value={numero}
              disabled={muokkaa}
              inputMode="numeric"
              onChange={(e) => setNumero(e.target.value)}
              className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] tabular-nums disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
            Nimi
            <input
              aria-label="Nimi"
              value={nimi}
              onChange={(e) => setNimi(e.target.value)}
              className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
            Tyyppi
            <select
              aria-label="Tyyppi"
              value={tyyppi}
              onChange={(e) => setTyyppi(e.target.value)}
              className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]"
            >
              <option value="">Valitse…</option>
              {tyypit.map((t) => (
                <option key={t.koodi} value={t.koodi}>
                  {t.kuvaus}
                </option>
              ))}
            </select>
          </label>
          {naytaOletusKohdennus && (
            <label className="flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
              Oletuskohdennus
              <select
                aria-label="Oletuskohdennus"
                value={oletusKohdennus}
                onChange={(e) => setOletusKohdennus(e.target.value)}
                className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]"
              >
                <option value="">Ei oletusta</option>
                {valittavat.map((k) => (
                  <option key={k.id} value={String(k.id)}>
                    {k.teksti}
                  </option>
                ))}
                {tuntematonId !== undefined && (
                  <option value={String(tuntematonId)}>
                    {kohdennusSolunTeksti(tuntematonId, undefined, kohdennukset ?? [])}
                  </option>
                )}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
            Ohje
            <textarea
              aria-label="Ohje"
              value={ohje}
              onChange={(e) => setOhje(e.target.value)}
              rows={2}
              className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]"
            />
          </label>
          {(paikallinenVirhe ?? virheviesti ?? poistoVirhe ?? poistoSyy) && (
            <p className="text-[12.5px] text-[var(--danger)]">
              {paikallinenVirhe ?? virheviesti ?? poistoVirhe ?? poistoSyy}
            </p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          {muokkaa && (
            <Button
              variant="sec"
              type="button"
              disabled={poistoEstetty || poistaa}
              onClick={lahetaPoisto}
              className="mr-auto text-[var(--danger)]"
            >
              Poista
            </Button>
          )}
          <Button variant="sec" type="button" onClick={onPeruuta}>
            Peruuta
          </Button>
          <Button type="button" disabled={tallentaa} onClick={lahetaTallennus}>
            Tallenna
          </Button>
        </div>
      </div>
    </div>
  );
}
