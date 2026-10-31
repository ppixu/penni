import { useKpClient } from '@/app/KpClientProvider';
import { Button } from '@/components/ui/button';
import { lataaSelaimeen } from '@/laskutus/lataaLaskuPdf';
import { useState } from 'react';
import { rakennaVienti } from './rakennaVienti';

/** Asetukset-sivun "Vie kirjanpito" -osion sisältö: selitys ja lataus zip-pakettina. */
export function VieKirjanpito() {
  const client = useKpClient();
  const [kesken, setKesken] = useState(false);
  const [virhe, setVirhe] = useState<string | null>(null);

  async function vie() {
    setKesken(true);
    setVirhe(null);
    try {
      const { tiedostonimi, zip } = await rakennaVienti({ client });
      lataaSelaimeen(zip, tiedostonimi, 'application/zip');
    } catch (e) {
      setVirhe(e instanceof Error ? e.message : 'Viennin luonti epäonnistui.');
    } finally {
      setKesken(false);
    }
  }

  return (
    <>
      <p className="text-[12.5px] text-[var(--text-muted)]">
        Lataa koko kirjanpito yhtenä zip-pakettina: avoimet CSV-tiedostot, täydellinen JSON, kaikki
        liitteet ja tarkistesummat. Paketin voi viedä toiseen ohjelmaan tai säilyttää sellaisenaan.
      </p>
      {virhe && <p className="text-[12.5px] text-[var(--danger)]">{virhe}</p>}
      <div>
        <Button variant="sec" type="button" disabled={kesken} onClick={vie}>
          {kesken ? 'Viedään…' : 'Vie kirjanpito'}
        </Button>
      </div>
    </>
  );
}
