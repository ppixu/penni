import { cn } from '@/lib/utils';
import type { Kumppani } from '@penni/engine';
import { Command, CommandInput, CommandItem, CommandList } from 'cmdk';
import { useEffect, useRef, useState } from 'react';

/** Valitun asiakkaan näyttönimi (suljettu tila) tai tyhjä. */
function valitunNimi(kumppanit: readonly Kumppani[], arvo: number | undefined): string {
  if (arvo === undefined) return '';
  return kumppanit.find((k) => k.id === arvo)?.nimi ?? String(arvo);
}

const ITEM_LUOKKA = cn(
  'flex cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5 text-[12.5px]',
  'data-[selected=true]:bg-[var(--accent-soft)] data-[selected=true]:text-[var(--accent)]',
);

/**
 * Asiakas-combobox (TiliValitsin-malli: cmdk itsesijoittuvalla listalla, ei Radixia).
 * Listan viimeisenä kiinteä "+ Uusi asiakas" -vaihtoehto: forceMount ohittaa suodatuksen,
 * joten pikaluonti on aina saatavilla — myös kun haku ei osu yhteenkään asiakkaaseen.
 */
export function KumppaniValitsin({
  kumppanit,
  arvo,
  ariaLabel,
  onValitse,
  onUusiAsiakas,
}: {
  kumppanit: readonly Kumppani[];
  arvo?: number | undefined;
  ariaLabel: string;
  onValitse: (id: number) => void;
  onUusiAsiakas: () => void;
}) {
  const [auki, setAuki] = useState(false);
  const [haku, setHaku] = useState(() => valitunNimi(kumppanit, arvo));

  // Heijasta ulkoinen valinta syötteen tekstiin (esim. pikaluontidialogin jälkeen:
  // arvo vaihtuu heti ja nimi tarkentuu kun kumppanit-lista on invalidoitu ja haettu).
  // Synkataan vain kun valinta tai sen ratkaistu nimi muuttuu (arvo vaihtuu, tai
  // myöhään latautuva kumppanit-lista tarkentaa id:n nimeksi) — pelkkä taulukon
  // identiteetin vaihtuminen (esim. react-queryn taustapäivitys) ei koskaan
  // pyyhi käyttäjän kesken olevaa hakutekstiä.
  const edellinenArvo = useRef(arvo);
  const edellinenNimi = useRef(valitunNimi(kumppanit, arvo));
  useEffect(() => {
    const nimi = valitunNimi(kumppanit, arvo);
    if (arvo !== edellinenArvo.current || nimi !== edellinenNimi.current) {
      edellinenArvo.current = arvo;
      edellinenNimi.current = nimi;
      setHaku(nimi);
    }
  }, [kumppanit, arvo]);

  return (
    <div className="relative">
      <Command
        // cmdk pakottaa inputin aria-labelledby:n sisäiseen <label>iin — saavutettava
        // nimi annetaan Commandin label-propilla (sama kuin TiliValitsimessa).
        label={ariaLabel}
        filter={(value, search) =>
          value.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
        }
        className="block"
      >
        <CommandInput
          role="combobox"
          aria-label={ariaLabel}
          value={haku}
          onValueChange={(v) => {
            setHaku(v);
            setAuki(true);
          }}
          onFocus={() => setAuki(true)}
          onBlur={() => setAuki(false)}
          className="w-full rounded-[var(--radius-input)] border border-[var(--border-strong)] bg-transparent px-[10px] py-2 text-[13px] outline-none"
        />
        {auki && (
          // Estä blur ennen klikkauksen osumista: ilman tätä inputin onBlur sulkisi/purkaisi
          // tämän listan mousedownilla ennen kuin click ehtii laueta, eikä CommandItemin
          // onSelect koskaan käynnistyisi hiirellä (vain näppäimistö toimisi).
          <CommandList
            onMouseDown={(e) => e.preventDefault()}
            className="absolute right-0 left-0 top-[calc(100%+4px)] z-[5] max-h-[220px] overflow-auto rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] p-1 shadow-[var(--shadow-pop)]"
          >
            {kumppanit.map((k) => (
              <CommandItem
                key={k.id}
                value={`${k.nimi} ${k.id}`}
                onSelect={() => {
                  onValitse(k.id);
                  setHaku(k.nimi);
                  setAuki(false);
                }}
                className={ITEM_LUOKKA}
              >
                {k.nimi}
              </CommandItem>
            ))}
            <CommandItem
              forceMount
              value="uusi-asiakas"
              onSelect={() => {
                setAuki(false);
                onUusiAsiakas();
              }}
              className={cn(ITEM_LUOKKA, 'font-semibold text-[var(--accent)]')}
            >
              + Uusi asiakas
            </CommandItem>
          </CommandList>
        )}
      </Command>
    </div>
  );
}
