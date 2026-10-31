import { RaporttiTaulu } from '@/raportit/RaporttiTaulu';
import type { TilinpaatosDoc } from '@penni/engine';
import { muotoilePvm } from '@penni/euro';
import type { ReactNode } from 'react';

/**
 * Tilinpäätösdokumentti: otsikko, tuloslaskelma, tase ja liitetietojen paikka. `liitetiedot` on
 * paikka, johon kutsuja antaa joko muokattavan editorin (tilinpäätössivu) tai pelkän tekstin
 * (esim. arkisto).
 */
export function TilinpaatosDokumentti({
  doc,
  nimi,
  liitetiedot,
}: {
  doc: TilinpaatosDoc;
  nimi: string | undefined;
  liitetiedot: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[18px] font-[650]">Tilinpäätös</h1>
        <p className="text-[13px] text-[var(--text-muted)]">
          {nimi} · {muotoilePvm(doc.tilikausi.alkaa)}–{muotoilePvm(doc.tilikausi.loppuu)}
        </p>
      </div>
      <div>
        <h2 className="mb-2 text-[15px] font-[650]">Tuloslaskelma</h2>
        <RaporttiTaulu rivit={doc.tuloslaskelma} />
      </div>
      <div>
        <h2 className="mb-2 text-[15px] font-[650]">Tase</h2>
        <RaporttiTaulu rivit={doc.tase} />
      </div>
      <div>
        <h2 className="mb-2 text-[15px] font-[650]">Liitetiedot</h2>
        {liitetiedot}
      </div>
    </div>
  );
}
