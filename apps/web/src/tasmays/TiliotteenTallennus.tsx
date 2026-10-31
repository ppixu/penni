import { useKpClient } from '@/app/KpClientProvider';
import { useTallennaLiite, useTositteet } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { laskeSha } from '@/liitteet/laskeSha';
import { tilioteTiedoiksi, tiliotteenOtsikko } from '@/tiliote/tiliotetiedot';
import { TositeTila, TositeTyyppi } from '@penni/engine';
import type { TasmaysAineisto } from '@penni/luku';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { siivoaIpcVirhe } from './ipcVirhe.js';
import { annaTasmaysSilta } from './silta.js';

/**
 * Tallentaa luetun kuukausitiliotteen Tiliote-tositteeksi: kausi, pankkitili ja pankin saldot
 * tositteen tiliote-tietoihin ja PDF liitteeksi. Sama tili ja kausi tallennetaan vain kerran —
 * jo tallennetusta näytetään linkki.
 */
export function TiliotteenTallennus({
  tiliote,
  pankkitili,
}: {
  tiliote: TasmaysAineisto['tiliote'];
  pankkitili: number;
}) {
  const client = useKpClient();
  const qc = useQueryClient();
  const { tallenna: tallennaLiite } = useTallennaLiite();
  const tiedot = tilioteTiedoiksi(tiliote, pankkitili);
  const { data: tiliotteet } = useTositteet({ tyyppi: TositeTyyppi.TILIOTE }, tiedot !== null);
  const [tallentaa, setTallentaa] = useState(false);
  const [virhe, setVirhe] = useState<string | null>(null);
  if (!tiedot) return null;

  const olemassa = tiliotteet?.find(
    (t) =>
      t.tiliote?.tili === tiedot.tili &&
      t.tiliote.alkupvm === tiedot.alkupvm &&
      t.tiliote.loppupvm === tiedot.loppupvm,
  );

  async function tallenna() {
    if (!tiedot) return;
    setTallentaa(true);
    setVirhe(null);
    try {
      const tosite = await client.luoTosite({
        pvm: tiedot.loppupvm,
        tyyppi: TositeTyyppi.TILIOTE,
        tila: TositeTila.KIRJANPIDOSSA,
        sarja: '',
        otsikko: tiliotteenOtsikko(tiedot),
        viennit: [],
        tiliote: tiedot,
      });
      const data = await annaTasmaysSilta().lueTiedosto(tiliote.tiedosto);
      await tallennaLiite({
        tosite: tosite.id,
        nimi: tiliote.tiedosto.split('/').pop() ?? 'tiliote.pdf',
        tyyppi: 'application/pdf',
        sha: await laskeSha(data),
        luotu: new Date().toISOString(),
        data,
      });
    } catch (e) {
      setVirhe(siivoaIpcVirhe(e instanceof Error ? e.message : String(e)));
    } finally {
      setTallentaa(false);
      void qc.invalidateQueries({ queryKey: ['tositteet'] });
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-[22px] py-2 text-[12.5px]">
      {olemassa ? (
        <span className="text-[var(--text-muted)]">
          Tiliote on tallennettu tositteeksi{' '}
          <Link
            to="/tositteet/$id"
            params={{ id: String(olemassa.id) }}
            className="text-[var(--accent)] hover:underline"
          >
            {olemassa.otsikko ?? 'Tiliote'}
          </Link>
        </span>
      ) : (
        <Button
          type="button"
          variant="sec"
          size="compact"
          disabled={tallentaa || tiliotteet === undefined}
          onClick={() => void tallenna()}
        >
          {tallentaa ? 'Tallennetaan…' : 'Tallenna tiliote tositteeksi'}
        </Button>
      )}
      {virhe && <span className="text-[var(--danger)]">{virhe}</span>}
    </div>
  );
}
