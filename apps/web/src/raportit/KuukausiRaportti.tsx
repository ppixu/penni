import { useKpClient } from '@/app/KpClientProvider';
import { avaimet } from '@/app/kysely';
import type { IsoDate, RaporttiParams, RaporttiRivi } from '@penni/engine';
import { type Cents, Euro, muotoileEuro } from '@penni/euro';
import { useQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Fragment, useMemo } from 'react';
import { Lataustila } from './Lataustila';
import type { RaporttiProps } from './raporttiProps';

/** Yksi sarake: kalenterikuukausi rajattuna raportin jaksoon. */
export interface Kuukausi {
  alkaa: IsoDate;
  loppuu: IsoDate;
}

const kaksi = (n: number): string => String(n).padStart(2, '0');

/**
 * Jakson kalenterikuukaudet alusta loppuun (Kitsas: alkukk..loppukk, laatijankuukausiraportti.cpp:
 * 40-41). Ensimmäinen ja viimeinen kuukausi rajataan jaksoon, jos jakso ei ala kuun alusta tai
 * pääty kuun loppuun (esim. 15.3. alkava tilikausi).
 */
export function kuukaudet(alkupvm: IsoDate, loppupvm: IsoDate): Kuukausi[] {
  const out: Kuukausi[] = [];
  let vuosi = Number(alkupvm.slice(0, 4));
  let kk = Number(alkupvm.slice(5, 7));
  const viimeinen = loppupvm.slice(0, 7);
  // Varmistus: virheellinen jakso ei jää silmukkaan.
  for (let i = 0; i < 600; i++) {
    const tunnus = `${vuosi}-${kaksi(kk)}`;
    if (tunnus > viimeinen) break;
    const paivia = new Date(Date.UTC(vuosi, kk, 0)).getUTCDate();
    const alkaa = `${tunnus}-01`;
    const loppuu = `${tunnus}-${kaksi(paivia)}`;
    out.push({
      alkaa: alkaa < alkupvm ? alkupvm : alkaa,
      loppuu: loppuu > loppupvm ? loppupvm : loppuu,
    });
    kk++;
    if (kk > 12) {
      kk = 1;
      vuosi++;
    }
  }
  return out;
}

/** Sarakeotsikko "M/yyyy" kuukauden lopusta (laatijankuukausiraportti.cpp:76). */
export function kuukausiOtsikko(k: Kuukausi): string {
  return `${Number(k.loppuu.slice(5, 7))}/${k.loppuu.slice(0, 4)}`;
}

/** Yhdistetty rivi: sama rivi kaikilta kuukausilta, yksi arvo per kuukausi. */
export interface KuukausiRivi {
  avain: string;
  teksti: string;
  sisennys: number;
  lihava: boolean;
  tili?: number;
  /** Kaavarivin indeksi (erittelyrivillä emon); puuttuu vanhalta palvelimelta. */
  kaavarivi?: number;
  /** Kuukausittain: rivin laji `kaikkiRivit`-tilassa (ks. RaporttiRivi.kaavaLaji). */
  lajit: (RaporttiRivi['kaavaLaji'] | undefined)[];
  /** Jokin kuukausi tulosti tyhjän välirivin tämän rivin eteen. */
  tyhjaEnnen: boolean;
  /** Kuukausittain: summa, null = otsikkorivi, undefined = rivi puuttui kuukaudelta. */
  arvot: (Cents | null | undefined)[];
}

interface AvainRivi {
  avain: string;
  rivi: RaporttiRivi;
  tyhjaEnnen: boolean;
}

/**
 * Rivien avaimet yhdelle kuukaudelle. Penni laatii rivit saldoista: kaavarivi jää pois, jos sen
 * tileillä ei ole kuukaudella saldoa, ja tilikohtainen erittelyrivi, jos tilin saldo on nolla
 * (raportti.ts: tulkitseRaportti). Rivirakenne voi siis erota kuukaudesta toiseen, joten riviä
 * ei yhdistetä indeksillä vaan avaimella: kaavarivillä kaavarivin indeksi (`kaavarivi`; sama
 * teksti voi toistua kaavassa, joten teksti ei kelpaa avaimeksi), erittelyrivillä lisäksi tili.
 * Rivi ilman indeksiä (vanha palvelin) avainnetaan tekstillä.
 */
