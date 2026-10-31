import { useAsetaKirjanpito } from '@/app/KpClientProvider';
import { OLETUS_SYOTE } from '@/client/luoSiemen';
import { luoOpfsKirjanpito } from '@/client/makeClient';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { yritysAsetukset } from '@penni/charts';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

const MUODOT = Object.entries(yritysAsetukset.muodot as Record<string, { fi?: string }>).map(
  ([koodi, nimet]) => ({ koodi, nimi: nimet.fi ?? koodi }),
);

/** True if loppuu is after alkaa and within 18 months. Pure ISO-string + integer-month math. */
function kelvollinenKausi(alkaa: string, loppuu: string): boolean {
  if (!alkaa || !loppuu || loppuu <= alkaa) return false;
  const [av, ak] = [Number(alkaa.slice(0, 4)), Number(alkaa.slice(5, 7))];
  const [lv, lk] = [Number(loppuu.slice(0, 4)), Number(loppuu.slice(5, 7))];
  const kuukaudet = (lv - av) * 12 + (lk - ak); // whole-month span
  return kuukaudet < 18 || (kuukaudet === 18 && Number(loppuu.slice(8, 10)) === 1);
}

const LK_LUOKKA =
  'rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]';
const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

export function UusiKirjanpitoVelho() {
  const navigate = useNavigate();
  const asetaKirjanpito = useAsetaKirjanpito();
  const [vaihe, setVaihe] = useState(1);
  const [nimi, setNimi] = useState('');
  const [muoto, setMuoto] = useState(OLETUS_SYOTE.muoto);
  const [alv, setAlv] = useState(false);
  const tanaVuosi = new Date().getFullYear();
  const [alkaa, setAlkaa] = useState(`${tanaVuosi}-01-01`);
  const [loppuu, setLoppuu] = useState(`${tanaVuosi}-12-31`);

  const kausiOk = kelvollinenKausi(alkaa, loppuu);

  async function valmis() {
    // Pudota+rakenna+siemennä ainoa OPFS-kanta → uusi kirjanpito säilyy myös sivun uudelleenlatauksessa.
    const client = await luoOpfsKirjanpito({
      nimi,
      muoto,
      alvVelvollinen: alv,
      kausiAlkaa: alkaa,
      kausiLoppuu: loppuu,
    });
    asetaKirjanpito(client);
    void navigate({ to: '/' });
  }

  return (
    <>
      <TopBar otsikko="Uusi kirjanpito" alaotsikko={`Vaihe ${vaihe} / 3`} />
      <section
        aria-label="uusi-kirjanpito"
        className="flex flex-1 flex-col gap-5 overflow-auto px-[22px] py-5"
      >
        {vaihe === 1 && (
          <div className="flex max-w-md flex-col gap-4">
            <label className={LABEL_LUOKKA}>
              Organisaation nimi
              <input
                type="text"
                aria-label="Organisaation nimi"
                value={nimi}
                onChange={(e) => setNimi(e.target.value)}
                className={LK_LUOKKA}
              />
            </label>
            <label className={LABEL_LUOKKA}>
              Yritysmuoto
              <select
                aria-label="Yritysmuoto"
                value={muoto}
                onChange={(e) => setMuoto(e.target.value)}
                className={LK_LUOKKA}
              >
                {MUODOT.map((m) => (
                  <option key={m.koodi} value={m.koodi}>
                    {m.nimi}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={alv} onChange={(e) => setAlv(e.target.checked)} />
              Arvonlisäverovelvollinen
            </label>
            <div>
              <Button type="button" disabled={nimi.trim() === ''} onClick={() => setVaihe(2)}>
                Seuraava
              </Button>
            </div>
          </div>
        )}

        {vaihe === 2 && (
          <div className="flex max-w-md flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className={LABEL_LUOKKA}>Tilikartta</legend>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="kartta" value="yritys" defaultChecked />
                Yritys (oy, tmi, ay, ky, osk)
              </label>
              {muoto === 'tmi' && (
                <p className="ml-6 text-[12px] text-[var(--text-muted)]">
                  Toiminimelle näytetään aluksi vain pienyrittäjän perustilit. Muut tilit saa
                  näkyviin tilikartasta.
                </p>
              )}
              <label className="flex items-center gap-2 text-[13px] text-[var(--text-subtle)]">
                <input type="radio" name="kartta" value="yhdistys" disabled />
                Yhdistys — tulossa
              </label>
              <label className="flex items-center gap-2 text-[13px] text-[var(--text-subtle)]">
                <input type="radio" name="kartta" value="asoy" disabled />
                Asunto-osakeyhtiö — tulossa
              </label>
            </fieldset>
            <div className="flex gap-2">
              <Button variant="sec" type="button" onClick={() => setVaihe(1)}>
                Takaisin
              </Button>
              <Button type="button" onClick={() => setVaihe(3)}>
                Seuraava
              </Button>
            </div>
          </div>
        )}

        {vaihe === 3 && (
          <div className="flex max-w-md flex-col gap-4">
            <label className={LABEL_LUOKKA}>
              Tilikausi alkaa
              <input
                type="date"
                aria-label="Tilikausi alkaa"
                value={alkaa}
                onChange={(e) => setAlkaa(e.target.value)}
                className={`${LK_LUOKKA} tabular-nums`}
              />
            </label>
            <label className={LABEL_LUOKKA}>
              Tilikausi päättyy
              <input
                type="date"
                aria-label="Tilikausi päättyy"
                value={loppuu}
                onChange={(e) => setLoppuu(e.target.value)}
                className={`${LK_LUOKKA} tabular-nums`}
              />
            </label>
            {!kausiOk && (
              <p role="alert" className="text-[12.5px] text-[var(--danger)]">
                Tilikauden tulee päättyä alkamisen jälkeen ja kestää enintään 18 kuukautta.
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="sec" type="button" onClick={() => setVaihe(2)}>
                Takaisin
              </Button>
              <Button type="button" disabled={!kausiOk} onClick={valmis}>
                Luo kirjanpito
              </Button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
