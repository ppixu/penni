import { TopBar } from '@/components/shell/TopBar';
import { PalkkaAjoLomake } from '@/palkat/PalkkaAjoLomake';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/palkat/uusi')({ component: UusiPalkanmaksu });

function UusiPalkanmaksu() {
  return (
    <>
      <TopBar otsikko="Uusi palkanmaksu" />
      <section
        aria-label="palkanmaksu"
        className="flex flex-1 flex-col gap-6 overflow-auto px-[22px] py-5"
      >
        <PalkkaAjoLomake />
      </section>
    </>
  );
}
