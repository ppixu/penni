import { useTallennaHyvityslasku } from '@/app/kysely';
import { Button } from '@/components/ui/button';

/**
 * Hyvityslaskun vahvistusdialogi (TiliEditori-dialogimalli, ks. SuoritusDialog). Hyvitys on
 * aina täysimääräinen — koko alkuperäinen tosite käänteiskirjataan — joten kysytään vain
 * vahvistus, ei lomaketta. Toimii sekä osto- että myyntilaskulle: moottori päättelee
 * hyvityslaskun tositetyypin alkuperäisestä tositteesta (ks. hyvityslaskuResource.ts).
 */
export function HyvitaVahvistus({
  tosite,
  onValmis,
  onPeruuta,
}: {
  tosite: number;
  onValmis: () => void;
  onPeruuta: () => void;
}) {
  const { tallenna, virheviesti, tallentaa } = useTallennaHyvityslasku();

  async function lahetaHyvitys() {
    const pvm = new Date().toISOString().slice(0, 10);
    const stored = await tallenna({ alkuperainenTosite: tosite, pvm });
    if (stored) onValmis();
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
      role="dialog"
      aria-modal="true"
      aria-label="Hyvitä lasku"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-[380px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
        <h2 className="mb-4 text-[15px] font-[650]">Hyvitä lasku</h2>
        <p className="text-[13px]">Hyvitetäänkö lasku kokonaan?</p>
        {virheviesti && <p className="mt-3 text-[12.5px] text-[var(--danger)]">{virheviesti}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="sec" type="button" onClick={onPeruuta}>
            Peruuta
          </Button>
          <Button type="button" disabled={tallentaa} onClick={() => void lahetaHyvitys()}>
            Hyvitä
          </Button>
        </div>
      </div>
    </div>
  );
}
