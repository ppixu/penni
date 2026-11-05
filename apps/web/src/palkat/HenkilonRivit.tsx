import { Button } from '@/components/ui/button';
import { EuroInput } from '@/editori/EuroInput';
import { TiliValitsin } from '@/editori/TiliValitsin';
import { KENTTA_LUOKKA, VIRHE_LUOKKA } from '@/palkat/lomakeLuokat';
import { muotoileSadasosat, parsiSadasosat } from '@/palkat/prosentti';
import type { IsoDate, PalkkaLaji, PalkkaRivi, Tili } from '@penni/engine';
import { type Cents, muotoileEuro } from '@penni/euro';
import type { SyoteRivi } from '@penni/palkat';

/**
 * Yhden henkilön palkkarivit lomakkeella. Määrät (tunnit, km, päivät, ateriat) syötetään tekstinä
 * ja jäsennetään sadasosiksi (`parsiSadasosat`), eurot `EuroInput`illa; liukulukuja ei käytetä.
 * Taulukosta laskettavien rivien (km, päivärahat, ateriakorvaus, puhelinetu) summa näkyy
 * esikatselusta.
 */

interface LajiTieto {
  nimi: string;
  /** Määrän yksikkö, jos rivillä on määrä. */
  yksikko?: string;
  /** Päivät ja ateriat ovat kokonaislukuja. */
  kokonaisluku?: true;
  /** Summa syötetään (kuukausipalkka, lisä, kulukorvaus). */
  summa?: true;
  /** Yksikköhinta syötetään (tuntipalkka, ravintoedun ateriakustannus). */
  ahinta?: string;
  /** Kulukorvauksen tili valitaan. */
  tili?: true;
}

export const LAJIT: Record<PalkkaLaji, LajiTieto> = {
  kuukausipalkka: { nimi: 'Kuukausipalkka', summa: true },
  tuntipalkka: { nimi: 'Tuntipalkka', yksikko: 'h', ahinta: 'tuntipalkka' },
  // Tulolaji 216 (muut korvaukset): kertaluonteinen lisä, ei säännöllinen lisä tai tulospalkkio.
  lisa: { nimi: 'Kertaluonteinen lisä', summa: true },
  km: { nimi: 'Kilometrikorvaus', yksikko: 'km' },
  kokopaivaraha: { nimi: 'Kokopäiväraha', yksikko: 'pv', kokonaisluku: true },
  osapaivaraha: { nimi: 'Osapäiväraha', yksikko: 'pv', kokonaisluku: true },
  ateriakorvaus: { nimi: 'Ateriakorvaus', yksikko: 'kpl', kokonaisluku: true },
  kulukorvaus: { nimi: 'Kulukorvaus', summa: true, tili: true },
  puhelinetu: { nimi: 'Puhelinetu' },
  ravintoetu: {
    nimi: 'Ravintoetu',
    yksikko: 'kpl',
    kokonaisluku: true,
    ahinta: 'ateriakustannus',
  },
};

/** Lisää rivi -valikon lajit. */
const LISATTAVAT: readonly PalkkaLaji[] = [
  'lisa',
  'km',
  'kokopaivaraha',
  'osapaivaraha',
  'ateriakorvaus',
  'kulukorvaus',
  'ravintoetu',
  'kuukausipalkka',
  'tuntipalkka',
  'puhelinetu',
];

export interface LomakeRivi {
  avain: number;
  laji: PalkkaLaji;
  selite: string;
  /** Määrä tekstinä (sadasosiksi tallennettaessa). */
  maara: string;
  summa: Cents;
  ahinta: Cents;
  tili?: number;
  pvm?: IsoDate;
}

let seuraavaAvain = 1;
const uusiAvain = () => seuraavaAvain++;

/** Syöterivi (oletusrivit tai tallennettu ajo) lomakkeelle. */
export function lomakeRiviksi(r: SyoteRivi): LomakeRivi {
  const rivi: LomakeRivi = {
    avain: uusiAvain(),
    laji: r.laji,
    selite: r.selite,
    maara: r.maara !== undefined ? muotoileSadasosat(r.maara) : '',
    summa: r.summa ?? (0 as Cents),
    ahinta: r.ahinta ?? (0 as Cents),
  };
  if (r.tili !== undefined) rivi.tili = r.tili;
  if (r.pvm !== undefined) rivi.pvm = r.pvm;
  return rivi;
}

/** Uusi tyhjä rivi; kulukorvaukselle oletustili (viimeksi käytetty). */
export function uusiRivi(laji: PalkkaLaji, oletusKulutili?: number): LomakeRivi {
  const rivi: LomakeRivi = {
    avain: uusiAvain(),
    laji,
    selite: LAJIT[laji].nimi,
    maara: '',
    summa: 0 as Cents,
    ahinta: 0 as Cents,
  };
  if (laji === 'kulukorvaus' && oletusKulutili !== undefined) rivi.tili = oletusKulutili;
  return rivi;
}

