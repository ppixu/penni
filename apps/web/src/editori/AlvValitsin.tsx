import { AlvKoodi, VEROTYYPIT, type VeroTyyppi, alvKannat } from '@penni/engine';
import type { IsoDate } from '@penni/engine';
import { useEffect, useRef, useState } from 'react';

/**
 * Valintalistan nimet. Kitsaksen "(netto)"/"(brutto)" (VEROTYYPIT.selite) johtaa harhaan:
 * käyttäjä luulee sen kertovan, onko syötetty summa verollinen. Pennissä tavallinen
 * verollinen koodi (11/21) ottaa summan verollisena ja erottaa veron omaksi viennikseen;
 * 12/22 on bruttokirjaus, jossa koko summa jää tulo-/menotilille ja vero erotetaan vasta
 * alv-tilityksessä. Koodit pysyvät ennallaan.
 */
const NIMET = new Map<number, string>([
  [AlvKoodi.MYYNNIT_NETTO, 'Verollinen myynti'],
  [AlvKoodi.MYYNNIT_BRUTTO, 'Verollinen myynti (bruttokirjaus)'],
  [AlvKoodi.OSTOT_NETTO, 'Verollinen osto'],
  [AlvKoodi.OSTOT_BRUTTO, 'Verollinen osto (bruttokirjaus)'],
]);

export function alvValintaNimi(t: VeroTyyppi): string {
  return NIMET.get(t.koodi) ?? t.selite;
}

/** Suomalainen prosenttiesitys: 25.5 -> "25,5 %" (sitova välilyönti ennen %-merkkiä). */
export function muotoileAlvProsentti(prosentti: number): string {
  return `${String(prosentti).replace('.', ',')} %`;
}

/** Suljetun valitsimen lyhyt teksti: lajin ensimmäinen sana (bruttokirjaus "Brutto") + kanta. */
function lyhenne(t: VeroTyyppi, alvProsentti: number): string {
  const bruttokirjaus = t.koodi === AlvKoodi.MYYNNIT_BRUTTO || t.koodi === AlvKoodi.OSTOT_BRUTTO;
  const sana = bruttokirjaus ? 'Brutto' : (t.selite.split(' ')[0] ?? '');
  return t.nollalaji ? sana : `${sana} ${muotoileAlvProsentti(alvProsentti)}`;
}

/** Per-row VAT-code + rate picker. Emits (alvKoodi, alvProsentti). Zero-rated codes force 0%. */
export function AlvValitsin({
  rivi,
  alvKoodi,
  alvProsentti,
  pvm,
  koodit,
  onValitse,
  ariaLabel,
}: {
  rivi: number;
  alvKoodi: number;
  alvProsentti: number;
  pvm: IsoDate;
  /** Rajaa valittavat verolajit annettuihin koodeihin (esim. laskulomakkeen myyntikoodit).
   *  Ilman proppia lista on koko VEROTYYPIT — editorin käytös ei muutu. */
  koodit?: readonly number[] | undefined;
  onValitse: (alvKoodi: number, alvProsentti: number) => void;
  ariaLabel: string;
}) {
  const [auki, setAuki] = useState(false);
  const summaryRef = useRef<HTMLElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // Natiivi <details> ei sulkeudu ulkopuoliseen klikkaukseen: auki unohtunut lista jäisi
  // muiden rivien kenttien päälle ja nielaisisi niihin tarkoitetut klikkaukset ja näppäilyt.
  useEffect(() => {
    if (!auki) return;
    const sulje = (e: Event) => {
      if (e.target instanceof Node && detailsRef.current?.contains(e.target)) return;
      setAuki(false);
    };
    const nappain = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setAuki(false);
      summaryRef.current?.focus();
    };
    document.addEventListener('pointerdown', sulje, true);
    document.addEventListener('focusin', sulje, true);
    document.addEventListener('keydown', nappain);
    return () => {
      document.removeEventListener('pointerdown', sulje, true);
      document.removeEventListener('focusin', sulje, true);
      document.removeEventListener('keydown', nappain);
    };
  }, [auki]);
  const kannat = alvKannat(pvm);
  const oletusKanta = kannat[0] ?? 25.5;
  const valittu = VEROTYYPIT.find((t) => t.koodi === alvKoodi);
  const tyypit =
    koodit !== undefined ? VEROTYYPIT.filter((t) => koodit.includes(t.koodi)) : VEROTYYPIT;
  return (
    // relative: valikko asemoidaan tämän suhteen ja avataan oikeaan reunaan tasattuna
    // vasemmalle, jottei viimeisen sarakkeen valikko valu ikkunan oikean reunan yli.
    <details
      ref={detailsRef}
      className="relative inline-block text-right"
      open={auki}
      onToggle={(e) => setAuki((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary
        ref={summaryRef}
        // biome-ignore lint/a11y/useSemanticElements: <summary> tarvitsee eksplisiittisen button-roolin, jotta se löytyy napiksi sekä avustavalle tekniikalle että testeille
        role="button"
        aria-label={ariaLabel}
        title={valittu && valittu.koodi !== 0 ? alvValintaNimi(valittu) : undefined}
        className="cursor-pointer list-none whitespace-nowrap"
      >
        {valittu && valittu.koodi !== 0 ? lyhenne(valittu, alvProsentti) : '—'}
      </summary>
      <ul className="absolute right-0 z-10 mt-1 w-max max-w-[calc(100vw-32px)] rounded border border-[var(--border)] bg-[var(--surface)] p-1 text-left">
        {tyypit.map((t) => (
          <li key={t.koodi}>
            <button
              type="button"
              // biome-ignore lint/a11y/useSemanticElements: tyylitelty valintalista vaatii <button>:n option-roolilla; <option> ei tyylity eikä ole klikattava näin
              role="option"
              aria-selected={t.koodi === alvKoodi}
              onClick={() => {
                onValitse(t.koodi, t.nollalaji ? 0 : oletusKanta);
                // Sulje valinnan jälkeen ja palauta fokus summaryyn, jotta rivin Enter
                // (tasaavan rivin lisäys) toimii kuten Debet/Kredit-soluissa.
                setAuki(false);
                summaryRef.current?.focus();
              }}
              className="block w-full px-2 py-1 text-left hover:bg-[var(--track)]"
            >
              {alvValintaNimi(t)}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
