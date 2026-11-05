import { useAvattavaTosite } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { PalkkaAjoLomake } from '@/palkat/PalkkaAjoLomake';
import { luonnosTositteesta } from '@/palkat/palkkaAjoTiedot';
import { TositeTila, TositeTyyppi } from '@penni/engine';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';

/**
 * Palkka-ajon muokkaus (`/palkat/$id/muokkaa`, ei sisäkkäinen reitti `$id`-sivun alla).
 * Tallennus päivittää saman tositteen; lähetetyksi merkittyä ajoa ei avata lomakkeelle.
 */
export const Route = createFileRoute('/palkat/$id_/muokkaa')({ component: MuokkaaReitti });

function MuokkaaReitti() {
  const { id } = Route.useParams();
  return <PalkanmaksunMuokkaus key={id} id={Number(id)} />;
}

function PalkanmaksunMuokkaus({ id }: { id: number }) {
  // Tuore haku: lomake ei saa avautua välimuistin vanhasta versiosta.
  const { tosite, haettu } = useAvattavaTosite(id);
  const alku = useMemo(
    () => (tosite?.palkka && !tosite.palkka.ilmoitus ? luonnosTositteesta(tosite) : undefined),
    [tosite],
  );

  if (!haettu) {
    return <p className="px-[22px] py-5 text-[13.5px] text-[var(--text-muted)]">Ladataan…</p>;
  }
  const ajo =
    tosite &&
    tosite.tyyppi === TositeTyyppi.PALKKA &&
    tosite.palkka &&
    tosite.tila >= TositeTila.KIRJANPIDOSSA;
  return (
    <>
      <TopBar otsikko="Muokkaa palkanmaksua" />
      <section
        aria-label="palkanmaksu"
        className="flex flex-1 flex-col gap-6 overflow-auto px-[22px] py-5"
      >
        {!ajo ? (
          <p className="text-[13px] text-[var(--text-muted)]">Palkka-ajoa {id} ei ole.</p>
        ) : !alku ? (
          <p className="text-[13px] text-[var(--text-muted)]">
            Palkkatietoilmoitus on merkitty lähetetyksi, joten palkka-ajoa ei voi enää muuttaa
            Pennissä. Korjaukset tehdään Tulorekisterin asiointipalvelussa.{' '}
            <Link to="/palkat/$id" params={{ id: String(id) }} className="underline">
              Takaisin palkanmaksuun
            </Link>
          </p>
        ) : (
          <>
            <p className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-3 text-[12.5px] text-[var(--text-muted)]">
              Tallennus laskee ajon uudelleen ja päivittää saman tositteen. Jos palkkatietoilmoitus
              on jo ladattu Tulorekisteriin, korjaus on tehtävä Tulorekisterin asiointipalvelussa:
              uudelleen ladattu ilmoitus hylätään, koska sen tunnisteet ovat samat.
            </p>
            <PalkkaAjoLomake alku={alku} olemassaOlevaId={id} />
          </>
        )}
      </section>
    </>
  );
}
