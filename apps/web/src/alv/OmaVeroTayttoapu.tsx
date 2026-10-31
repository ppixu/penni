import { TaittuvaOtsikko } from '@/components/TaittuvaOtsikko';
import { Button } from '@/components/ui/button';
import {
  type AlvLaskelmaTulos,
  type IsoDate,
  type Kausityyppi,
  muodostaIlmoitinAineisto,
  omaVeroTayttoapu,
} from '@penni/engine';
import { muotoilePvm } from '@penni/euro';
import { tarkistaYtunnus } from '@penni/validator';
import { useEffect, useId, useRef, useState } from 'react';
import type { AlvKausi, KausiKk } from './alvKaudet.js';

const KAUSITYYPPI: Record<KausiKk, Kausityyppi> = { 1: 'K', 3: 'Q', 12: 'V' };

/** Kauden tunnus OmaVeron tapaan: "3/2026", "Q3/2026" tai "2026". */
export function kaudenTunnus(kausi: AlvKausi, kausiKk: KausiKk): string {
  const vuosi = kausi.loppupvm.slice(0, 4);
  const kk = Number(kausi.loppupvm.slice(5, 7));
  if (kausiKk === 12) return vuosi;
  if (kausiKk === 3) return `Q${Math.ceil(kk / 3)}/${vuosi}`;
  return `${kk}/${vuosi}`;
}

/** "1.7.–30.9.2026": alkupäivästä ilman vuotta, kun vuosi on sama. */
function lyhytVali(kausi: AlvKausi): string {
  const alku = muotoilePvm(kausi.alkupvm);
  const samaVuosi = kausi.alkupvm.slice(0, 4) === kausi.loppupvm.slice(0, 4);
  return `${samaVuosi ? alku.replace(/\d{4}$/, '') : `${alku} `}–${muotoilePvm(kausi.loppupvm)}`;
}

