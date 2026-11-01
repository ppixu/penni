import { useKohdennukset, useKohdennusRaportti } from '@/app/kysely';
import { kohdennustenRyhmat } from '@/kohdennukset/kohdennusTeksti';
import { type KohdennusRaporttiParams, YLEINEN_ID, kohdennuksenNimi } from '@penni/engine';
import { useState } from 'react';
import { Lataustila } from './Lataustila';
import { RaporttiTaulu } from './RaporttiTaulu';
import type { RaporttiProps } from './raporttiProps';

const VALITSIN_OTSIKKO =
  'mb-5 flex max-w-xs flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)] print:hidden';
const VALITSIN =
  'rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] normal-case tracking-normal font-normal text-[var(--text)]';

type Laji = KohdennusRaporttiParams['laji'];

/** Kustannuspaikat (Kitsas): tuloslaskelma jokaiselle kustannuspaikalle projekteineen ja Yleiselle. */
export function Kustannuspaikat(props: RaporttiProps) {
  return <KohdennusRaportti {...props} laji="kustannuspaikat" />;
}

/** Projektit (Kitsas): tuloslaskelma projekteittain, valinnaisesti yhden kustannuspaikan alta. */
export function Projektit(props: RaporttiProps) {
  return <KohdennusRaportti {...props} laji="projektit" />;
}

/**
 * Tuloslaskelma kohdennuksittain: osio otsikkoineen per kohdennus, jolla on kauden aikana
 * kirjauksia (moottori jättää nollaosiot pois ja järjestää ne polun mukaan).
 */
function KohdennusRaportti({ alkupvm, loppupvm, muoto, laji }: RaporttiProps & { laji: Laji }) {
  const { data: kohdennukset } = useKohdennukset();
  // Projektit: undefined = kaikki, 0 = Yleisen alla olevat, muuten kustannuspaikan projektit.
  const [kustannuspaikka, setKustannuspaikka] = useState<number | undefined>();
  const params: KohdennusRaporttiParams = {
    muoto: muoto ?? '',
    alkupvm,
    pvm: loppupvm,
    laji,
    ...(laji === 'projektit' && kustannuspaikka !== undefined ? { kustannuspaikka } : {}),
  };
  const { data: osiot, isError } = useKohdennusRaportti(params, Boolean(muoto));

  const kustannuspaikat = kohdennustenRyhmat(kohdennukset ?? []).kustannuspaikat.map(
    (r) => r.kustannuspaikka,
  );
  const valittu = kustannuspaikat.find((k) => k.id === kustannuspaikka);
  const rajauksenNimi =
    kustannuspaikka === YLEINEN_ID ? 'Yleinen' : valittu ? kohdennuksenNimi(valittu) : undefined;

  if (!muoto) {
    return (
      <p className="text-[13px] text-[var(--text-muted)]">Raporttikaavaa ei ole määritetty.</p>
    );
  }
  return (
    <>
      {laji === 'projektit' && kustannuspaikat.length > 0 && (
        <>
          <label className={VALITSIN_OTSIKKO}>
            Kustannuspaikka
            <select
              aria-label="Kustannuspaikka"
              value={kustannuspaikka ?? ''}
              onChange={(e) =>
                setKustannuspaikka(e.target.value === '' ? undefined : Number(e.target.value))
              }
              className={VALITSIN}
            >
              <option value="">Kaikki</option>
              <option value={YLEINEN_ID}>Yleinen</option>
              {kustannuspaikat.map((k) => (
                <option key={k.id} value={k.id}>
                  {kohdennuksenNimi(k)}
                </option>
              ))}
            </select>
          </label>
          {rajauksenNimi && (
            <p className="mb-4 hidden text-[13px] print:block">Kustannuspaikka: {rajauksenNimi}</p>
          )}
        </>
      )}
      {!osiot ? (
        <Lataustila virhe={isError} />
      ) : osiot.length === 0 ? (
        <p className="text-[13px] text-[var(--text-muted)]">
          {laji === 'kustannuspaikat'
            ? 'Tällä kaudella ei ole tuloslaskelman kirjauksia.'
            : 'Projekteilla ei ole kirjauksia tällä kaudella.'}
        </p>
      ) : (
        osiot.map((o) => (
          <section
            key={o.kohdennus.id}
            aria-label={o.kohdennus.polku}
            className="mb-8 break-inside-avoid"
          >
            <h2 className="mb-2 break-after-avoid text-[14px] font-semibold">
              {o.kohdennus.polku}
            </h2>
            <RaporttiTaulu rivit={o.rivit} />
          </section>
        ))
      )}
    </>
  );
}