/** Lomakerivi syöteriviksi, tai suomenkielinen virhe. */
export function lomakkeestaSyotteeksi(r: LomakeRivi): { rivi: SyoteRivi } | { virhe: string } {
  const tieto = LAJIT[r.laji];
  const rivi: SyoteRivi = { laji: r.laji, selite: r.selite.trim() || tieto.nimi };
  if (r.pvm !== undefined) rivi.pvm = r.pvm;
  if (tieto.yksikko) {
    const maara = parsiSadasosat(r.maara, tieto.kokonaisluku === true);
    if ('virhe' in maara) return { virhe: maara.virhe };
    rivi.maara = maara.arvo;
  }
  if (tieto.summa) rivi.summa = r.summa;
  if (tieto.ahinta) rivi.ahinta = r.ahinta;
  if (tieto.tili) {
    if (r.tili === undefined) return { virhe: 'Valitse kulukorvauksen tili.' };
    rivi.tili = r.tili;
  }
  return { rivi };
}

const SOLU = 'px-2 py-[6px] align-top';
const KEHYS = 'rounded-[6px] border border-[var(--border-strong)] px-[10px] py-[6px] text-[13px]';

export function HenkilonRivit({
  nimi,
  rivit,
  virheet,
  lasketut,
  tilit,
  oletusKulutili,
  onMuutos,
}: {
  nimi: string;
  rivit: LomakeRivi[];
  /** Rivikohtaiset virheet samassa järjestyksessä (null = kunnossa). */
  virheet: (string | null)[];
  /** Esikatselun lasketut rivit (summat), kun laskenta onnistui. */
  lasketut: PalkkaRivi[] | undefined;
  tilit: readonly Tili[];
  oletusKulutili: number | undefined;
  onMuutos: (rivit: LomakeRivi[]) => void;
}) {
  const muuta = (avain: number, muutos: Partial<LomakeRivi>) =>
    onMuutos(rivit.map((r) => (r.avain === avain ? { ...r, ...muutos } : r)));

  return (
    <div className="flex flex-col gap-2">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {['Laji', 'Selite', 'Määrä', 'Hinta / summa', 'Yhteensä', ''].map((h, i) => (
              <th
                key={h || i}
                className={`px-2 pb-[6px] text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)] ${
                  i >= 2 && i <= 4 ? 'text-right' : 'text-left'
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rivit.map((r, i) => {
            const tieto = LAJIT[r.laji];
            const laskettu = lasketut?.[i];
            const virhe = virheet[i];
            return (
              <tr key={r.avain} className="border-t border-[var(--border)]">
                <td className={`${SOLU} pt-[13px] whitespace-nowrap`}>{tieto.nimi}</td>
                <td className={SOLU}>
                  <input
                    type="text"
                    aria-label={`${tieto.nimi}: selite`}
                    value={r.selite}
                    onChange={(e) => muuta(r.avain, { selite: e.target.value })}
                    className={`${KENTTA_LUOKKA} w-full`}
                  />
                  {tieto.tili ? (
                    <div className={`${KEHYS} mt-1`}>
                      <TiliValitsin
                        tilit={tilit}
                        arvo={r.tili}
                        ariaLabel={`${tieto.nimi}: tili`}
                        onValitse={(numero) => muuta(r.avain, { tili: numero })}
                      />
                    </div>
                  ) : null}
                  {virhe ? <p className={`${VIRHE_LUOKKA} mt-1`}>{virhe}</p> : null}
                </td>
                <td className={`${SOLU} w-[110px]`}>
                  {tieto.yksikko ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`${tieto.nimi}: määrä`}
                        aria-invalid={virhe ? true : undefined}
                        value={r.maara}
                        onChange={(e) => muuta(r.avain, { maara: e.target.value })}
                        className={`${KENTTA_LUOKKA} w-full text-right tabular-nums`}
                      />
                      <span className="text-[11.5px] text-[var(--text-subtle)]">
                        {tieto.yksikko}
                      </span>
                    </div>
                  ) : null}
                </td>
                <td className={`${SOLU} w-[130px]`}>
                  {tieto.summa || tieto.ahinta ? (
                    <div className={KEHYS}>
                      <EuroInput
                        arvo={tieto.summa ? r.summa : r.ahinta}
                        aria-label={`${tieto.nimi}: ${tieto.summa ? 'summa' : tieto.ahinta}`}
                        onCommit={(snt) =>
                          muuta(r.avain, tieto.summa ? { summa: snt } : { ahinta: snt })
                        }
                      />
                    </div>
                  ) : null}
                </td>
                <td className={`${SOLU} pt-[13px] text-right tabular-nums whitespace-nowrap`}>
                  {laskettu ? muotoileEuro(laskettu.summa) : '—'}
                </td>
                <td className={`${SOLU} w-[40px] text-right`}>
                  <Button
                    variant="ghost"
                    size="compact"
                    type="button"
                    aria-label={`Poista rivi ${tieto.nimi}`}
                    onClick={() => onMuutos(rivit.filter((x) => x.avain !== r.avain))}
                  >
                    ×
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
        <select
          aria-label="Lisää rivi"
          value=""
          onChange={(e) => {
            const laji = e.target.value as PalkkaLaji;
            if (laji) onMuutos([...rivit, uusiRivi(laji, oletusKulutili)]);
          }}
          className={KENTTA_LUOKKA}
        >
          <option value="">+ Lisää rivi henkilölle {nimi}…</option>
          {LISATTAVAT.map((l) => (
            <option key={l} value={l}>
              {LAJIT[l].nimi}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
