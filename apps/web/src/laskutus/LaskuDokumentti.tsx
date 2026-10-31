import type { LaskuMalli } from '@penni/lasku-pdf';
import { Link } from '@tanstack/react-router';
import { toDataURL } from 'qrcode';
import { useEffect, useState } from 'react';

const RIVI_LUOKKA = 'flex justify-between gap-8';

/** SEPA-QR-payload <img>-kuvaksi qrcode-paketilla (async API → effect + tila).
 *  EPC-QR vaatii virheenkorjaustason M. jsdom-testeissä canvas puuttuu → catch pitää
 *  komponentin tyhjänä; kuva varmistetaan selaimessa (spec §9 ei väitä QR-kuvaa). */
function SepaQrKuva({ data }: { data: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let voimassa = true;
    toDataURL(data, { errorCorrectionLevel: 'M', margin: 0, width: 130 })
      .then((u) => {
        if (voimassa) setUrl(u);
      })
      .catch(() => {
        if (voimassa) setUrl('');
      });
    return () => {
      voimassa = false;
    };
  }, [data]);
  if (url === '') return null;
  return <img src={url} alt="SEPA-QR-maksukoodi" className="h-[130px] w-[130px]" />;
}

/**
 * Tulostettava laskudokumentti. Renderöi pelkästään LaskuMallin valmiiksi muotoillut
 * merkkijonot (sama malli kuin PDF:ssä) — ei laske rahaa eikä päivämääriä itse, joten
 * näyttö, PDF ja kirjanpito eivät voi näyttää eri lukuja. A4-mittasuhteinen arkki:
 * max-width 794px ≈ 210 mm.
 */
