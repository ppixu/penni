import { cn } from '@/lib/utils';
import {
  type IsoDate,
  type Kohdennus,
  KohdennusTyyppi,
  Luonne,
  type Tili,
  kohdennuksenPolku,
  normalisoiMerkkaukset,
  onVoimassa,
  onko,
} from '@penni/engine';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from 'cmdk';
import { Check } from 'lucide-react';
import { type Ref, useRef, useState } from 'react';
import { kohdennusSolunTeksti } from './kohdennusTeksti.js';

/** Rivin kohdennus ja merkkaukset; kumpikin puuttuu, kun valintaa ei ole. */
export interface KohdennusArvo {
  kohdennus?: number;
  merkkaukset?: number[];
}

/** Kohdennuksen voi valita vain tuloslaskelman tilille tai poistettavalle omaisuudelle
 *  (Kitsas kirjaus/kohdennusdelegaatti.cpp:38-44). */
export function kohdennusSoluKaytossa(tili: Tili | undefined): boolean {
  return (
    tili !== undefined && (onko(tili.luonne, Luonne.TULOS) || onko(tili.luonne, Luonne.POISTETTAVA))
  );
}

const EI_KOHDENNUSTA = 'ei-kohdennusta';
const kohdennusAvain = (id: number) => `kohdennus-${id}`;
const merkkausAvain = (id: number) => `merkkaus-${id}`;

const RYHMA_LUOKKA = cn(
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:pb-1',
  '[&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase',
  '[&_[cmdk-group-heading]]:tracking-[0.6px] [&_[cmdk-group-heading]]:text-[var(--text-subtle)]',
);
const ITEM_LUOKKA = cn(
  'flex cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5 text-[12.5px]',
  'data-[selected=true]:bg-[var(--accent-soft)] data-[selected=true]:text-[var(--accent)]',
);

function Valintamerkki({ valittu }: { valittu: boolean }) {
  return (
    <Check
      aria-hidden
      className={cn('h-3.5 w-3.5 shrink-0', valittu ? 'opacity-100' : 'opacity-0')}
    />
  );
}

/**
 * Kohdennus-combobox (TiliValitsin-malli: cmdk itsesijoittuvalla listalla). Ryhmä
 * "Kustannuspaikat ja projektit" on yksivalinta ("Ei kohdennusta" ensin): valinta sulkee listan
 * ja kutsuu `onAcceptDone`. Ryhmä "Merkkaukset" on monivalinta: Enter tai välilyönti vaihtaa
 * merkkauksen sulkematta listaa. Molemmissa näkyvät rivin päivänä voimassa olevat sekä jo
 * valitut (vanhentunutkin valinta säilyy näkyvissä).
 */
