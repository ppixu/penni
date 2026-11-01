import { useKpClient } from '@/app/KpClientProvider';
import { avaimet, useInit, useKumppanit, useLisaaLiite } from '@/app/kysely';
import { type StoredTosite, asetusPaalla } from '@penni/engine';
import { laskuMalli } from '@penni/lasku-pdf';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LaskuLomake } from './LaskuLomake';
import { lataaLaskuPdf } from './lataaLaskuPdf';

/**
 * Olemassa olevan myyntilaskuluonnoksen muokkausnäkymä (`/myyntilaskut/$id`, kun tosite on
 * luonnos): sama lomake kuin uudella laskulla. Kirjauksen jälkeen lasku ladataan PDF:nä ja näkymä
 * vaihtuu tavalliseen laskudokumenttiin; poiston jälkeen palataan Lähtevät-listaan.
 */
export function LaskuLuonnos({ tosite }: { tosite: StoredTosite }) {
  const { data: init } = useInit();
  const { data: kumppanit } = useKumppanit();
  const client = useKpClient();
  const { lisaa } = useLisaaLiite();
  const qc = useQueryClient();
  const navigate = useNavigate();

  if (!init) return <p className="px-[22px] py-5 text-[var(--text-muted)]">Ladataan…</p>;

  async function kirjattu(kirjattuTosite: StoredTosite) {
    if (!init) return;
    // PDF tehdään kirjatusta tositteesta (numero ja viite ovat nyt olemassa). Tallennus- tai
    // muodostusongelma ei kumoa kirjausta; kirjattu lasku näyttää Lataa PDF -napin uudelleen.
    const malli = laskuMalli({
      tosite: kirjattuTosite,
      kumppanit: kumppanit ?? (await client.haeKumppanit()),
      asetukset: init.asetukset,
    });
    await lataaLaskuPdf({
      malli,
      tositeId: kirjattuTosite.id,
      client: { haeLiitteet: (id) => client.haeLiitteet(id), lisaaLiite: lisaa },
      nyt: new Date().toISOString(),
    });
    // Vasta nyt tosite-välimuisti vanhenee: reitti vaihtaa luonnoslomakkeen laskudokumenttiin.
    await qc.invalidateQueries({ queryKey: avaimet.tosite(kirjattuTosite.id) });
  }

  return (
    <LaskuLomake
      alkupaiva={tosite.laskupvm ?? tosite.pvm}
      alvVelvollinen={asetusPaalla(init.asetukset.AlvVelvollinen)}
      luonnos={{
        tosite,
        onKirjattu: kirjattu,
        onPoistettu: () =>
          void navigate({ to: '/tositteet', search: { laji: 'tulot', valilehti: 'lahtevat' } }),
      }}
    />
  );
}