/** Selaimen paikallinen aika muodossa 'YYYY-MM-DDTHH:MM:SS' (Ilmoitin-tieto 198). */
function paikallinenAikaleima(d: Date): string {
  const n = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${n(d.getMonth() + 1)}-${n(d.getDate())}T${n(d.getHours())}:${n(
    d.getMinutes(),
  )}:${n(d.getSeconds())}`;
}

const OTSIKKOLUOKKA =
  'pt-3 pb-[5px] text-left text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

/**
 * OmaVeron täyttöapu: kauden luvut OmaVeron lomakkeen järjestyksessä (OMAVERO_LOMAKE),
 * syötemuodossa ("6106,55") ja rivikohtaisella kopiointinapilla. Kaikki luvut tulevat
 * moottorin laskelmasta; mitään ei lähetetä minnekään. Ilmoitin.fi-tiedosto muodostetaan
 * selaimessa ja ladataan käyttäjälle.
 */
export function OmaVeroTayttoapu({
  kausi,
  kausiKk,
  laskelma,
  erapvm,
  ytunnus,
  ilmoitettu,
  auki,
  onVaihda,
}: {
  kausi: AlvKausi;
  kausiKk: KausiKk;
  laskelma: Pick<AlvLaskelmaTulos, 'koodit' | 'maksettava'>;
  erapvm: IsoDate;
  ytunnus: string | undefined;
  ilmoitettu: boolean;
  /** Taittotila elää kutsujalla: komponentti remountataan kauden vaihtuessa. */
  auki: boolean;
  onVaihda: () => void;
}) {
  const sisaltoId = useId();
  const apu = omaVeroTayttoapu(laskelma);
  const [kopioitu, setKopioitu] = useState<number | null>(null);
  const [viesti, setViesti] = useState('');
  const ajastin = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (ajastin.current) clearTimeout(ajastin.current);
    },
    [],
  );

  async function kopioi(koodi: number, nimi: string, syote: string) {
    try {
      await navigator.clipboard.writeText(syote);
      setKopioitu(koodi);
      setViesti(`Kopioitu: ${nimi} ${syote}`);
      if (ajastin.current) clearTimeout(ajastin.current);
      ajastin.current = setTimeout(() => setKopioitu(null), 2000);
    } catch {
      setKopioitu(null);
      setViesti('Kopiointi ei onnistunut — valitse luku ja kopioi käsin.');
    }
  }

  const ytunnusOk = ytunnus !== undefined && tarkistaYtunnus(ytunnus.trim());
  function lataaIlmoitin() {
    try {
      const aineisto = muodostaIlmoitinAineisto(
        { ...kausi, kausityyppi: KAUSITYYPPI[kausiKk], ...laskelma },
        { ytunnus: ytunnus ?? '', aikaleima: paikallinenAikaleima(new Date()) },
      );
      const tunnus = kaudenTunnus(kausi, kausiKk).replace('/', '_');
      const url = URL.createObjectURL(new Blob([aineisto], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `ALV_${tunnus}_${(ytunnus ?? '').trim()}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setViesti('Ilmoitin.fi-tiedosto ladattu. Lähetä se Ilmoitin.fi-palvelussa.');
    } catch (e) {
      setViesti(e instanceof Error ? e.message : 'Tiedoston muodostaminen epäonnistui.');
    }
  }

  return (
    <section aria-label="omavero-tayttoapu" className="flex max-w-2xl flex-col gap-2">
      <h2 className="text-[15px] font-[650]">
        <TaittuvaOtsikko auki={auki} hallitsee={sisaltoId} onVaihda={onVaihda}>
          OmaVero-täyttöapu
        </TaittuvaOtsikko>
      </h2>
      <div id={sisaltoId} className={auki ? 'flex flex-col gap-2' : 'hidden'}>
        <p className="text-[13px] tabular-nums">
          Verokausi{' '}
          <span className="font-semibold">
            {kaudenTunnus(kausi, kausiKk)}, {lyhytVali(kausi)}
          </span>{' '}
          · ilmoita ja maksa viimeistään{' '}
          <span className="font-semibold">{muotoilePvm(erapvm)}</span>
        </p>
        {!ilmoitettu && (
          <p className="text-[12px] text-[var(--text-muted)]">
            Tilitä kausi ennen ilmoittamista, jotta luvut vastaavat kirjanpitoa.
          </p>
        )}
        {apu.eiToimintaa ? (
          <p className="text-[13px]">
            Ei arvonlisäverollista toimintaa: rastita OmaVerossa{' '}
            <span className="font-semibold">Ei toimintaa verokaudella</span>.
          </p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {apu.ryhmat.flatMap((ryhma) => [
                <tr key={ryhma.otsikko}>
                  <th colSpan={3} className={OTSIKKOLUOKKA}>
                    {ryhma.otsikko}
                  </th>
                </tr>,
                ...ryhma.rivit.map((rivi) => (
                  <tr key={rivi.koodi} className="border-t border-[var(--border-faint)]">
                    <td className="py-[5px]">{rivi.nimi}</td>
                    <td className="py-[5px] text-right font-mono tabular-nums">{rivi.syote}</td>
                    <td className="w-[110px] py-[3px] pl-3 text-right">
                      {rivi.laskettu ? (
                        <span className="text-[11.5px] text-[var(--text-subtle)]">
                          OmaVero laskee
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="compact"
                          type="button"
                          aria-label={`Kopioi ${rivi.nimi}`}
                          onClick={() => kopioi(rivi.koodi, rivi.nimi, rivi.syote)}
                        >
                          {kopioitu === rivi.koodi ? (
                            <span className="text-[var(--positive)]">✓ Kopioitu</span>
                          ) : (
                            'Kopioi'
                          )}
                        </Button>
                      )}
                    </td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        )}
        <p className="text-[11.5px] text-[var(--text-subtle)]">
          Jätä muut kentät tyhjiksi. Summat euroina ja sentteinä, desimaalipilkulla.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="sec"
            size="compact"
            type="button"
            disabled={!ytunnusOk}
            title={ytunnusOk ? undefined : 'Lisää kelvollinen Y-tunnus asetuksiin'}
            onClick={lataaIlmoitin}
          >
            Lataa Ilmoitin.fi-tiedosto
          </Button>
          {!ytunnusOk && (
            <span className="text-[11.5px] text-[var(--text-subtle)]">
              Tiedosto vaatii kelvollisen Y-tunnuksen asetuksissa.
            </span>
          )}
        </div>
        <output aria-live="polite" className="text-[12px] text-[var(--text-muted)]">
          {viesti}
        </output>
      </div>
    </section>
  );
}