export function LaskuDokumentti({ malli, tositeId }: { malli: LaskuMalli; tositeId: number }) {
  const { maksu } = malli;
  // Rivitön malli (Kitsas-tuotu lasku/hyvityslasku tai puuttuva alkuperäinen) ei kerro laskun
  // sisältöä: tyhjä taulukko ja 0,00 € ristiriitaisivat kirjanpidon kanssa → rivit, summat ja
  // maksuosa korvataan viittauksella tositteeseen, jolla alkuperäinen lasku ja viennit ovat.
  const eiRivejä = malli.rivit.length === 0;
  // Mallilla ei ole erillistä "IBAN puuttuu" -lippua: maksuosan puuttumisen syy luetaan
  // pdfEste-tekstistä (vain maksulaskulle, jolla maksuosa olisi muuten mahdollinen).
  const ibanPuuttuu =
    !eiRivejä &&
    malli.laji === 'lasku' &&
    maksu === null &&
    (malli.pdfEste?.includes('IBAN') ?? false);

  return (
    <article
      aria-label="laskudokumentti"
      className="mx-auto w-full max-w-[794px] border border-[var(--border)] bg-[var(--surface)] p-10 text-[12.5px] print:max-w-none print:border-0 print:p-0"
    >
      {/* Ylätunniste: myyjä ylävasen · asiakas ikkunakuoripositiossa · laskumeta oikealla. */}
      <div className="mb-8 grid grid-cols-[1fr_1fr_230px] gap-6">
        <div>
          {malli.myyja.map((rivi, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: mallin rivit ovat vakaa, read-only lista
            <div key={i} className={i === 0 ? 'font-[650]' : 'whitespace-pre-line'}>
              {rivi}
            </div>
          ))}
        </div>
        <div className="pt-6">
          {malli.ostaja.map((rivi, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: mallin rivit ovat vakaa, read-only lista
            <div key={i} className={i === 0 ? 'font-[650]' : 'whitespace-pre-line'}>
              {rivi}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="mb-1 text-[19px] font-[650]">{malli.otsikko}</h1>
          {malli.info.map((r) => (
            <div key={r.nimike} className={RIVI_LUOKKA}>
              <span className="text-[var(--text-muted)]">{r.nimike}</span>
              <span className="tabular-nums">{r.arvo}</span>
            </div>
          ))}
        </div>
      </div>

      {malli.aihe ? <p className="mb-4 font-[650]">{malli.aihe}</p> : null}

      {eiRivejä ? (
        <p className="my-6 border-y border-[var(--border)] py-4 text-[var(--text-muted)]">
          Laskulla ei ole rivejä — alkuperäinen lasku ja viennit ovat tositteella.{' '}
          <Link
            to="/tositteet/$id"
            params={{ id: String(tositeId) }}
            className="text-[var(--accent)] underline"
          >
            Avaa tosite
          </Link>
        </p>
      ) : (
        <>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Selite', 'Määrä', 'À-hinta', 'Alv %', 'Yhteensä'].map((h, i) => (
                  <th
                    key={h}
                    className={`border-b border-[var(--border-strong)] px-2 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)] ${
                      i === 0 ? 'text-left' : 'text-right'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {malli.rivit.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: mallin rivit ovat vakaa, read-only lista
                <tr key={i} className="border-b border-[var(--border)]">
                  <td className="px-2 py-[6px]">{r.selite}</td>
                  <td className="px-2 py-[6px] text-right tabular-nums">{r.maara}</td>
                  <td className="px-2 py-[6px] text-right tabular-nums">{r.aHinta}</td>
                  <td className="px-2 py-[6px] text-right tabular-nums">{r.alv}</td>
                  <td className="px-2 py-[6px] text-right tabular-nums">{r.yhteensa}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex justify-end">
            <div className="flex w-[280px] flex-col gap-1 tabular-nums">
              {malli.summat.map((s) => (
                <div
                  key={s.nimike}
                  className={`${RIVI_LUOKKA} ${s.vahva ? 'font-[650]' : 'text-[var(--text-muted)]'}`}
                >
                  <span>{s.nimike}</span>
                  <span>{s.arvo}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Maksuosa vain kun malli sisältää sen (maksulasku, eräpäivä, IBAN, positiivinen summa). */}
          {maksu ? (
            <div className="mt-10 border-t border-[var(--border-strong)] pt-4">
              <div className="grid grid-cols-2 gap-x-10 gap-y-2">
                <div className={RIVI_LUOKKA}>
                  <span className="text-[var(--text-muted)]">Saaja</span>
                  <span>{maksu.saaja}</span>
                </div>
                <div className={RIVI_LUOKKA}>
                  <span className="text-[var(--text-muted)]">IBAN</span>
                  <span className="tabular-nums">{maksu.iban}</span>
                </div>
                {maksu.bic !== '' ? (
                  <div className={RIVI_LUOKKA}>
                    <span className="text-[var(--text-muted)]">BIC</span>
                    <span className="tabular-nums">{maksu.bic}</span>
                  </div>
                ) : null}
                <div className={RIVI_LUOKKA}>
                  <span className="text-[var(--text-muted)]">Viitenumero</span>
                  <span className="tabular-nums">{maksu.viite}</span>
                </div>
                <div className={RIVI_LUOKKA}>
                  <span className="text-[var(--text-muted)]">Yhteensä EUR</span>
                  <span className="tabular-nums">{maksu.summa}</span>
                </div>
                <div className={RIVI_LUOKKA}>
                  <span className="text-[var(--text-muted)]">Eräpäivä</span>
                  <span className="tabular-nums">{maksu.erapvm}</span>
                </div>
              </div>
              <div className="mt-4 flex items-end justify-between gap-6">
                {maksu.virtuaaliviivakoodi !== '' ? (
                  <div className="text-[11px] tracking-[0.08em] tabular-nums">
                    {maksu.virtuaaliviivakoodi}
                  </div>
                ) : null}
                {maksu.qr !== '' ? <SepaQrKuva data={maksu.qr} /> : null}
              </div>
            </div>
          ) : null}
        </>
      )}

      {ibanPuuttuu ? (
        <p className="mt-10 border-t border-[var(--border-strong)] pt-4 text-[var(--text-muted)]">
          Lisää IBAN asetuksissa saadaksesi viivakoodin ja QR-koodin
        </p>
      ) : null}

      {malli.alatunniste.length > 0 ? (
        <footer className="mt-10 grid grid-flow-col auto-cols-fr gap-6 border-t border-[var(--border)] pt-3 text-[10.5px] text-[var(--text-muted)]">
          {malli.alatunniste.map((sarake) => (
            <div key={sarake.join('|')}>
              {sarake.map((rivi) => (
                <div key={rivi}>{rivi}</div>
              ))}
            </div>
          ))}
        </footer>
      ) : null}
    </article>
  );
}
