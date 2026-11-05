import { Button } from '@/components/ui/button';
import { KENTTA_LUOKKA, VIRHE_LUOKKA } from '@/palkat/lomakeLuokat';
import { muotoileBp, parsiBp } from '@/palkat/prosentti';
import { usePalkatAsetukset } from '@/palkat/usePalkatAsetukset';
import { Euro, muotoileEuro } from '@penni/euro';
import { EuroParseError } from '@penni/euro';
import { type TaulukkoKentta, haeTaulukko, taulukonLahteet } from '@penni/palkat';
import { useState } from 'react';

interface Rivi {
  kentta: TaulukkoKentta;
  nimi: string;
  /** Prosentti (bp) vai euro (sentit). */
  tyyppi: 'bp' | 'euro';
}

const RIVIT: readonly Rivi[] = [
  { kentta: 'tyelTyontekijaBp', nimi: 'Työntekijän TyEL-maksu', tyyppi: 'bp' },
  {
    kentta: 'tyelTyontekija53_62Bp',
    nimi: 'Työntekijän TyEL-maksu, 53–62-vuotiaat (vain 2025)',
    tyyppi: 'bp',
  },
  { kentta: 'tyelOletusKokonaisBp', nimi: 'TyEL-kokonaismaksu (oletus)', tyyppi: 'bp' },
  {
    kentta: 'tyelTilapainenKokonaisBp',
    nimi: 'TyEL-kokonaismaksu (tilapäinen työnantaja)',
    tyyppi: 'bp',
  },
  { kentta: 'tyelAlarajaKk', nimi: 'TyEL-alaraja (€/kk)', tyyppi: 'euro' },
  { kentta: 'tvrTyontekijaBp', nimi: 'Työntekijän työttömyysvakuutusmaksu', tyyppi: 'bp' },
  { kentta: 'tvrTyonantajaBp', nimi: 'Työnantajan työttömyysvakuutusmaksu', tyyppi: 'bp' },
  {
    kentta: 'tvrOsaomistajaTyontekijaBp',
    nimi: 'Osaomistajan työttömyysvakuutusmaksu (työntekijä)',
    tyyppi: 'bp',
  },
  {
    kentta: 'tvrOsaomistajaTyonantajaBp',
    nimi: 'Osaomistajan työttömyysvakuutusmaksu (työnantaja)',
    tyyppi: 'bp',
  },
  { kentta: 'savaBp', nimi: 'Sairausvakuutusmaksu (sava)', tyyppi: 'bp' },
  { kentta: 'kmKorvaus', nimi: 'Kilometrikorvaus (€/km)', tyyppi: 'euro' },
  { kentta: 'kokopaivaraha', nimi: 'Kokopäiväraha', tyyppi: 'euro' },
  { kentta: 'osapaivaraha', nimi: 'Osapäiväraha', tyyppi: 'euro' },
  { kentta: 'ateriakorvaus', nimi: 'Ateriakorvaus', tyyppi: 'euro' },
  { kentta: 'puhelinetuKk', nimi: 'Puhelinetu (€/kk)', tyyppi: 'euro' },
  { kentta: 'ravintoetu', nimi: 'Ravintoetu (€/ateria)', tyyppi: 'euro' },
  { kentta: 'ravintoetuYlaraja', nimi: 'Ravintoedun yläraja (€/ateria)', tyyppi: 'euro' },
  { kentta: 'eiVerokorttiaBp', nimi: 'Ennakonpidätys ilman verokorttia', tyyppi: 'bp' },
];

const muotoileSumma = (sentit: number) =>
  `${Math.trunc(sentit / 100)},${String(sentit % 100).padStart(2, '0')}`;

/** Syötetty teksti -> bp/sentit, tai null jos virheellinen. */
function jasenna(r: Rivi, teksti: string): number | null {
  if (r.tyyppi === 'bp') return parsiBp(teksti);
  if (!/^\d/.test(teksti.trim())) return null;
  try {
    return Euro.fromString(teksti);
  } catch (e) {
    if (e instanceof EuroParseError) return null;
    throw e;
  }
}

/**
 * Vuoden palkkataulukko: kirjatut arvot lähteineen ja kirjakohtaiset omat arvot ("oma arvo").
 * Oma arvo ohittaa taulukon arvon; tyhjä kenttä poistaa ohituksen.
 */