function avainRivit(rivit: readonly RaporttiRivi[]): AvainRivi[] {
  const out: AvainRivi[] = [];
  let tyhja = false;
  for (const rivi of rivit) {
    if (rivi.tyhja) {
      tyhja = true;
      continue;
    }
    const kaava = String(rivi.kaavarivi ?? rivi.teksti);
    const avain = rivi.tili === undefined ? kaava : `${kaava}>${rivi.tili}`;
    out.push({ avain, rivi, tyhjaEnnen: tyhja });
    tyhja = false;
  }
  return out;
}

/**
 * Yhdistä kuukausittain laaditut raportit yhdeksi riviluetteloksi. Rivijärjestys säilyy: kuukauden
 * rivi, jota ei vielä ole, lisätään sen edellisen tunnetun rivin perään.
 */
export function yhdistaKuukaudet(
  kuukausirivit: readonly (readonly RaporttiRivi[])[],
): KuukausiRivi[] {
  const maara: KuukausiRivi[] = [];
  const n = kuukausirivit.length;
  kuukausirivit.forEach((rivit, kk) => {
    let paikka = 0;
    for (const { avain, rivi, tyhjaEnnen } of avainRivit(rivit)) {
      let i = maara.findIndex((r) => r.avain === avain);
      if (i >= 0) {
        const olemassa = maara[i] as KuukausiRivi;
        if (tyhjaEnnen) olemassa.tyhjaEnnen = true;
        paikka = i + 1;
      } else {
        i = paikka;
        // Uusi tilirivi samaan paikkaan emonsa alla numerojärjestyksessä.
        if (rivi.tili !== undefined) {
          while (i < maara.length) {
            const naapuri = maara[i] as KuukausiRivi;
            if (naapuri.tili === undefined || naapuri.tili > rivi.tili) break;
            i++;
          }
        }
        maara.splice(i, 0, {
          avain,
          teksti: rivi.teksti,
          sisennys: rivi.sisennys,
          lihava: rivi.lihava,
          ...(rivi.tili !== undefined ? { tili: rivi.tili } : {}),
          ...(rivi.kaavarivi !== undefined ? { kaavarivi: rivi.kaavarivi } : {}),
          lajit: new Array<RaporttiRivi['kaavaLaji']>(n).fill(undefined),
          tyhjaEnnen,
          arvot: new Array<Cents | null | undefined>(n).fill(undefined),
        });
        paikka = i + 1;
      }
      (maara[i] as KuukausiRivi).arvot[kk] = rivi.arvo;
      (maara[i] as KuukausiRivi).lajit[kk] = rivi.kaavaLaji;
    }
  });
  // Nykyinen moottori antaa jokaiselle riville kaavarivin: järjestys on silloin kaavan järjestys,
  // eikä riviä, joka ilmestyy vasta myöhemmässä kuussa, voi sijoittaa edellisen rivin
  // erittelyrivien eteen. Vanhan palvelimen (ei kaavariviä) rivit pysyvät sijoitusjärjestyksessä.
  if (maara.length > 0 && maara.every((r) => r.kaavarivi !== undefined)) {
    maara.sort(
      (a, b) =>
        (a.kaavarivi as number) - (b.kaavarivi as number) || (a.tili ?? -1) - (b.tili ?? -1),
    );
  }
  return sovellaNayttosaannot(maara);
}

