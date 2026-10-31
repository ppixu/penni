import { Button } from '@/components/ui/button';
import type { Kumppani, UusiKumppani } from '@penni/engine';
import { muotoileIban, tarkistaIban } from '@penni/validator';
import { useState } from 'react';

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA_LUOKKA =
  'rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]';

/**
 * Jaettu kumppanilomake (luonti + muokkaus). alkuarvo undefined → tyhjä (luonti);
 * annettuna esitäyttö + id mukaan koottuun syötteeseen (päivitys). Reitti omistaa
 * mutaation/navigoinnin; lomake omistaa kenttätilan ja paikallisvalidoinnin.
 */
export function KumppaniLomake({
  alkuarvo,
  tallentaa,
  virhe,
  onTallenna,
}: {
  alkuarvo?: Kumppani;
  tallentaa: boolean;
  virhe?: string | null;
  onTallenna: (syote: UusiKumppani) => void;
}) {
  const [nimi, setNimi] = useState(alkuarvo?.nimi ?? '');
  const [alvtunnus, setAlvtunnus] = useState(alkuarvo?.alvtunnus ?? '');
  const [osoite, setOsoite] = useState(alkuarvo?.osoite ?? '');
  const [postinumero, setPostinumero] = useState(alkuarvo?.postinumero ?? '');
  const [kaupunki, setKaupunki] = useState(alkuarvo?.kaupunki ?? '');
  const [maa, setMaa] = useState(alkuarvo?.maa ?? 'fi');
  const [email, setEmail] = useState(alkuarvo?.email ?? '');
  const [puhelin, setPuhelin] = useState(alkuarvo?.puhelin ?? '');
  const [kieli, setKieli] = useState(alkuarvo?.kieli ?? 'fi');
  const [ibanit, setIbanit] = useState<string[]>(alkuarvo?.iban ?? []);
  const [paikallinenVirhe, setPaikallinenVirhe] = useState<string | null>(null);

  function laheta() {
    setPaikallinenVirhe(null);
    if (nimi.trim() === '') {
      setPaikallinenVirhe('Anna kumppanin nimi.');
      return;
    }
    // Tyhjät IBAN-rivit pudotetaan; ei-tyhjät tarkistetaan ja muotoillaan kanoniseen muotoon.
    const eiTyhjat = ibanit.map((s) => s.trim()).filter((s) => s !== '');
    for (const iban of eiTyhjat) {
      if (!tarkistaIban(iban)) {
        setPaikallinenVirhe(`Kelpaamaton IBAN: ${iban}`);
        return;
      }
    }
    const muotoillut = eiTyhjat.map((s) => muotoileIban(s));
    // exactOptionalPropertyTypes: valinnaiset liitetään vain ei-tyhjinä ehdollisella spreadilla.
    const syote: UusiKumppani = {
      ...(alkuarvo?.id !== undefined ? { id: alkuarvo.id } : {}),
      nimi: nimi.trim(),
      ...(alvtunnus.trim() !== '' ? { alvtunnus: alvtunnus.trim() } : {}),
      ...(osoite.trim() !== '' ? { osoite: osoite.trim() } : {}),
      ...(postinumero.trim() !== '' ? { postinumero: postinumero.trim() } : {}),
      ...(kaupunki.trim() !== '' ? { kaupunki: kaupunki.trim() } : {}),
      ...(maa.trim() !== '' ? { maa: maa.trim() } : {}),
      ...(email.trim() !== '' ? { email: email.trim() } : {}),
      ...(puhelin.trim() !== '' ? { puhelin: puhelin.trim() } : {}),
      kieli, // select antaa aina arvon (fi/sv/en) → aina mukana
      ...(muotoillut.length > 0 ? { iban: muotoillut } : {}),
    };
    onTallenna(syote);
  }

  return (
    <section aria-label="kumppanilomake" className="flex-1 overflow-auto px-[22px] py-5">
      <div className="flex max-w-[560px] flex-col gap-3">
        <label className={LABEL_LUOKKA}>
          Nimi
          <input
            aria-label="Nimi"
            value={nimi}
            onChange={(e) => setNimi(e.target.value)}
            className={KENTTA_LUOKKA}
          />
        </label>
        <label className={LABEL_LUOKKA}>
          Alv-tunnus
          <input
            aria-label="Alv-tunnus"
            value={alvtunnus}
            onChange={(e) => setAlvtunnus(e.target.value)}
            className={KENTTA_LUOKKA}
          />
        </label>
        <label className={LABEL_LUOKKA}>
          Osoite
          <textarea
            aria-label="Osoite"
            value={osoite}
            onChange={(e) => setOsoite(e.target.value)}
            rows={2}
            className={KENTTA_LUOKKA}
          />
        </label>
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <label className={LABEL_LUOKKA}>
            Postinumero
            <input
              aria-label="Postinumero"
              value={postinumero}
              onChange={(e) => setPostinumero(e.target.value)}
              className={KENTTA_LUOKKA}
            />
          </label>
          <label className={LABEL_LUOKKA}>
            Kaupunki
            <input
              aria-label="Kaupunki"
              value={kaupunki}
              onChange={(e) => setKaupunki(e.target.value)}
              className={KENTTA_LUOKKA}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={LABEL_LUOKKA}>
            Maa
            <input
              aria-label="Maa"
              value={maa}
              onChange={(e) => setMaa(e.target.value)}
              className={KENTTA_LUOKKA}
            />
          </label>
          <label className={LABEL_LUOKKA}>
            Kieli
            <select
              aria-label="Kieli"
              value={kieli}
              onChange={(e) => setKieli(e.target.value)}
              className={KENTTA_LUOKKA}
            >
              <option value="fi">Suomi</option>
              <option value="sv">Ruotsi</option>
              <option value="en">Englanti</option>
            </select>
          </label>
        </div>
        <label className={LABEL_LUOKKA}>
          Sähköposti
          <input
            type="email"
            aria-label="Sähköposti"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={KENTTA_LUOKKA}
          />
        </label>
        <label className={LABEL_LUOKKA}>
          Puhelin
          <input
            aria-label="Puhelin"
            value={puhelin}
            onChange={(e) => setPuhelin(e.target.value)}
            className={KENTTA_LUOKKA}
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]">
            IBANit
          </span>
          {ibanit.map((arvo, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: IBAN-rivit ovat järjestyksellinen luonnos ilman vakaata tunnistetta
            <div key={idx} className="flex items-center gap-2">
              <input
                aria-label="IBAN"
                value={arvo}
                onChange={(e) =>
                  setIbanit((vanha) => vanha.map((v, i) => (i === idx ? e.target.value : v)))
                }
                className={`${KENTTA_LUOKKA} flex-1`}
              />
              <Button
                variant="sec"
                type="button"
                aria-label="Poista IBAN"
                onClick={() => setIbanit((vanha) => vanha.filter((_, i) => i !== idx))}
              >
                ×
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="sec"
              type="button"
              onClick={() => setIbanit((vanha) => [...vanha, ''])}
            >
              Lisää IBAN
            </Button>
          </div>
        </div>

        {(paikallinenVirhe ?? virhe) && (
          <p className="text-[12.5px] text-[var(--danger)]">{paikallinenVirhe ?? virhe}</p>
        )}

        <div className="mt-2 flex justify-end">
          <Button type="button" disabled={tallentaa} onClick={laheta}>
            Tallenna
          </Button>
        </div>
      </div>
    </section>
  );
}