export function PalkkataulukkoLomake({ vuosi }: { vuosi: number }) {
  const { ohitus, tallennaOhitus, tallentaa, virheet } = usePalkatAsetukset();
  const omat = ohitus[String(vuosi)] ?? {};
  const lahteet = taulukonLahteet(vuosi);
  const [tekstit, setTekstit] = useState<Partial<Record<TaulukkoKentta, string>>>(() =>
    Object.fromEntries(
      RIVIT.flatMap((r) => {
        const arvo = omat[r.kentta];
        return arvo === undefined
          ? []
          : [[r.kentta, r.tyyppi === 'bp' ? muotoileBp(arvo) : muotoileSumma(arvo)]];
      }),
    ),
  );
  const [virhe, setVirhe] = useState<string | null>(null);
  const [tallennettu, setTallennettu] = useState(false);

  async function laheta() {
    setTallennettu(false);
    setVirhe(null);
    const arvot: Partial<Record<TaulukkoKentta, number | undefined>> = {};
    for (const r of RIVIT) {
      const teksti = (tekstit[r.kentta] ?? '').trim();
      if (teksti === '') {
        arvot[r.kentta] = undefined;
        continue;
      }
      const luku = jasenna(r, teksti);
      if (luku === null) {
        setVirhe(`Tarkista oma arvo: ${r.nimi}`);
        return;
      }
      arvot[r.kentta] = luku;
    }
    try {
      await tallennaOhitus(vuosi, arvot);
      setTallennettu(true);
    } catch (e) {
      setVirhe(e instanceof Error ? e.message : 'Tallennus epäonnistui.');
    }
  }

  return (
    <section aria-label="palkkataulukko" className="flex max-w-3xl flex-col gap-3">
      <h2 className="text-[15px] font-[650]">Palkkataulukko {vuosi}</h2>
      <p className="text-[12.5px] text-[var(--text-muted)]">
        Vuoden prosentit ja verovapaat korvaukset lähteineen. Jos arvo puuttuu tai haluat käyttää
        toista, anna oma arvo: se ohittaa taulukon arvon tässä kirjassa.
      </p>
      {virheet.ohitus && (
        <p role="alert" className={VIRHE_LUOKKA}>
          {virheet.ohitus}
        </p>
      )}
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {['Arvo', 'Taulukossa', 'Lähde', 'Oma arvo'].map((o) => (
              <th
                key={o}
                className="px-[8px] pb-[7px] text-left text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]"
              >
                {o}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RIVIT.map((r) => {
            const haku = haeTaulukko(vuosi, undefined, [r.kentta]);
            const taulukossa = haku.ok
              ? (haku.taulukko[r.kentta] as number | undefined)
              : undefined;
            const lahde = lahteet[r.kentta];
            return (
              <tr key={r.kentta} className="border-t border-[var(--border)]">
                <td className="px-[8px] py-[5px]">{r.nimi}</td>
                <td className="px-[8px] py-[5px] tabular-nums">
                  {taulukossa === undefined ? (
                    <span className="text-[var(--text-subtle)]">Ei vielä vahvistettu</span>
                  ) : r.tyyppi === 'bp' ? (
                    `${muotoileBp(taulukossa)} %`
                  ) : (
                    muotoileEuro(Euro.fromCents(taulukossa))
                  )}
                </td>
                <td className="px-[8px] py-[5px]">
                  {lahde ? (
                    <a
                      href={lahde}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent)] underline"
                    >
                      Lähde
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-[8px] py-[3px]">
                  <input
                    aria-label={`Oma arvo: ${r.nimi}`}
                    inputMode="decimal"
                    value={tekstit[r.kentta] ?? ''}
                    placeholder={r.tyyppi === 'bp' ? '%' : '€'}
                    onChange={(e) => setTekstit({ ...tekstit, [r.kentta]: e.target.value })}
                    className={`${KENTTA_LUOKKA} w-[110px] text-right tabular-nums`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {virhe && (
        <p role="alert" className={VIRHE_LUOKKA}>
          {virhe}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button disabled={tallentaa || virheet.ohitus !== undefined} onClick={laheta}>
          Tallenna taulukon omat arvot
        </Button>
        {tallennettu && (
          <output className="text-[12.5px] text-[var(--text-muted)]">Tallennettu</output>
        )}
      </div>
    </section>
  );
}
