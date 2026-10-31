import {
  type Kuitti,
  jasennaKuitti,
  poimiKuittiTekstista,
  rakennaKuittiKehote,
  tasmaa,
} from '@penni/engine';
import { Euro } from '@penni/euro';
import { useState } from 'react';
import type { Paattelija } from './paattely.js';
import { luePdfTeksti } from './pdf.js';

type Tila = 'alku' | 'lataa' | 'valmis' | 'eiWebgpu' | 'tulkitsee';

/**
 * Kuittiskannerin arviointiharness: kuva → näkömalli TAI digitaalinen PDF → pdf.js-tekstikerros
 * + pieni tekstimalli. Molemmista poimitaan jäsennetty Kuitti ja näytetään täsmäytys.
 */
export function KuittiArviointi({ paattelija }: { paattelija: Paattelija }) {
  // Näkömalli (kuvapolku).
  const [tila, setTila] = useState<Tila>('alku');
  const [edistyi, setEdistyi] = useState(0);
  // Tekstimalli (PDF-polku) — oma lataustila ja edistyminen.
  const [tekstiTila, setTekstiTila] = useState<Tila>('alku');
  const [tekstiEdistyi, setTekstiEdistyi] = useState(0);

  const [tiedosto, setTiedosto] = useState<Blob | undefined>(undefined);
  const [pdfTeksti, setPdfTeksti] = useState<string | undefined>(undefined);
  const [raaka, setRaaka] = useState<string | undefined>(undefined);
  const [kuitti, setKuitti] = useState<Kuitti | undefined>(undefined);
  const [virhe, setVirhe] = useState<string | undefined>(undefined);
  const [kestoMs, setKestoMs] = useState<number | undefined>(undefined);
  // Deterministinen PDF-polku (ei mallia): oma varattu-tila.
  const [ilmanMallia, setIlmanMallia] = useState(false);

  async function lataaMalli() {
    setTila('lataa');
    setVirhe(undefined);
    try {
      if (!(await paattelija.saatavilla())) {
        setTila('eiWebgpu');
        return;
      }
      await paattelija.lataa(setEdistyi);
      setTila('valmis');
    } catch (err) {
      const syy = err instanceof Error ? err.message : String(err);
      setVirhe(`Mallin lataus epäonnistui: ${syy}`);
      setTila('alku');
    }
  }

  async function lataaTekstiMalli() {
    setTekstiTila('lataa');
    setVirhe(undefined);
    try {
      if (!(await paattelija.saatavilla())) {
        setTekstiTila('eiWebgpu');
        return;
      }
      await paattelija.lataaTeksti(setTekstiEdistyi);
      setTekstiTila('valmis');
    } catch (err) {
      const syy = err instanceof Error ? err.message : String(err);
      setVirhe(`Tekstimallin lataus epäonnistui: ${syy}`);
      setTekstiTila('alku');
    }
  }

  function valitseTiedosto(e: React.ChangeEvent<HTMLInputElement>) {
    const valittu = e.target.files?.[0];
    setTiedosto(valittu ?? undefined);
    setPdfTeksti(undefined);
    setRaaka(undefined);
    setKuitti(undefined);
    setVirhe(undefined);
    setKestoMs(undefined);
  }

  /** Jäsentää mallin raakatekstin Kuitiksi ja päivittää tilan (yhteinen molemmille poluille). */
  function kasitteleVastaus(teksti: string) {
    const t = jasennaKuitti(teksti);
    if (t.ok) {
      setKuitti(t.kuitti);
    } else {
      setKuitti(undefined);
      setVirhe(t.virhe);
    }
  }

  async function tulkitseKuva(kuva: Blob) {
    setTila('tulkitsee');
    const alkoi = performance.now();
    try {
      const teksti = await paattelija.tulkitse(kuva, rakennaKuittiKehote());
      setKestoMs(Math.round(performance.now() - alkoi));
      setRaaka(teksti);
      kasitteleVastaus(teksti);
    } catch (err) {
      const syy = err instanceof Error ? err.message : String(err);
      setVirhe(`Tulkinta epäonnistui: ${syy}`);
    } finally {
      setTila('valmis');
    }
  }

  async function tulkitsePdf(pdf: Blob) {
    setTekstiTila('tulkitsee');
    const alkoi = performance.now();
    try {
      const teksti = await luePdfTeksti(pdf);
      setPdfTeksti(teksti);
      const vastaus = await paattelija.tulkitseTeksti(teksti);
      setKestoMs(Math.round(performance.now() - alkoi));
      setRaaka(vastaus);
      kasitteleVastaus(vastaus);
    } catch (err) {
      const syy = err instanceof Error ? err.message : String(err);
      setVirhe(`Tulkinta epäonnistui: ${syy}`);
    } finally {
      setTekstiTila('valmis');
    }
  }

  async function tulkitse() {
    if (!tiedosto) return;
    setVirhe(undefined);
    if (tiedosto.type === 'application/pdf') {
      await tulkitsePdf(tiedosto);
    } else {
      await tulkitseKuva(tiedosto);
    }
  }

  /** PDF-polku ilman mallia: pdf.js-tekstikerros → deterministinen poiminta. Ei OOM-riskiä. */
  async function tulkitseIlmanMallia() {
    if (!tiedosto) return;
    setVirhe(undefined);
    setIlmanMallia(true);
    const alkoi = performance.now();
    try {
      const teksti = await luePdfTeksti(tiedosto);
      setPdfTeksti(teksti);
      setRaaka(teksti);
      const t = poimiKuittiTekstista(teksti);
      setKestoMs(Math.round(performance.now() - alkoi));
      if (t.ok) {
        setKuitti(t.kuitti);
      } else {
        setKuitti(undefined);
        setVirhe(t.virhe);
      }
    } catch (err) {
      const syy = err instanceof Error ? err.message : String(err);
      setVirhe(`Tulkinta epäonnistui: ${syy}`);
    } finally {
      setIlmanMallia(false);
    }
  }

  const onPdf = tiedosto?.type === 'application/pdf';
  const kasitteleeJotain = tila === 'tulkitsee' || tekstiTila === 'tulkitsee' || ilmanMallia;
  const voiTulkita =
    tiedosto !== undefined &&
    !kasitteleeJotain &&
    (onPdf ? tekstiTila === 'valmis' : tila === 'valmis');

  const ts = kuitti ? tasmaa(kuitti) : undefined;

  return (
    <section aria-label="kuittien arviointi" className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Kuittiskannerin arviointi</h1>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void lataaMalli()}
          disabled={tila === 'lataa' || tila === 'valmis' || tila === 'tulkitsee'}
          className="rounded border px-3 py-1"
        >
          Lataa malli
        </button>
        {tila === 'lataa' ? <span>Ladataan… {Math.round(edistyi * 100)} %</span> : null}
      </div>

      {tila === 'eiWebgpu' ? (
        <p role="alert" className="text-[var(--danger)]">
          WebGPU ei ole käytettävissä tässä selaimessa. Kuittiskanneri vaatii WebGPU-tuen.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void lataaTekstiMalli()}
          disabled={tekstiTila === 'lataa' || tekstiTila === 'valmis' || tekstiTila === 'tulkitsee'}
          className="rounded border px-3 py-1"
        >
          Lataa tekstimalli
        </button>
        {tekstiTila === 'lataa' ? <span>Ladataan… {Math.round(tekstiEdistyi * 100)} %</span> : null}
      </div>

      {tekstiTila === 'eiWebgpu' ? (
        <p role="alert" className="text-[var(--danger)]">
          WebGPU ei ole käytettävissä tässä selaimessa. Tekstimalli vaatii WebGPU-tuen.
        </p>
      ) : null}

      <label className="flex flex-col gap-1">
        Kuittikuva tai PDF-lasku
        <input type="file" accept="image/*,application/pdf" onChange={valitseTiedosto} />
      </label>

      {onPdf && tekstiTila !== 'valmis' ? (
        <p className="text-xs text-gray-500">
          PDF-tiedoston tulkinta vaatii tekstimallin — lataa se ensin yllä olevalla painikkeella.
        </p>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => void tulkitse()}
          disabled={!voiTulkita}
          className="w-fit rounded border px-3 py-1"
        >
          Tulkitse
        </button>
        {onPdf ? (
          <button
            type="button"
            onClick={() => void tulkitseIlmanMallia()}
            disabled={!tiedosto || kasitteleeJotain}
            className="w-fit rounded border px-3 py-1"
          >
            Tulkitse ilman mallia
          </button>
        ) : null}
      </div>

      {virhe ? (
        <p role="alert" className="text-[var(--danger)]">
          {virhe}
        </p>
      ) : null}

      {pdfTeksti !== undefined ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Poimittu PDF-teksti</span>
          <pre className="overflow-x-auto rounded bg-gray-100 p-2 text-xs">{pdfTeksti}</pre>
        </div>
      ) : null}

      {kuitti ? (
        <table className="w-fit border-collapse text-sm">
          <tbody>
            <tr>
              <th className="pr-3 text-left">Myyjä</th>
              <td>{kuitti.myyja ?? '—'}</td>
            </tr>
            <tr>
              <th className="pr-3 text-left">Y-tunnus</th>
              <td>{kuitti.ytunnus ?? '—'}</td>
            </tr>
            <tr>
              <th className="pr-3 text-left">Päivä</th>
              <td>{kuitti.pvm ?? '—'}</td>
            </tr>
            <tr>
              <th className="pr-3 text-left">Brutto</th>
              <td>{kuitti.bruttoSumma !== undefined ? Euro.toString(kuitti.bruttoSumma) : '—'}</td>
            </tr>
            {kuitti.alv.map((e, i) => (
              <tr key={`${e.kanta}-${i}`}>
                <th className="pr-3 text-left">ALV {e.kanta} %</th>
                <td>
                  netto {e.netto !== undefined ? Euro.toString(e.netto) : '—'} · vero{' '}
                  {e.vero !== undefined ? Euro.toString(e.vero) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {ts ? (
        <p>
          Täsmäytys: {ts.tasmaa ? 'täsmää ✓' : `ei täsmää (erotus ${ts.erotusSnt} snt)`} · kannat{' '}
          {kuitti?.alv.length === 0 ? 'ei erittelyä' : ts.kannatKelpo ? 'ok' : 'tuntematon kanta'}
          {ts.puutteita ? ' · puutteellinen' : ''}
        </p>
      ) : null}

      {kestoMs !== undefined ? <p className="text-xs text-gray-500">Kesto {kestoMs} ms</p> : null}

      {raaka ? (
        <pre className="overflow-x-auto rounded bg-gray-100 p-2 text-xs">{raaka}</pre>
      ) : null}
    </section>
  );
}
