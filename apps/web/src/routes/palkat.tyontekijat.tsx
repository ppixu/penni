import { useInit } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { TyontekijaLista } from '@/palkat/TyontekijaLista';
import { TyontekijaLomake } from '@/palkat/TyontekijaLomake';
import { useTyontekijat } from '@/palkat/usePalkatAsetukset';
import type { Tyontekija } from '@penni/palkat';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

export const Route = createFileRoute('/palkat/tyontekijat')({ component: Tyontekijat });

/** Lomake auki: uusi työntekijä, olemassa olevan muokkaus tai suljettu. */
type Lomake = { tila: 'uusi' } | { tila: 'muokkaa'; tyontekija: Tyontekija } | null;

function Tyontekijat() {
  const { data: init } = useInit();
  const { tyontekijat, rikkinaiset, virhe, ladataan, tallenna, tallentaa } = useTyontekijat();
  const [lomake, setLomake] = useState<Lomake>(null);
  const [tallennusVirhe, setTallennusVirhe] = useState<string | null>(null);
  const idt = useMemo(() => new Set(tyontekijat.map((t) => t.id)), [tyontekijat]);
  const toiminimi = init?.asetukset.muoto === 'tmi';

  async function talleta(t: Tyontekija): Promise<boolean> {
    setTallennusVirhe(null);
    try {
      await tallenna(t);
      return true;
    } catch (e) {
      setTallennusVirhe(e instanceof Error ? e.message : 'Tallennus epäonnistui.');
      return false;
    }
  }

  return (
    <>
      <TopBar
        otsikko="Työntekijät"
        toiminnot={
          <Button
            size="compact"
            disabled={virhe !== undefined}
            onClick={() => setLomake({ tila: 'uusi' })}
          >
            + Lisää työntekijä
          </Button>
        }
      />
      <section
        aria-label="työntekijät"
        className="flex flex-1 flex-col gap-4 overflow-auto px-[22px] py-5"
      >
        {virhe && (
          <p role="alert" className="text-[12.5px] text-[var(--danger)]">
            {virhe} Korjaa asetus ennen työntekijöiden lisäämistä.
          </p>
        )}
        {rikkinaiset.map((r) => (
          <p key={r.jarjestys} role="alert" className="text-[12.5px] text-[var(--danger)]">
            {`Tietue ${r.jarjestys}${r.nimi ? ` (${r.nimi})` : ''} on virheellinen eikä näy listassa: ${r.syy}. Tietuetta ei ole muutettu.`}
          </p>
        ))}

        {!lomake && tallennusVirhe && (
          <p role="alert" className="text-[12.5px] text-[var(--danger)]">
            {tallennusVirhe}
          </p>
        )}

        {!ladataan && tyontekijat.length === 0 && rikkinaiset.length === 0 && !virhe && (
          <p className="text-[13.5px] text-[var(--text-muted)]">Ei työntekijöitä.</p>
        )}
        {tyontekijat.length > 0 && (
          <TyontekijaLista
            tyontekijat={tyontekijat}
            kaynnissa={tallentaa}
            onMuokkaa={(t) => {
              setTallennusVirhe(null);
              setLomake({ tila: 'muokkaa', tyontekija: t });
            }}
            onAktiivisuus={(t, aktiivinen) => void talleta({ ...t, aktiivinen })}
          />
        )}

        {lomake && (
          <TyontekijaLomake
            key={lomake.tila === 'muokkaa' ? lomake.tyontekija.id : 'uusi'}
            alkuarvo={lomake.tila === 'muokkaa' ? lomake.tyontekija : undefined}
            kaytossaOlevatIdt={idt}
            toiminimi={toiminimi}
            tallentaa={tallentaa}
            virhe={tallennusVirhe}
            onPeru={() => setLomake(null)}
            onTallenna={async (t) => {
              if (await talleta(t)) setLomake(null);
            }}
          />
        )}
      </section>
    </>
  );
}