/**
 * Kitsaksen näyttösäännöt kerran koko monikuukautiselle riville (moottori on antanut kaikki rivit,
 * `kaikkiRivit`). Kitsas laatii kaavan kerran kaikille sarakkeille: kuukausiraportti saa yhden
 * rivijoukon, jossa on summa per kuukausi (laatijankuukausiraportti.cpp:70-91), joten säännöt
 * koskevat yhdistettyä riviä eikä yksittäistä kuukautta (laatijantasetulos.cpp:251-253, 300-305):
 * - rivi, jonka tileillä ei ole saldoa missään kuukaudessa eikä S/H pakota sitä näkyviin
 *   (kaavaLaji 'ohitettava' kaikilla kuukausilla), jää pois erittelyriveineen;
 * - '='-välisumma jää pois, jos edellinen näkyviin jäänyt rivi oli myös välisumma. Pelkät
 *   otsikkorivit eivät nollaa sääntöä, ohitetut rivit eivät myöskään (kuten moottorissa,
 *   raportti.ts: edellinenValisumma).
 * Välirivi (V), joka olisi ollut pois jäävän rivin edessä, siirtyy seuraavalle näkyvälle riville.
 * Rivit ilman kaavaLajia (vanha palvelin) jäävät sellaisenaan.
 */
function sovellaNayttosaannot(rivit: KuukausiRivi[]): KuukausiRivi[] {
  if (!rivit.some((r) => r.lajit.some((l) => l !== undefined))) return rivit;
  const out: KuukausiRivi[] = [];
  let edellinenValisumma = false;
  let tyhjaSiirtyy = false;
  let pudotaLapset = false;
  for (const r of rivit) {
    if (r.tili !== undefined) {
      // Erittelyrivi seuraa emoaan.
      if (!pudotaLapset) out.push(r);
      continue;
    }
    // Vain kuukaudet, joilta rivi tuli; lajin puute tarkoittaa tavallista kaavariviä.
    const lajit = r.lajit.filter((_, kk) => r.arvot[kk] !== undefined);
    const tyhjaKaikkialla = lajit.length > 0 && lajit.every((l) => l === 'ohitettava');
    const valisumma = lajit.includes('valisumma');
    const otsikko = lajit.includes('otsikko');
    if (tyhjaKaikkialla || (valisumma && edellinenValisumma)) {
      pudotaLapset = true;
      if (r.tyhjaEnnen) tyhjaSiirtyy = true;
      continue;
    }
    pudotaLapset = false;
    if (!otsikko) edellinenValisumma = valisumma;
    out.push(tyhjaSiirtyy && !r.tyhjaEnnen ? { ...r, tyhjaEnnen: true } : r);
    tyhjaSiirtyy = false;
  }
  return out;
}

/** Rivin kuukausiarvot näytettävinä: puuttuva kuukausi on nolla, otsikkorivillä ei lukuja. */
function nayttoArvot(rivi: KuukausiRivi): (Cents | null)[] {
  const otsikko = rivi.arvot.every((a) => a === null || a === undefined);
  return rivi.arvot.map((a) => (otsikko ? null : (a ?? Euro.fromCents(0))));
}

function summa(arvot: readonly (Cents | null)[]): Cents | null {
  if (arvot.every((a) => a === null)) return null;
  return arvot.reduce<Cents>((s, a) => Euro.add(s, a ?? Euro.fromCents(0)), Euro.fromCents(0));
}

/**
 * Tase tai tuloslaskelma kuukausittain (Kitsas: laatijankuukausiraportti.cpp). Sama kaava kuin
 * kaavaraportilla, yksi sarake per kuukausi: tase kuukauden lopun tilanteena, tuloslaskelma kuun
 * oman tuloksena. Tuloslaskelmalla on lisäksi Yhteensä-sarake (KuukaudetYhteensa; taseella ei,
 * laatijankuukausiraportti.cpp:21).
 */
