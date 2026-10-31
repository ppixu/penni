import { useTallennaKumppani } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { KumppaniLomake } from '@/kumppanit/KumppaniLomake';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

export const Route = createFileRoute('/kumppanit/uusi')({ component: UusiKumppani });

function UusiKumppani() {
  const navigate = useNavigate();
  const { tallenna, virheviesti, tallentaa } = useTallennaKumppani();

  return (
    <>
      <TopBar otsikko="Uusi kumppani" />
      <KumppaniLomake
        tallentaa={tallentaa}
        virhe={virheviesti}
        onTallenna={async (syote) => {
          const kumppani = await tallenna(syote);
          if (kumppani) navigate({ to: '/kumppanit/$id', params: { id: String(kumppani.id) } });
        }}
      />
    </>
  );
}
