import { useKpClient } from '@/app/KpClientProvider';
import { useInit, usePaivitaAsetukset } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { lataaSelaimeen } from '@/laskutus/lataaLaskuPdf';
import type { IsoDate } from '@penni/engine';
import { muotoilePvm } from '@penni/euro';
import { useState } from 'react';
import { arkistoKirjauksenAvain, lueKirjaus, paikallinenPaiva } from './arkistoKirjaus';
import { rakennaArkisto } from './rakennaArkisto';

/** Tilinpäätössivun "Arkistoi": rakentaa lukitun kauden sähköisen arkiston, lataa sen zip-
 *  pakettina ja kirjaa arkistointipäivän ja juuritiivisteen asetuksiin (Kitsas tarjoaa tätä
 *  heti lukituksen jälkeen, tilinpaattaja.cpp:148-154). */
export function ArkistoiNappi({
  alkaa,
  loppuu,
  esto = null,
}: {
  alkaa: IsoDate;
  loppuu: IsoDate;
  /** Syy, miksi arkistointi ei juuri nyt onnistu (esim. tallentamattomat liitetiedot); nappi pois päältä ja syy näkyviin. */
  esto?: string | null;
}) {
  const client = useKpClient();
  const { data: init } = useInit();
  const { tallenna } = usePaivitaAsetukset();
  const [edistys, setEdistys] = useState<{ valmis: number; yhteensa: number } | null>(null);
  const [virhe, setVirhe] = useState<string | null>(null);
  const kesken = edistys !== null;

  const avain = arkistoKirjauksenAvain(loppuu);
  const kirjaus = lueKirjaus(init?.asetukset[avain]);

  async function arkistoi() {
    setVirhe(null);
    setEdistys({ valmis: 0, yhteensa: 0 });
    try {
      const tulos = await rakennaArkisto({
        client,
        alkaa,
        versio: import.meta.env.VITE_PENNI_VERSIO ?? '0.0.0',
        onEdistys: (valmis, yhteensa) => setEdistys({ valmis, yhteensa }),
      });
      lataaSelaimeen(tulos.zip, tulos.tiedostonimi, 'application/zip');
      // Kirjauksen epäonnistuminen ei kaada latausta; usePaivitaAsetukset nielee virheen.
      await tallenna({
        [avain]: JSON.stringify({ aika: tulos.luotu, tiiviste: tulos.juuriTiiviste }),
      });
    } catch (e) {
      setVirhe(e instanceof Error ? e.message : 'Arkiston luonti epäonnistui.');
    } finally {
      setEdistys(null);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="sec"
        disabled={kesken || esto !== null}
        onClick={() => void arkistoi()}
      >
        {edistys ? `Arkistoidaan… ${edistys.valmis}/${edistys.yhteensa}` : 'Arkistoi'}
      </Button>
      {esto !== null && <span className="text-[12.5px] text-[var(--text-muted)]">{esto}</span>}
      {kirjaus && (
        <span className="text-[12.5px] text-[var(--text-muted)]">
          {`Arkistoitu ${muotoilePvm(paikallinenPaiva(kirjaus.aika))} · tiiviste ${kirjaus.tiiviste.slice(0, 12)}…`}
        </span>
      )}
      {virhe && <span className="text-[12.5px] text-[var(--danger)]">{virhe}</span>}
    </>
  );
}
