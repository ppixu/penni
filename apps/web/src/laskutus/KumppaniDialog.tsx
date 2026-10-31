import { useTallennaKumppani } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import type { UusiKumppani } from '@penni/engine';
import { useState } from 'react';

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA_LUOKKA =
  'rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]';

/**
 * Asiakkaan pikaluonti (TiliEditori-malli: parent omistaa auki/kiinni-tilan,
 * ei fokus-trapia — vakiintunut kompromissi). Onnistunut tallennus → onValittu(id).
 */
export function KumppaniDialog({
  onValittu,
  onPeruuta,
}: {
  onValittu: (id: number) => void;
  onPeruuta: () => void;
}) {
  const { tallenna, virheviesti, tallentaa } = useTallennaKumppani();
  const [nimi, setNimi] = useState('');
  const [osoite, setOsoite] = useState('');
  const [postinumero, setPostinumero] = useState('');
  const [kaupunki, setKaupunki] = useState('');
  const [email, setEmail] = useState('');
  const [paikallinenVirhe, setPaikallinenVirhe] = useState<string | null>(null);

  async function lahetaTallennus() {
    setPaikallinenVirhe(null);
    if (nimi.trim() === '') {
      setPaikallinenVirhe('Anna asiakkaan nimi.');
      return;
    }
    // Valinnaiset kentät liitetään vain ei-tyhjinä (exactOptionalPropertyTypes).
    const syote: UusiKumppani = {
      nimi: nimi.trim(),
      ...(osoite.trim() !== '' ? { osoite: osoite.trim() } : {}),
      ...(postinumero.trim() !== '' ? { postinumero: postinumero.trim() } : {}),
      ...(kaupunki.trim() !== '' ? { kaupunki: kaupunki.trim() } : {}),
      ...(email.trim() !== '' ? { email: email.trim() } : {}),
    };
    const kumppani = await tallenna(syote);
    if (kumppani) onValittu(kumppani.id);
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
      role="dialog"
      aria-modal="true"
      aria-label="Uusi asiakas"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-[420px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
        <h2 className="mb-4 text-[15px] font-[650]">Uusi asiakas</h2>
        <div className="flex flex-col gap-3">
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
          {(paikallinenVirhe ?? virheviesti) && (
            <p className="text-[12.5px] text-[var(--danger)]">{paikallinenVirhe ?? virheviesti}</p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="sec" type="button" onClick={onPeruuta}>
            Peruuta
          </Button>
          <Button type="button" disabled={tallentaa} onClick={() => void lahetaTallennus()}>
            Tallenna
          </Button>
        </div>
      </div>
    </div>
  );
}
