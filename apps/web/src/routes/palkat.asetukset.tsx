import { useInit } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { PalkkatiliLomake, TyonantajaLomake } from '@/palkat/PalkkaAsetuksetLomake';
import { PalkkataulukkoLomake } from '@/palkat/PalkkataulukkoLomake';
import { KENTTA_LUOKKA, LABEL_LUOKKA } from '@/palkat/lomakeLuokat';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/palkat/asetukset')({ component: PalkatAsetuksetSivu });

const ENSIMMAINEN_VUOSI = 2025;

/** Vuodet, joille taulukko voi olla: 2025 → ensi vuosi (vähintään 2027). */
function vuodet(): number[] {
  const loppu = Math.max(2027, new Date().getFullYear() + 1);
  return Array.from({ length: loppu - ENSIMMAINEN_VUOSI + 1 }, (_, i) => ENSIMMAINEN_VUOSI + i);
}

function PalkatAsetuksetSivu() {
  const { data: init } = useInit();
  const lista = vuodet();
  const nyt = new Date().getFullYear();
  const [vuosi, setVuosi] = useState(lista.includes(nyt) ? nyt : (lista[0] as number));

  if (!init) {
    return (
      <>
        <TopBar otsikko="Palkka-asetukset" />
        <p className="px-[22px] py-5 text-[13.5px] text-[var(--text-muted)]">Ladataan…</p>
      </>
    );
  }

  return (
    <>
      <TopBar otsikko="Palkka-asetukset" alaotsikko={init.asetukset.Nimi} />
      <section
        aria-label="palkka-asetukset"
        className="flex flex-1 flex-col gap-8 overflow-auto px-[22px] py-5"
      >
        <label className={`${LABEL_LUOKKA} w-[140px]`}>
          Vuosi
          <select
            aria-label="Vuosi"
            value={vuosi}
            onChange={(e) => setVuosi(Number(e.target.value))}
            className={KENTTA_LUOKKA}
          >
            {lista.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <TyonantajaLomake vuosi={vuosi} />
        <PalkkatiliLomake />
        <PalkkataulukkoLomake key={vuosi} vuosi={vuosi} />
      </section>
    </>
  );
}