export function KohdennusValitsin({
  kohdennukset,
  pvm,
  arvo,
  onMuuta,
  ariaLabel,
  inputRef,
  onAcceptDone,
}: {
  kohdennukset: readonly Kohdennus[];
  pvm: IsoDate;
  arvo: KohdennusArvo;
  onMuuta: (arvo: KohdennusArvo) => void;
  ariaLabel: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Kustannuspaikan/projektin valinnan jälkeen: ruudukko siirtää fokuksen eteenpäin. */
  onAcceptDone?: () => void;
}) {
  const valitutMerkkaukset = arvo.merkkaukset ?? [];
  const naytettava = kohdennusSolunTeksti(arvo.kohdennus, arvo.merkkaukset, kohdennukset);
  const [auki, setAuki] = useState(false);
  const [haku, setHaku] = useState(naytettava);
  /** Onko kentän teksti käyttäjän kirjoittama haku (eikä valinnan näyttöteksti)? Teksti voi
   *  sattua olemaan sama kuin näyttöteksti (haku "Avustus" + Enter valitsee Avustuksen). */
  const [kirjoitettu, setKirjoitettu] = useState(false);
  function naytaValinta() {
    setHaku(naytettava);
    setKirjoitettu(false);
  }
  // Arvo voi vaihtua ulkopuolelta tai merkkauksen vaihdosta listan ollessa auki: kenttä seuraa
  // sitä, paitsi kun käyttäjä on kirjoittanut oman haun (se säilyy merkkauksia vaihdettaessa).
  const [edellinen, setEdellinen] = useState(naytettava);
  if (naytettava !== edellinen) {
    setEdellinen(naytettava);
    if (!auki || !kirjoitettu || haku.trim() === '') {
      setHaku(naytettava);
      setKirjoitettu(false);
    }
  }
  const juuriFokusoitu = useRef(false);
  const [korostettu, setKorostettu] = useState('');

  const polku = (k: Kohdennus) => kohdennuksenPolku(k, kohdennukset);
  const jarjesta = (lista: Kohdennus[]) =>
    lista.sort((a, b) => polku(a).localeCompare(polku(b), 'fi'));
  const kohdennusValinnat = jarjesta(
    kohdennukset.filter(
      (k) =>
        k.tyyppi !== KohdennusTyyppi.MERKKAUS && (k.id === arvo.kohdennus || onVoimassa(k, pvm)),
    ),
  );
  const merkkausValinnat = jarjesta(
    kohdennukset.filter(
      (k) =>
        k.tyyppi === KohdennusTyyppi.MERKKAUS &&
        (valitutMerkkaukset.includes(k.id) || onVoimassa(k, pvm)),
    ),
  );
  /** Selaus = ei kirjoitettua hakua: lista näytetään suodattamatta, ja välilyönti vaihtaa merkkauksen. */
  const selaus = haku.trim() === '' || (haku === naytettava && !kirjoitettu);

  function avaa() {
    setAuki(true);
    setKirjoitettu(false);
    setKorostettu(
      arvo.kohdennus !== undefined && kohdennusValinnat.some((k) => k.id === arvo.kohdennus)
        ? kohdennusAvain(arvo.kohdennus)
        : EI_KOHDENNUSTA,
    );
  }

  function valitseKohdennus(id: number | undefined) {
    const { kohdennus: _vanha, ...muut } = arvo;
    onMuuta(id === undefined ? muut : { ...muut, kohdennus: id });
    setAuki(false);
    onAcceptDone?.();
  }

  function vaihdaMerkkaus(id: number) {
    const uudet = valitutMerkkaukset.includes(id)
      ? valitutMerkkaukset.filter((m) => m !== id)
      : [...valitutMerkkaukset, id];
    const { merkkaukset: _vanhat, ...muut } = arvo;
    const normalisoitu = normalisoiMerkkaukset(uudet);
    onMuuta(normalisoitu ? { ...muut, merkkaukset: normalisoitu } : muut);
    setKorostettu(merkkausAvain(id));
  }

  return (
    <div className="relative">
      <Command
        // cmdk pakottaa inputin aria-labelledby:n sisäiseen <label>iin: nimi Commandin labelilla.
        label={ariaLabel}
        // Haku osuu näyttönimeen (keywords); value on vain yksilöivä avain.
        filter={(_value, search, keywords) =>
          (keywords ?? []).join(' ').toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
        }
        shouldFilter={!selaus}
        value={korostettu}
        onValueChange={setKorostettu}
        className="block"
      >
        <CommandInput
          ref={inputRef}
          role="combobox"
          aria-label={ariaLabel}
          value={haku}
          onValueChange={(v) => {
            setHaku(v);
            setKirjoitettu(true);
            setAuki(true);
          }}
          onFocus={(e) => {
            e.currentTarget.select();
            juuriFokusoitu.current = true;
            avaa();
          }}
          onMouseUp={(e) => {
            if (juuriFokusoitu.current) e.preventDefault();
            juuriFokusoitu.current = false;
          }}
          onKeyDown={(e) => {
            juuriFokusoitu.current = false;
            if (e.key === 'Escape' && auki) {
              naytaValinta();
              setAuki(false);
            } else if (e.key === ' ' && auki && selaus && korostettu.startsWith('merkkaus-')) {
              // Välilyönti vaihtaa korostetun merkkauksen vain selattaessa: kirjoitetussa haussa
              // se on hakusanojen väli. Enter vaihtaa aina (cmdk:n onSelect).
              e.preventDefault();
              vaihdaMerkkaus(Number(korostettu.slice('merkkaus-'.length)));
            }
          }}
          onBlur={() => {
            juuriFokusoitu.current = false;
            setAuki(false);
            naytaValinta();
          }}
          className="w-full bg-transparent outline-none"
        />
        {auki && (
          // mousedown ei saa viedä fokusta inputilta ennen kuin klikkaus osuu riviin.
          <CommandList
            onMouseDown={(e) => e.preventDefault()}
            className="absolute right-0 left-0 top-[calc(100%+4px)] z-[5] max-h-[260px] min-w-[220px] overflow-auto rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] p-1 shadow-[var(--shadow-pop)]"
          >
            <CommandEmpty className="px-2 py-1.5 text-[12.5px] text-[var(--text-subtle)]">
              Ei osumia
            </CommandEmpty>
            <CommandGroup heading="Kustannuspaikat ja projektit" className={RYHMA_LUOKKA}>
              <CommandItem
                value={EI_KOHDENNUSTA}
                keywords={['Ei kohdennusta']}
                onSelect={() => valitseKohdennus(undefined)}
                className={ITEM_LUOKKA}
              >
                <Valintamerkki valittu={arvo.kohdennus === undefined} />
                Ei kohdennusta
              </CommandItem>
              {kohdennusValinnat.map((k) => (
                <CommandItem
                  key={k.id}
                  value={kohdennusAvain(k.id)}
                  keywords={[polku(k)]}
                  onSelect={() => valitseKohdennus(k.id)}
                  className={ITEM_LUOKKA}
                >
                  <Valintamerkki valittu={k.id === arvo.kohdennus} />
                  {polku(k)}
                </CommandItem>
              ))}
            </CommandGroup>
            {merkkausValinnat.length > 0 && (
              <CommandGroup heading="Merkkaukset" className={RYHMA_LUOKKA}>
                {merkkausValinnat.map((k) => {
                  const valittu = valitutMerkkaukset.includes(k.id);
                  return (
                    <CommandItem
                      key={k.id}
                      value={merkkausAvain(k.id)}
                      keywords={[polku(k)]}
                      aria-checked={valittu}
                      onSelect={() => vaihdaMerkkaus(k.id)}
                      className={ITEM_LUOKKA}
                    >
                      <Valintamerkki valittu={valittu} />
                      {polku(k)}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        )}
      </Command>
    </div>
  );
}
