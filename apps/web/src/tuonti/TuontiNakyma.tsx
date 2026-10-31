import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  KitsasYhteenveto,
  TaysmaytysRaportti,
  TuontiEdistyminen,
  TuontiRaportti,
} from '@penni/tuonti';
import { useState } from 'react';
import { annaSilta, onkoTyopoyta } from './silta';

interface Valittu {
  polku: string;
  yhteenveto: KitsasYhteenveto;
}

interface Tulos {
  kohde: string;
  raportti: TuontiRaportti;
  taysmaytys: TaysmaytysRaportti;
}

const VAIHEEN_NIMI: Record<TuontiEdistyminen['vaihe'], string> = {
  tilit: 'Tilikartta',
  tilikaudet: 'Tilikaudet',
  asetukset: 'Asetukset',
  kumppanit: 'Kumppanit',
  tositteet: 'Tositteet',
  liitteet: 'Liitteet',
};

const KORTTI = 'rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4';
const OTSIKKO_2 = 'text-[14px] font-[650] tracking-[-0.2px] text-[var(--text)]';
const SOLU_OTSIKKO = 'text-left font-semibold text-[var(--text-subtle)]';

/** Count-comparison pairs where source and destination disagree — the ones worth showing. */
function eriavatMaarat(maarat: TaysmaytysRaportti['maarat']): [string, [number, number]][] {
  return Object.entries(maarat).filter(([, [kitsas, penni]]) => kitsas !== penni);
}

