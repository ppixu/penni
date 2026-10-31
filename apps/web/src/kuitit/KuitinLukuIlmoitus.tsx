import { Button } from '@/components/ui/button';
import type { KuitinLukuTila } from './useKuitinLuku.js';

/** Kuitin luvun tila liitepaneelissa: lupakysymys, edistyminen tai syy, miksi lukua ei tehty. */
export function KuitinLukuIlmoitus({
  tila,
  onLupa,
}: {
  tila: KuitinLukuTila;
  onLupa: (kylla: boolean) => void;
}) {
  const teksti = 'text-[12.5px] text-[var(--text-muted)]';
  switch (tila.vaihe) {
    case 'tarvitseeLuvan':
      return (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3 text-[12.5px]">
          <p>
            Lue kuitit tällä koneella? Penni lataa lukumallin (n. 0,85 Gt) kerran. Kuitti ei lähde
            koneelta.
          </p>
          <div className="flex gap-2">
            <Button size="compact" type="button" onClick={() => onLupa(true)}>
              Lataa ja lue
            </Button>
            <Button size="compact" variant="sec" type="button" onClick={() => onLupa(false)}>
              Ei nyt
            </Button>
          </div>
        </div>
      );
    case 'ladataanMallia':
      return (
        <output className={`block ${teksti}`}>
          Ladataan lukumallia… {Math.round(tila.osuus * 100)} %
        </output>
      );
    case 'luetaan':
      return <output className={`block ${teksti}`}>Luetaan kuittia…</output>;
    case 'eiLuettu':
      return (
        <p className={teksti}>
          {tila.syy === 'eiGpu'
            ? 'Tämä laite ei pysty lukemaan kuvakuitteja automaattisesti — täytä tiedot käsin.'
            : 'Kuittia ei saatu luettua — täytä tiedot käsin.'}
        </p>
      );
    default:
      return null;
  }
}
