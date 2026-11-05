import { useInit } from '@/app/kysely';
import { LaskuLomake } from '@/laskutus/LaskuLomake';
import { paikallinenTanaan } from '@/tositteet/pikavalinnat';
import { asetusPaalla } from '@penni/engine';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

export const Route = createFileRoute('/myyntilaskut/ryhma')({ component: UusiRyhmalasku });

/** Uusi ryhmälasku (spec §6.2): laskulomake vastaanottajalistalla; tallennus luo yhden
 *  luonnoksen per vastaanottaja, ja käyttäjä jatkaa Lähtevät-välilehdelle. */
function UusiRyhmalasku() {
  const { data: init } = useInit();
  const navigate = useNavigate();

  if (!init) return <p className="px-[22px] py-5 text-[var(--text-muted)]">Ladataan…</p>;

  // Laskupvm-oletus kuten myyntilaskut.uusi.tsx: tänään puristettuna aktiiviseen tilikauteen.
  const kausi = init.tilikaudet.at(-1);
  const tanaan = paikallinenTanaan();
  const alkupaiva = kausi
    ? tanaan >= kausi.alkaa && tanaan <= kausi.loppuu
      ? tanaan
      : kausi.alkaa
    : tanaan;

  return (
    <LaskuLomake
      ryhmalasku
      alkupaiva={alkupaiva}
      alvVelvollinen={asetusPaalla(init.asetukset.AlvVelvollinen)}
      onRyhmaTallennettu={() =>
        navigate({ to: '/tositteet', search: { laji: 'tulot', valilehti: 'lahtevat' } })
      }
    />
  );
}
