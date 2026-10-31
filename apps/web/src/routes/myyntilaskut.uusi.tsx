import { useInit } from '@/app/kysely';
import { LaskuLomake } from '@/laskutus/LaskuLomake';
import { asetusPaalla } from '@penni/engine';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

export const Route = createFileRoute('/myyntilaskut/uusi')({ component: UusiLasku });

function UusiLasku() {
  const { data: init } = useInit();
  const navigate = useNavigate();

  if (!init) return <p className="px-[22px] py-5 text-[var(--text-muted)]">Ladataan…</p>;

  // Laskupvm-oletus: tänään puristettuna aktiiviseen tilikauteen (editori-sääntö,
  // tositteet.uusi.tsx:22-28), ettei moottori heitä EITILIKAUTTA. new Date() kelpaa
  // UI-oletukseksi (ei rahaa eikä auditointikelloa); käyttäjä voi vaihtaa.
  const kausi = init.tilikaudet.at(-1);
  const tanaan = new Date().toISOString().slice(0, 10);
  const alkupaiva = kausi
    ? tanaan >= kausi.alkaa && tanaan <= kausi.loppuu
      ? tanaan
      : kausi.alkaa
    : tanaan;

  return (
    <LaskuLomake
      alkupaiva={alkupaiva}
      alvVelvollinen={asetusPaalla(init.asetukset.AlvVelvollinen)}
      onTallennettu={(id) => navigate({ to: '/myyntilaskut/$id', params: { id: String(id) } })}
    />
  );
}
