import { Linkki } from '@/components/Linkki';
import { tositeTunniste } from '@/raportit/kirjaRivit';
import { AlvKoodi, type StoredTosite, type Tili, nimi } from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';

const OTSIKKO = 'px-[10px] pb-[7px] text-[9px] font-semibold uppercase tracking-[0.6px]';

/** Tositteen liite sellaisena kuin se on arkistossa (`liitteet/<tiedosto>`). */
export interface ArkistoLiite {
  nimi: string;
  tyyppi: string;
  /** Tiedostonimi ilman hakemistoa, esim. `2025--00000007_01.pdf`. */
  tiedosto: string;
}

export interface ArkistoTositeSivuProps {
  tosite: StoredTosite;
  tilit: ReadonlyMap<number, Tili>;
  /** Kumppanin id → nimi. */
  kumppanit: ReadonlyMap<number, string>;
  tyyppiNimi: string;
  liitteet: readonly ArkistoLiite[];
  /** Näytetäänkö Alv-sarake (kirjanpito on alv-velvollinen). */
  alv: boolean;
  /** Tositteen `.json`-tiedoston nimi (samassa hakemistossa kuin sivu). */
  jsonTiedosto: string;
}

/** Selaimessa sellaisenaan näytettävä liite: pdf tai kuva (arkistoija.cpp:539, laajennettu kuviin). */
function naytettava(tyyppi: string): boolean {
  return tyyppi === 'application/pdf' || tyyppi.startsWith('image/');
}

/** Viennin alv-sarake: "24 %", "25,5 %" tai tyhjä (arkistoija.cpp:652-680, yksinkertaistettu). */
function alvTeksti(alvKoodi: number, alvProsentti: number): string {
  if (alvKoodi === AlvKoodi.ALV0) return '0 %';
  if (alvProsentti <= 0) return '';
  return `${String(alvProsentti).replace('.', ',')} %`;
}

/**
 * Yhden tositteen arkistosivun runko: liitteet (ensimmäinen pdf/kuva upotettuna), otsikkotiedot,
 * viennit summariveineen ja laskukentät (arkistoija.cpp:523-745). Ei skriptejä: liitteen vaihto
 * tapahtuu `target="liite"` -linkeillä nimettyyn iframeen.
 */
