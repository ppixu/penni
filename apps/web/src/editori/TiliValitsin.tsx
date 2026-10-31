import { cn } from '@/lib/utils';
import { usePiilotetutTilit } from '@/tilikartta/PiilotetutTilit';
import { useTiliValinta } from '@/tilikartta/TiliValinta';
import { NAKYMAT, type Nakyma, alkunakyma, tilitNakymassa } from '@/tilikartta/tilinakyma';
import { type Tili, nimi } from '@penni/engine';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from 'cmdk';
import { type Ref, useRef, useState } from 'react';

const TYHJA_TEKSTI: Record<Nakyma, string> = {
  suosikit: 'Ei suosikkitilejä',
  viimeksi: 'Ei viimeksi käytettyjä tilejä',
  kaikki: 'Ei tiliä',
};

/** The display label of the currently-selected account (closed state), or a placeholder. */
function valitunNimi(tilit: readonly Tili[], arvo: number | undefined): string {
  if (arvo === undefined) return '';
  const t = tilit.find((x) => x.numero === arvo);
  return t ? `${t.numero} ${nimi(t)}` : String(arvo);
}

/**
 * In-cell account combobox: cmdk Command in a self-positioned dropdown (no Radix popover).
 * Avattaessa (ei kirjoitettua hakua) lista näyttää välilehdet Suosikit / Viimeksi käytetyt /
 * Kaikki kuten tilikartta; kirjoitettu haku etsii aina kaikista tileistä numerolla ja nimellä.
 */
