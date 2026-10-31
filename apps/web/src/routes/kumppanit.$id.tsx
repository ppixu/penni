import {
  useKumppanit,
  useMyyntilaskut,
  useOstolaskut,
  usePoistaKumppani,
  useTallennaKumppani,
} from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { KumppaniLomake } from '@/kumppanit/KumppaniLomake';
import { onkoKumppaniViitattu } from '@/kumppanit/kumppaniViitattu';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/kumppanit/$id')({ component: MuokkaaKumppani });

function MuokkaaKumppani() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const numeroId = Number(id);

  const { data: kumppanit, isLoading, isFetching } = useKumppanit();
  const { tallenna, virheviesti, tallentaa } = useTallennaKumppani();
  const { poista, virheviesti: poistoVirhe, poistaa } = usePoistaKumppani();
  const { data: myyntilaskut, isSuccess: myyntiOk } = useMyyntilaskut({});
  const { data: ostolaskut, isSuccess: ostoOk } = useOstolaskut({});

  const [tallennettu, setTallennettu] = useState(false);
  const [vahvistaa, setVahvistaa] = useState(false);

  const kumppani = (kumppanit ?? []).find((k) => k.id === numeroId);
  const loytymatta = !isLoading && !isFetching && !kumppani;

  // Ohjaus tehdään efektissä (ei renderöinnin aikana), ettei React varoita tilan
  // päivittämisestä toisen komponentin renderöinnin aikana — sama kuviota kuin
  // myyntilaskut.$id.tsx:n vieras-tositetyyppi -ohjauksessa.
  useEffect(() => {
    if (loytymatta) {
      void navigate({ to: '/kumppanit' });
    }
  }, [loytymatta, navigate]);

  if (isLoading || (!kumppani && isFetching)) {
    return <p className="px-[22px] py-5 text-[var(--text-muted)]">Ladataan…</p>;
  }
  if (!kumppani) {
    return null; // uudelleenohjaus käynnissä
  }

  // Poiston suojaus: estä kun viitataan laskulla; estä myös kun viittauslistoja ei ole
  // varmennettu onnistuneesti (virhe/tauko ei saa avata poistoa oletuksena).
  const viitattu = onkoKumppaniViitattu(numeroId, myyntilaskut ?? [], ostolaskut ?? []);
  const poistoEstetty = !myyntiOk || !ostoOk || viitattu || poistaa;

  return (
    <>
      <TopBar otsikko="Muokkaa kumppania" />
      <KumppaniLomake
        key={kumppani.id}
        alkuarvo={kumppani}
        tallentaa={tallentaa}
        virhe={virheviesti}
        onTallenna={async (syote) => {
          setTallennettu(false);
          const ok = await tallenna(syote);
          if (ok) setTallennettu(true);
        }}
      />
      <div className="flex flex-col gap-2 px-[22px] pb-6">
        {tallennettu && <p className="text-[12.5px] text-[var(--text-muted)]">Tallennettu.</p>}
        {viitattu && (
          <p className="text-[12.5px] text-[var(--text-muted)]">
            Kumppania käytetään laskuilla, ei voi poistaa
          </p>
        )}
        {poistoVirhe && <p className="text-[12.5px] text-[var(--danger)]">{poistoVirhe}</p>}
        {vahvistaa ? (
          <div className="flex items-center gap-3">
            <span className="text-[13px]">Poistetaanko kumppani {kumppani.nimi}?</span>
            <Button
              type="button"
              disabled={poistoEstetty}
              onClick={async () => {
                const ok = await poista(numeroId);
                if (ok) navigate({ to: '/kumppanit' });
              }}
            >
              Poista kumppani
            </Button>
            <Button variant="sec" type="button" onClick={() => setVahvistaa(false)}>
              Peruuta
            </Button>
          </div>
        ) : (
          <div>
            <Button
              variant="sec"
              type="button"
              disabled={poistoEstetty}
              onClick={() => setVahvistaa(true)}
            >
              Poista
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