export function ArkistoTositeSivu({
  tosite,
  tilit,
  kumppanit,
  tyyppiNimi,
  liitteet,
  alv,
  jsonTiedosto,
}: ArkistoTositeSivuProps) {
  const ensimmainen = liitteet.find((l) => naytettava(l.tyyppi));
  const kumppani = tosite.kumppani === undefined ? undefined : kumppanit.get(tosite.kumppani);
  let debet = 0 as Cents;
  let kredit = 0 as Cents;
  for (const v of tosite.viennit) {
    debet = (debet + v.debet) as Cents;
    kredit = (kredit + v.kredit) as Cents;
  }
  const laskukentat: [string, string][] = [];
  if (tosite.numero) laskukentat.push(['Laskun numero', tosite.numero]);
  if (tosite.laskupvm && tosite.laskupvm !== tosite.pvm)
    laskukentat.push(['Laskun päivämäärä', muotoilePvm(tosite.laskupvm)]);
  if (tosite.erapvm) laskukentat.push(['Eräpäivä', muotoilePvm(tosite.erapvm)]);
  if (tosite.viite) laskukentat.push(['Viite', tosite.viite]);

  return (
    <div className="text-[12.5px]">
      {liitteet.length > 0 && (
        <section className="mb-[16px]">
          {ensimmainen && (
            <iframe
              name="liite"
              title="Liite"
              src={`../liitteet/${ensimmainen.tiedosto}`}
              className="mb-[10px] h-[480px] w-full border border-[var(--border)]"
            />
          )}
          <table className="w-full border-collapse" aria-label="Liitteet">
            <tbody>
              {liitteet.map((l) => (
                <tr key={l.tiedosto} className="border-b border-[var(--border-faint)]">
                  <td className="px-[10px] py-[4px]">
                    {naytettava(l.tyyppi) ? (
                      <a
                        href={`../liitteet/${l.tiedosto}`}
                        target="liite"
                        className="text-[var(--accent)] underline"
                      >
                        {l.nimi || l.tiedosto}
                      </a>
                    ) : (
                      l.nimi || l.tiedosto
                    )}
                  </td>
                  <td className="w-[80px] px-[10px] py-[4px] text-right">
                    <a href={`../liitteet/${l.tiedosto}`} className="text-[var(--accent)]">
                      Avaa
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <table className="mb-[16px] w-full border-collapse" aria-label="Tositteen tiedot">
        <tbody>
          <tr>
            <td className="w-[90px] px-[10px] py-[4px] tabular-nums">{muotoilePvm(tosite.pvm)}</td>
            <td className="px-[10px] py-[4px] text-[15px] font-semibold">{tosite.otsikko ?? ''}</td>
            <td className="px-[10px] py-[4px] text-[var(--text-muted)]">{tyyppiNimi}</td>
            <td className="px-[10px] py-[4px] text-right font-semibold">
              {tositeTunniste(tosite)}
            </td>
          </tr>
          {kumppani !== undefined && (
            <tr>
              <td />
              <td className="px-[10px] py-[4px] text-[var(--text-muted)]" colSpan={3}>
                {kumppani}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <table className="w-full border-collapse" aria-label="Viennit">
        <thead>
          <tr className="text-left text-[var(--text-subtle)]">
            <th className={`${OTSIKKO} w-[90px]`}>Pvm</th>
            <th className={OTSIKKO}>Tili</th>
            <th className={OTSIKKO}>Selite</th>
            {alv && <th className={`${OTSIKKO} w-[70px]`}>Alv</th>}
            <th className={`${OTSIKKO} text-right`}>Debet</th>
            <th className={`${OTSIKKO} text-right`}>Kredit</th>
          </tr>
        </thead>
        <tbody>
          {tosite.viennit.map((v, i) => {
            const tili = tilit.get(v.tili);
            return (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: viennit ovat järjestetty, pysyvä lista
                key={i}
                className="border-b border-[var(--border-faint)]"
              >
                <td className="whitespace-nowrap px-[10px] py-[4px] tabular-nums">
                  {muotoilePvm(v.pvm)}
                </td>
                <td className="px-[10px] py-[4px]">
                  <Linkki to="/tilikartta" search={{ nakyma: 'kaikki', tili: v.tili }}>
                    {tili ? `${v.tili} ${nimi(tili)}` : `${v.tili} (tili puuttuu)`}
                  </Linkki>
                </td>
                <td className="px-[10px] py-[4px] text-[var(--text-muted)]">{v.selite ?? ''}</td>
                {alv && (
                  <td className="px-[10px] py-[4px] tabular-nums">
                    {alvTeksti(v.alvKoodi, v.alvProsentti)}
                  </td>
                )}
                <td className="px-[10px] py-[4px] text-right tabular-nums">
                  {v.debet === 0 ? '' : muotoileEuro(v.debet)}
                </td>
                <td className="px-[10px] py-[4px] text-right tabular-nums">
                  {v.kredit === 0 ? '' : muotoileEuro(v.kredit)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--border)] font-semibold">
            <td className="px-[10px] py-[6px]" colSpan={alv ? 4 : 3}>
              Yhteensä
            </td>
            <td className="px-[10px] py-[6px] text-right tabular-nums">{muotoileEuro(debet)}</td>
            <td className="px-[10px] py-[6px] text-right tabular-nums">{muotoileEuro(kredit)}</td>
          </tr>
        </tfoot>
      </table>

      {laskukentat.length > 0 && (
        <table className="mt-[16px] border-collapse" aria-label="Laskun tiedot">
          <tbody>
            {laskukentat.map(([otsikko, arvo]) => (
              <tr key={otsikko}>
                <td className="px-[10px] py-[2px] text-[var(--text-muted)]">{otsikko}</td>
                <td className="px-[10px] py-[2px]">{arvo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-[20px] text-[var(--text-muted)]">
        <a href={jsonTiedosto} className="text-[var(--accent)] underline">
          Tositteen täydet tiedot
        </a>
      </p>
    </div>
  );
}
