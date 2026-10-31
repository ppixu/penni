import { useTallennaLiitetiedot } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

const KENTTA_LUOKKA =
  'w-full max-w-2xl rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]';

/**
 * Liitetietojen vapaatekstieditori. Paikallinen tila alustetaan `arvo`sta mountissa;
 * reitti remounttaa (key={loppuu}) kausivaihdossa, joten tallennuksen refetch ei pyyhi
 * kesken olevaa tekstiä. Vahvistettuna (lukittu) vain luku — moottori torjuu JOVAHVISTETTU.
 * `onDirty` ilmoittaa reitille kesken olevasta muokkauksesta, jotta vahvistusta ei tehdä
 * tallentamattoman luonnoksen ollessa voimassa.
 */
export function LiitetiedotEditori({
  loppupvm,
  arvo,
  lukittu,
  onDirty,
}: {
  loppupvm: string;
  arvo: string;
  lukittu: boolean;
  onDirty?: (dirty: boolean) => void;
}) {
  const { tallenna, virheviesti, tallentaa } = useTallennaLiitetiedot();
  const [teksti, setTeksti] = useState(arvo);

  useEffect(() => {
    onDirty?.(teksti !== arvo);
  }, [teksti, arvo, onDirty]);

  if (lukittu) {
    return (
      <>
        <textarea
          aria-label="Liitetiedot"
          readOnly
          value={arvo}
          rows={6}
          className={`${KENTTA_LUOKKA} print:hidden`}
        />
        <div className="hidden whitespace-pre-wrap text-[13px] print:block">{arvo}</div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label="Liitetiedot"
        value={teksti}
        onChange={(e) => setTeksti(e.target.value)}
        rows={6}
        className={`${KENTTA_LUOKKA} print:hidden`}
      />
      <div className="hidden whitespace-pre-wrap text-[13px] print:block">{teksti}</div>
      {virheviesti && <p className="text-[12.5px] text-[var(--danger)]">{virheviesti}</p>}
      <div className="print:hidden">
        <Button
          type="button"
          disabled={tallentaa}
          onClick={() => void tallenna({ loppupvm, teksti })}
        >
          Tallenna liitetiedot
        </Button>
      </div>
    </div>
  );
}
