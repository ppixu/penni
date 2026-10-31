import { useInit } from '@/app/kysely';
import { OstolaskuLomake } from '@/ostolaskut/OstolaskuLomake';
import { asetusPaalla } from '@penni/engine';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

export const Route = createFileRoute('/ostolaskut/uusi')({ component: UusiOstolasku });

function UusiOstolasku() {
  const { data: init } = useInit();
  const navigate = useNavigate();

  if (!init) return <p className="px-[22px] py-5 text-[var(--text-muted)]">Ladataan…</p>;

  // Laskupvm-oletus: tänään puristettuna aktiiviseen tilikauteen (sama sääntö kuin
  // myyntilaskun reitillä), ettei moottori heitä EITILIKAUTTA.
  const kausi = init.tilikaudet.at(-1);
  const tanaan = new Date().toISOString().slice(0, 10);
  const alkupaiva = kausi
    ? tanaan >= kausi.alkaa && tanaan <= kausi.loppuu
      ? tanaan
      : kausi.alkaa
    : tanaan;

  return (
    <OstolaskuLomake
      alkupaiva={alkupaiva}
      alvVelvollinen={asetusPaalla(init.asetukset.AlvVelvollinen)}
      onTallennettu={(id) => navigate({ to: '/ostolaskut/$id', params: { id: String(id) } })}
    />
  );
}