export function TuontiNakyma(): React.ReactElement {
  const [valittu, setValittu] = useState<Valittu | null>(null);
  const [edistyminen, setEdistyminen] = useState<TuontiEdistyminen | null>(null);
  const [tulos, setTulos] = useState<Tulos | null>(null);
  const [virhe, setVirhe] = useState<string | null>(null);
  const [kesken, setKesken] = useState(false);

  if (!onkoTyopoyta()) {
    return (
      <>
        <TopBar otsikko="Tuo Kitsas-kirjanpito" />
        <section aria-label="tuonti" className="flex-1 overflow-auto px-[22px] py-5">
          <p className="max-w-[560px] text-[13.5px] text-[var(--text-muted)]">
            Kitsas-kirjanpidon tuonti on käytettävissä vain työpöytäsovelluksessa, koska se lukee
            tiedoston suoraan levyltä.
          </p>
        </section>
      </>
    );
  }

  async function valitse(): Promise<void> {
    setVirhe(null);
    setTulos(null);
    try {
      const tulos = await annaSilta().valitseJaLue();
      if (tulos) setValittu(tulos);
    } catch (e) {
      setVirhe((e as Error).message);
    }
  }

  async function tuo(): Promise<void> {
    if (!valittu) return;
    setKesken(true);
    setVirhe(null);
    try {
      const tulos = await annaSilta().tuo(valittu.polku, setEdistyminen);
      if (tulos) setTulos(tulos);
    } catch (e) {
      setVirhe((e as Error).message);
    } finally {
      setKesken(false);
      setEdistyminen(null);
    }
  }

  async function avaa(kohde: string): Promise<void> {
    setVirhe(null);
    try {
      await annaSilta().avaaKirja(kohde);
    } catch (e) {
      setVirhe((e as Error).message);
    }
  }

  const eriavatMaaratLista = tulos ? eriavatMaarat(tulos.taysmaytys.maarat) : [];

  return (
    <>
      <TopBar
        otsikko="Tuo Kitsas-kirjanpito"
        alaotsikko="Kitsas-tiedostosta kirjoitetaan uusi Penni-kirjanpito — lähdetiedostoon ei kosketa."
        toiminnot={
          <Button variant="sec" onClick={() => void valitse()} disabled={kesken}>
            Valitse Kitsas-tiedosto
          </Button>
        }
      />
      <section aria-label="tuonti" className="flex-1 overflow-auto px-[22px] py-5">
        <div className="flex max-w-[640px] flex-col gap-[14px]">
          {virhe && (
            <p
              role="alert"
              className="rounded-[var(--radius-card)] border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-[12.5px] text-[var(--danger)]"
            >
              {virhe}
            </p>
          )}

          {!valittu && !tulos && (
            <p className="text-[13.5px] text-[var(--text-muted)]">
              Aloita valitsemalla <span className="font-mono">.kitsas</span>-tiedosto oikean
              yläkulman painikkeella. Näet ensin yhteenvedon, ja tuonti alkaa vasta kun vahvistat
              sen.
            </p>
          )}

          {valittu && !tulos && (
            <section className={KORTTI}>
              <h2 className={OTSIKKO_2}>{valittu.yhteenveto.nimi}</h2>
              <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-[12.5px]">
                <dt className="text-[var(--text-subtle)]">Tilikaudet</dt>
                <dd>
                  {valittu.yhteenveto.tilikaudet.map((k) => `${k.alkaa} – ${k.loppuu}`).join(', ')}
                </dd>
                <dt className="text-[var(--text-subtle)]">Sisältö</dt>
                <dd>
                  {valittu.yhteenveto.tositteet} tositetta, {valittu.yhteenveto.viennit} vientiä,{' '}
                  {valittu.yhteenveto.tilit} tiliä, {valittu.yhteenveto.liitteet} liitettä
                </dd>
              </dl>
              {Object.keys(valittu.yhteenveto.ohitetut).length > 0 && (
                <p className="mt-3 text-[12px] text-[var(--text-muted)]">
                  Ei tuoda:{' '}
                  {Object.entries(valittu.yhteenveto.ohitetut)
                    .map(([taulu, n]) => `${taulu} (${n})`)
                    .join(', ')}
                </p>
              )}
              <Button className="mt-4" onClick={() => void tuo()} disabled={kesken}>
                Tuo kirjanpito
              </Button>
            </section>
          )}

          {edistyminen && (
            <output className="text-[12.5px] text-[var(--text-muted)]">
              {VAIHEEN_NIMI[edistyminen.vaihe]}: {edistyminen.tehty} / {edistyminen.kaikkiaan}
            </output>
          )}

          {tulos && (
            <section
              className={cn(
                KORTTI,
                !tulos.taysmaytys.tasmaa && 'border-[var(--danger)] bg-[var(--danger-soft)]',
              )}
            >
              <h2 className={cn(OTSIKKO_2, !tulos.taysmaytys.tasmaa && 'text-[var(--danger)]')}>
                {tulos.taysmaytys.tasmaa ? 'Täsmäytys onnistui' : 'Täsmäytys epäonnistui'}
              </h2>
              <p className="mt-2 text-[12.5px] text-[var(--text-muted)]">
                Tuotiin {tulos.raportti.tositteet} tositetta, {tulos.raportti.viennit} vientiä ja{' '}
                {tulos.raportti.liitteet} liitettä tiedostoon {tulos.kohde}.
              </p>

              {!tulos.taysmaytys.tasmaa && tulos.taysmaytys.erot.length > 0 && (
                <table className="mt-3 w-full border-collapse text-[12.5px] tabular-nums">
                  <caption className="sr-only">Tilikohtaiset erot</caption>
                  <thead>
                    <tr>
                      <th className={SOLU_OTSIKKO}>Tilikausi</th>
                      <th className={SOLU_OTSIKKO}>Tili</th>
                      <th className="text-right font-semibold text-[var(--text-subtle)]">Kitsas</th>
                      <th className="text-right font-semibold text-[var(--text-subtle)]">Penni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tulos.taysmaytys.erot.map((ero) => (
                      <tr
                        key={`${ero.tilikausi}-${ero.tili}`}
                        className="border-t border-[var(--border-faint)]"
                      >
                        <td className="py-1.5">{ero.tilikausi}</td>
                        <td className="py-1.5">{ero.tili}</td>
                        <td className="py-1.5 text-right">{ero.kitsas}</td>
                        <td className="py-1.5 text-right">{ero.penni}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {!tulos.taysmaytys.tasmaa && eriavatMaaratLista.length > 0 && (
                <table className="mt-3 w-full border-collapse text-[12.5px] tabular-nums">
                  <caption className="sr-only">Määrät, jotka eivät täsmää</caption>
                  <thead>
                    <tr>
                      <th className={SOLU_OTSIKKO}>Määrä</th>
                      <th className="text-right font-semibold text-[var(--text-subtle)]">Kitsas</th>
                      <th className="text-right font-semibold text-[var(--text-subtle)]">Penni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eriavatMaaratLista.map(([nimike, [kitsas, penni]]) => (
                      <tr key={nimike} className="border-t border-[var(--border-faint)]">
                        <td className="py-1.5">{nimike}</td>
                        <td className="py-1.5 text-right">{kitsas}</td>
                        <td className="py-1.5 text-right">{penni}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {!tulos.taysmaytys.tasmaa && tulos.taysmaytys.ulkopuoliset > 0 && (
                <p className="mt-3 text-[12.5px]">
                  {tulos.taysmaytys.ulkopuoliset} vientiriviä on päivätty tilikausien ulkopuolelle,
                  joten niitä ei voitu täsmäyttää.
                </p>
              )}

              {!tulos.taysmaytys.tasmaa &&
                tulos.taysmaytys.erot.length === 0 &&
                eriavatMaaratLista.length === 0 &&
                tulos.taysmaytys.ulkopuoliset === 0 && (
                  <p className="mt-3 text-[12.5px]">
                    Täsmäytys epäonnistui, mutta syytä ei pystytty erittelemään.
                  </p>
                )}

              {tulos.raportti.varoitukset.map((v) => (
                <p key={v} className="mt-2 text-[12px] text-[var(--text-muted)]">
                  {v}
                </p>
              ))}
              <Button className="mt-4" onClick={() => void avaa(tulos.kohde)}>
                Avaa tuotu kirjanpito
              </Button>
            </section>
          )}
        </div>
      </section>
    </>
  );
}