export function KuukausiRaportti({ alkupvm, loppupvm, muoto, naytaTilit }: RaporttiProps) {
  const client = useKpClient();
  const tase = muoto?.startsWith('tase/') ?? false;
  const jakso = useMemo(() => kuukaudet(alkupvm, loppupvm), [alkupvm, loppupvm]);

  const tulokset = useQueries({
    queries: muoto
      ? jakso.map((k) => {
          // Erittelyt haetaan aina ja suodatetaan näkymässä (kuten KaavaRaportti). Kaikki
          // kaavarivit pyydetään, jotta näkyvyys ratkaistaan kuukausien yli (sovellaNayttosaannot).
          const params: RaporttiParams = tase
            ? { muoto, pvm: k.loppuu, erittelyt: true, kaikkiRivit: true }
            : { muoto, pvm: k.loppuu, alkupvm: k.alkaa, erittelyt: true, kaikkiRivit: true };
          return {
            queryKey: avaimet.raportti(params),
            queryFn: () => client.laadiRaportti(params),
          };
        })
      : [],
  });

  const valmis = tulokset.length > 0 && tulokset.every((t) => t.data !== undefined);
  const virhe = tulokset.find((t) => t.isError);
  // Kuukausia on enintään kymmeniä ja rivejä satoja, joten yhdistäminen joka renderöinnillä on halpaa.
  const rivit = valmis ? yhdistaKuukaudet(tulokset.map((t) => t.data as RaporttiRivi[])) : [];

  if (!muoto) {
    return (
      <p className="text-[13px] text-[var(--text-muted)]">Raporttikaavaa ei ole määritetty.</p>
    );
  }
  if (!valmis) return <Lataustila virhe={virhe !== undefined} />;

  const yhteensa = !tase;
  const nakyvat = naytaTilit ? rivit : rivit.filter((r) => r.tili === undefined);

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th scope="col" className="min-w-[220px] py-[5px] pr-4 text-left font-semibold">
              <span className="sr-only">Rivi</span>
            </th>
            {jakso.map((k) => (
              <th
                key={k.alkaa}
                scope="col"
                className="whitespace-nowrap px-3 py-[5px] text-right font-semibold"
              >
                {kuukausiOtsikko(k)}
              </th>
            ))}
            {yhteensa && (
              <th scope="col" className="whitespace-nowrap px-3 py-[5px] text-right font-semibold">
                Yhteensä
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {nakyvat.map((r) => {
            const arvot = nayttoArvot(r);
            const kaikki = yhteensa ? summa(arvot) : null;
            const erittely = r.tili !== undefined;
            const solu = erittely
              ? 'py-[3px] text-right tabular-nums text-[var(--text-muted)]'
              : `py-[5px] text-right tabular-nums ${r.lihava ? 'font-semibold' : ''}`;
            return (
              <Fragment key={r.avain}>
                {r.tyhjaEnnen && (
                  <tr aria-hidden>
                    <td className="h-3" colSpan={jakso.length + 1 + (yhteensa ? 1 : 0)} />
                  </tr>
                )}
                <tr
                  className={`border-b border-[var(--border-faint)] ${erittely ? 'text-[12.5px]' : ''}`}
                >
                  <td
                    className={
                      erittely
                        ? 'py-[3px] pr-4 text-[var(--text-muted)]'
                        : `py-[5px] pr-4 ${r.lihava ? 'font-semibold' : ''}`
                    }
                    style={{ paddingLeft: `${r.sisennys * 16}px` }}
                  >
                    {r.tili !== undefined ? (
                      <Link
                        to="/tilikartta"
                        search={{ nakyma: 'kaikki', tili: r.tili }}
                        className="hover:text-[var(--accent)] hover:underline"
                      >
                        {r.teksti}
                      </Link>
                    ) : (
                      r.teksti
                    )}
                  </td>
                  {arvot.map((a, i) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: sarake = kuukausi, vakaa järjestys
                      key={i}
                      className={`${solu} whitespace-nowrap px-3`}
                    >
                      {a === null ? '' : muotoileEuro(a)}
                    </td>
                  ))}
                  {yhteensa && (
                    <td className={`${solu} whitespace-nowrap px-3 font-semibold`}>
                      {kaikki === null ? '' : muotoileEuro(kaikki)}
                    </td>
                  )}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
