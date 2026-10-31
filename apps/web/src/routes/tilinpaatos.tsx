import {
  tilinpaatosVirheViesti,
  useAvaaTilikausi,
  useInit,
  usePaataTilikausi,
  usePeruVahvistus,
  useTilinpaatos,
  useVahvistaTilinpaatos,
} from '@/app/kysely';
import { ArkistoiNappi } from '@/arkisto/ArkistoiNappi';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { useValittuTilikausi } from '@/tilikausi/valittuTilikausi';
import { LiitetiedotEditori } from '@/tilinpaatos/LiitetiedotEditori';
import { TilinpaatosDokumentti } from '@/tilinpaatos/TilinpaatosDokumentti';
import { tilinpaatosTila } from '@/tilinpaatos/tilinpaatosTila';
import type { TilinpaatosDoc, TilinpaatosMuoto } from '@penni/engine';
import { muotoilePvm } from '@penni/euro';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/tilinpaatos')({ component: Tilinpaatos });

function onkoMuoto(x: string): x is TilinpaatosMuoto {
  return x === 'yleinen' || x === 'pien' || x === 'mikro';
}

function Tilinpaatos() {
  const { data: init } = useInit();
  const [liiteDirty, setLiiteDirty] = useState(false);

  // Kausi tulee sivupalkin tilikausivalinnasta (tilikausi/valittuTilikausi.ts).
  const { kausi, kaudet } = useValittuTilikausi();
  const alkaa = kausi?.alkaa ?? '';
  // Yksi muoto: kirjan oma Tilinpaatosmuoto (Kitsaksesta tuotu), muuten yleinen. Erillistä
  // valitsinta ei ole — pien- ja mikromuodot ovat yleisen tiivistelmiä.
  const muoto: TilinpaatosMuoto =
    init && onkoMuoto(init.asetukset.Tilinpaatosmuoto ?? '')
      ? (init.asetukset.Tilinpaatosmuoto as TilinpaatosMuoto)
      : 'yleinen';

  const {
    data: doc,
    isError: docVirhe,
    error: docError,
  } = useTilinpaatos({ alkaa, muoto }, Boolean(alkaa));
  const { lukitse, virheviesti: lukitseVirhe, lukitsee } = usePaataTilikausi();
  const { avaa, virheviesti: avaaVirhe, avataan } = useAvaaTilikausi();
  const { vahvista, virheviesti: vahvistaVirhe, vahvistaa } = useVahvistaTilinpaatos();
  const { peru, virheviesti: peruVirhe, peruu } = usePeruVahvistus();

  if (!init) {
    return <p className="px-[22px] py-5 text-[var(--text-muted)]">Ladataan…</p>;
  }
  if (kaudet.length === 0) {
    return (
      <>
        <TopBar otsikko="Tilinpäätös" />
        <p className="px-[22px] py-5 text-[var(--text-muted)]">Ei tilikausia.</p>
      </>
    );
  }

  const kesken = lukitsee || avataan || vahvistaa || peruu;
  const virhe = lukitseVirhe ?? avaaVirhe ?? vahvistaVirhe ?? peruVirhe;

  return (
    <>
      <TopBar
        otsikko="Tilinpäätös"
        toiminnot={
          <Button size="compact" variant="sec" type="button" onClick={() => window.print()}>
            Tulosta
          </Button>
        }
      />
      <section aria-label="tilinpäätös" className="flex-1 overflow-auto px-[22px] py-5">
        {docVirhe ? (
          <p className="text-[12.5px] text-[var(--danger)]">{tilinpaatosVirheViesti(docError)}</p>
        ) : !doc ? (
          <p className="px-0 py-2 text-[var(--text-muted)]">Ladataan…</p>
        ) : (
          <TilinpaatosSisalto
            doc={doc}
            nimi={init.asetukset.Nimi}
            tilitPaatetty={init.asetukset.TilitPaatetty ?? null}
            kesken={kesken}
            virhe={virhe}
            liiteDirty={liiteDirty}
            onLiiteDirty={setLiiteDirty}
            onLukitse={() => void lukitse(alkaa)}
            onVahvista={() => void vahvista({ alkaa })}
            onAvaa={() => void avaa(alkaa)}
            onPeru={() => void peru({ alkaa })}
          />
        )}
      </section>
    </>
  );
}

/** Banneri + toimintopalkki + kaavat + liitetiedot — renderöityy vain kun tilinpäätösdokumentti
 *  on ladattu (kutsuja erottaa "ei vielä dokumenttia" tilasta 'avoin', ks. Tilinpaatos yllä). */
function TilinpaatosSisalto({
  doc,
  nimi,
  tilitPaatetty,
  kesken,
  virhe,
  liiteDirty,
  onLiiteDirty,
  onLukitse,
  onVahvista,
  onAvaa,
  onPeru,
}: {
  doc: TilinpaatosDoc;
  nimi: string | undefined;
  tilitPaatetty: string | null;
  kesken: boolean;
  virhe: string | null;
  liiteDirty: boolean;
  onLiiteDirty: (dirty: boolean) => void;
  onLukitse: () => void;
  onVahvista: () => void;
  onAvaa: () => void;
  onPeru: () => void;
}) {
  const tila = tilinpaatosTila(doc, tilitPaatetty);
  const bannerTeksti =
    tila === 'vahvistettu'
      ? `Tilinpäätös vahvistettu ${muotoilePvm(doc.vahvistettu ?? '')}`
      : tila === 'lukittu'
        ? 'Tilikausi lukittu'
        : 'Tilikausi auki';

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <span data-tila={tila} className="text-[13px] font-semibold">
          {bannerTeksti}
        </span>
        {tila === 'avoin' && (
          <Button type="button" disabled={kesken} onClick={onLukitse}>
            Lukitse tilikausi
          </Button>
        )}
        {tila === 'lukittu' && (
          <>
            <Button type="button" disabled={kesken || liiteDirty} onClick={onVahvista}>
              Vahvista tilinpäätös
            </Button>
            <Button type="button" variant="sec" disabled={kesken} onClick={onAvaa}>
              Avaa tilikausi
            </Button>
            {liiteDirty && (
              <span className="text-[12.5px] text-[var(--text-muted)]">
                Tallenna liitetiedot ennen vahvistusta.
              </span>
            )}
          </>
        )}
        {tila === 'vahvistettu' && (
          <Button type="button" variant="sec" disabled={kesken} onClick={onPeru}>
            Peru vahvistus
          </Button>
        )}
        {tila !== 'avoin' && (
          <ArkistoiNappi
            alkaa={doc.tilikausi.alkaa}
            loppuu={doc.tilikausi.loppuu}
            esto={liiteDirty ? 'Tallenna liitetiedot ennen arkistointia.' : null}
          />
        )}
        {virhe && <span className="text-[12.5px] text-[var(--danger)]">{virhe}</span>}
      </div>

      <TilinpaatosDokumentti
        doc={doc}
        nimi={nimi}
        liitetiedot={
          <LiitetiedotEditori
            key={doc.tilikausi.loppuu}
            loppupvm={doc.tilikausi.loppuu}
            arvo={doc.liitetiedot}
            lukittu={tila === 'vahvistettu'}
            onDirty={onLiiteDirty}
          />
        }
      />
    </>
  );
}