export function TiliValitsin({
  tilit,
  arvo,
  ariaLabel,
  onValitse,
  inputRef,
  onAcceptDone,
  piilotetut,
}: {
  tilit: readonly Tili[];
  /** Tilikartassa piilotetut tilit (`piilotilit`): eivät näy listalla, paitsi jo valittu tili.
   *  Oletuksena luetaan sovelluksen kontekstista (juurireitti). */
  piilotetut?: ReadonlySet<number> | undefined;
  // Explicit `| undefined` so the grid can pass `arvo={rivi.tili}` (number | undefined)
  // under exactOptionalPropertyTypes without a cast.
  arvo?: number | undefined;
  ariaLabel: string;
  onValitse: (numero: number) => void;
  inputRef?: Ref<HTMLInputElement>;
  /** Called after a selection so the grid can advance focus (e.g. to Debet). */
  onAcceptDone?: () => void;
}) {
  const [auki, setAuki] = useState(false);
  const naytettava = valitunNimi(tilit, arvo);
  const [haku, setHaku] = useState(naytettava);
  // Arvo voi vaihtua ulkopuolelta (kuitin tai ehdotuksen vaihtuessa, tilikartta latautuu):
  // kenttä seuraa sitä ilman remountia, jottei fokus ja kirjoitus katoa kesken muokkauksen.
  const [edellinen, setEdellinen] = useState(naytettava);
  if (naytettava !== edellinen) {
    setEdellinen(naytettava);
    setHaku(naytettava);
  }
  // Fokusoinnin hiiriklikkaus ei saa kumota select():iä (mouseup asettaisi kursorin).
  const juuriFokusoitu = useRef(false);
  const kontekstista = usePiilotetutTilit();
  const piilossa = piilotetut ?? kontekstista;
  const lehdet = tilit.filter(
    (t) => t.otsikkotaso === 0 && (t.numero === arvo || !piilossa.has(t.numero)),
  );
  const { suosikit, kaytto } = useTiliValinta();
  const valilehdet = suosikit.size > 0 || (kaytto?.size ?? 0) > 0;
  const [valittuNakyma, setValittuNakyma] = useState<Nakyma | null>(null);
  const nakyma = valittuNakyma ?? alkunakyma(suosikit.size, kaytto?.size ?? 0);
  // Selaus = ei omaa hakua (tyhjä tai valitun tilin nimi): näytetään välilehden tilit.
  const selaus = haku.trim() === '' || haku === naytettava;
  const naytettavat = selaus
    ? tilitNakymassa(lehdet, valilehdet ? nakyma : 'kaikki', {
        suosikit,
        piilotetut: piilossa,
        kaytto,
        naytaPiilotetut: true, // lehdet on jo suodatettu (valittu tili saa näkyä)
      })
    : lehdet;
  const arvoksi = (t: Tili) => `${t.numero} ${nimi(t)}`;
  // Korostettu rivi ohjataan itse: avattaessa korostus on nykyisellä tilillä, jottei Enter
  // vaihda tiliä listan ensimmäiseen (gridissä Enter vain etenee).
  const [korostettu, setKorostettu] = useState('');

  function avaa() {
    setAuki(true);
    setValittuNakyma(null);
    setKorostettu(naytettava);
  }

  function vaihdaNakyma(n: Nakyma) {
    setValittuNakyma(n);
    setHaku('');
    const ensimmainen = tilitNakymassa(lehdet, n, {
      suosikit,
      piilotetut: piilossa,
      kaytto,
      naytaPiilotetut: true,
    })[0];
    setKorostettu(ensimmainen ? arvoksi(ensimmainen) : '');
  }

  return (
    <div className="relative">
      <Command
        // cmdk forces the input's aria-labelledby to its internal <label>, overriding any
        // aria-label on CommandInput. So drive the accessible name via Command's `label`.
        label={ariaLabel}
        // Default substring filter over each item's `value` ("1900 Pankkitili") → matches number OR name.
        filter={(value, search) =>
          value.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
        }
        // Selatessa lista on jo välilehden mukainen; vain kirjoitettu haku suodattaa.
        shouldFilter={!selaus}
        value={korostettu}
        onValueChange={setKorostettu}
        // Let Enter accept the active item; cmdk handles ↑/↓ internally.
        className="block"
      >
        <CommandInput
          ref={inputRef}
          role="combobox"
          aria-label={ariaLabel}
          value={haku}
          onValueChange={(v) => {
            setHaku(v);
            setAuki(true);
          }}
          onFocus={(e) => {
            // Koko teksti valituksi: kirjoitus korvaa nykyisen tilin eikä jatka sen nimeä
            // ("9900 Ennakkoverot2365" ei löytäisi mitään).
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
              setHaku(naytettava);
              setAuki(false);
            }
          }}
          onBlur={() => {
            juuriFokusoitu.current = false;
            setAuki(false);
            // Keskeneräinen haku ei jää kenttään: näytetään valittu tili.
            setHaku(naytettava);
          }}
          className="w-full bg-transparent outline-none"
        />
        {auki && (
          // Estä blur ennen klikkauksen osumista: ilman tätä inputin onBlur sulkisi/purkaisi
          // tämän listan mousedownilla ennen kuin click ehtii laueta, eikä CommandItemin
          // onSelect koskaan käynnistyisi hiirellä (vain näppäimistö toimisi).
          <CommandList
            onMouseDown={(e) => e.preventDefault()}
            className="absolute right-0 left-0 top-[calc(100%+4px)] z-[5] max-h-[220px] overflow-auto rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] p-1 shadow-[var(--shadow-pop)]"
          >
            {valilehdet && selaus && (
              <div
                role="tablist"
                aria-label="Tilivalikoima"
                className="sticky top-0 z-[1] mb-1 flex gap-[2px] rounded-[7px] bg-[var(--track)] p-[2px]"
              >
                {NAKYMAT.map((n) => (
                  <button
                    key={n.arvo}
                    type="button"
                    role="tab"
                    tabIndex={-1}
                    aria-selected={n.arvo === nakyma}
                    onClick={() => vaihdaNakyma(n.arvo)}
                    className={cn(
                      'flex-1 rounded-[5px] px-2 py-[3px] text-[11.5px] transition-colors',
                      n.arvo === nakyma
                        ? 'bg-[var(--surface)] font-semibold text-[var(--accent)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                        : 'font-medium text-[var(--text-muted)]',
                    )}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            )}
            <CommandEmpty className="px-2 py-1.5 text-[12.5px] text-[var(--text-subtle)]">
              {selaus && valilehdet ? TYHJA_TEKSTI[nakyma] : 'Ei tiliä'}
            </CommandEmpty>
            {naytettavat.map((t) => (
              <CommandItem
                key={t.numero}
                value={arvoksi(t)}
                onSelect={() => {
                  onValitse(t.numero);
                  setHaku(`${t.numero} ${nimi(t)}`);
                  setAuki(false);
                  onAcceptDone?.();
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5 text-[12.5px]',
                  'data-[selected=true]:bg-[var(--accent-soft)] data-[selected=true]:text-[var(--accent)]',
                )}
              >
                <span className="w-[42px] text-[var(--text-subtle)] tabular-nums">{t.numero}</span>
                {nimi(t)}
              </CommandItem>
            ))}
          </CommandList>
        )}
      </Command>
    </div>
  );
}
