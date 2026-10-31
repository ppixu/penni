import type { Alkupera } from '@penni/engine';
import { FileX, Paperclip } from 'lucide-react';

/**
 * Kuittimerkki listariville: paperiliitin kun tositteella on liite, varoitusvärinen
 * "ei kuittia" -kuvake kun ei ole. Pelkkä kuvake — teksti vain saavutettavana nimenä/tooltipina.
 */
export function LiiteMerkki({ liitteita }: { liitteita: number }) {
  const nimi =
    liitteita === 0 ? 'Ei kuittia' : liitteita === 1 ? '1 liite' : `${liitteita} liitettä`;
  return (
    <span
      role="img"
      aria-label={nimi}
      title={nimi}
      data-liitteita={liitteita}
      className={`inline-flex ${liitteita === 0 ? 'text-[var(--warning)]' : 'text-[var(--text-subtle)]'}`}
    >
      {liitteita === 0 ? (
        <FileX aria-hidden size={14} strokeWidth={2} />
      ) : (
        <Paperclip aria-hidden size={14} strokeWidth={2} />
      )}
    </span>
  );
}

const LIPPU: Record<Alkupera, { merkki: string; nimi: string }> = {
  kotimaa: { merkki: '🇫🇮', nimi: 'Kotimaa' },
  eu: { merkki: '🇪🇺', nimi: 'EU' },
  muu: { merkki: '🌍', nimi: 'EU:n ulkopuolelta' },
};

/** Oston/myynnin alkuperä lippuna (engine tositteenAlkupera); tuntematon → ei mitään. */
export function AlkuperaLippu({ alkupera }: { alkupera: Alkupera | undefined }) {
  if (alkupera === undefined) return null;
  const { merkki, nimi } = LIPPU[alkupera];
  return (
    <span role="img" aria-label={nimi} title={nimi} className="text-[13px] leading-none">
      {merkki}
    </span>
  );
}
