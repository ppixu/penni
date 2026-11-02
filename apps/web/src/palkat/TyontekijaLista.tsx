import { Button } from '@/components/ui/button';
import { muotoilePvm } from '@penni/euro';
import { type Tyontekija, syntymapaiva } from '@penni/palkat';

const PERUSTE: Record<Tyontekija['vakuutusperuste'], string> = {
  tyontekija: 'Työntekijä',
  yel: 'YEL',
  osaomistaja: 'Osaomistaja',
};

/**
 * Työntekijälista: nimi ja syntymäaika. Henkilötunnusta ei näytetä listassa, vain sen
 * syntymäpäiväosa.
 */
export function TyontekijaLista({
  tyontekijat,
  onMuokkaa,
  onAktiivisuus,
  kaynnissa,
}: {
  tyontekijat: readonly Tyontekija[];
  onMuokkaa: (t: Tyontekija) => void;
  onAktiivisuus: (t: Tyontekija, aktiivinen: boolean) => void;
  kaynnissa: boolean;
}) {
  return (
    <table className="w-full max-w-[720px] border-collapse text-[12.5px]">
      <thead>
        <tr>
          {['Nimi', 'Syntymäaika', 'Vakuutusperuste', 'Tila', ''].map((otsikko) => (
            <th
              key={otsikko}
              className="px-[10px] pb-[7px] text-left text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]"
            >
              {otsikko}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tyontekijat.map((t) => {
          const synt = syntymapaiva(t.hetu);
          return (
            <tr
              key={t.id}
              className={`border-t border-[var(--border)] hover:bg-[var(--bg-subtle)] ${
                t.aktiivinen ? '' : 'text-[var(--text-subtle)]'
              }`}
            >
              <td className="px-[10px] py-[6px]">{t.nimi}</td>
              <td className="px-[10px] py-[6px] tabular-nums">
                {synt ? `s. ${muotoilePvm(synt)}` : '—'}
              </td>
              <td className="px-[10px] py-[6px]">{PERUSTE[t.vakuutusperuste]}</td>
              <td className="px-[10px] py-[6px]">{t.aktiivinen ? 'Aktiivinen' : 'Ei käytössä'}</td>
              <td className="flex justify-end gap-2 px-[10px] py-[4px]">
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={kaynnissa}
                  aria-label={`${t.aktiivinen ? 'Poista käytöstä' : 'Ota käyttöön'}: ${t.nimi}`}
                  onClick={() => onAktiivisuus(t, !t.aktiivinen)}
                >
                  {t.aktiivinen ? 'Poista käytöstä' : 'Ota käyttöön'}
                </Button>
                <Button
                  variant="sec"
                  size="compact"
                  aria-label={`Muokkaa: ${t.nimi}`}
                  onClick={() => onMuokkaa(t)}
                >
                  Muokkaa
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
