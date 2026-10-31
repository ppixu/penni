import { type Cents, roundHalfAway } from '@penni/euro';
import { Luonne } from '../accounts/luonne.js';
import { tiliTyypilla } from '../accounts/tili.js';
import { AlvKoodi, TILITYS, alvKoodilla } from '../alv/koodit.js';
import { TositeTila, TositeTyyppi, VientiTyyppi } from '../vouchers/enums.js';
import type { IsoDate, TositeVienti } from '../vouchers/types.js';
import { onkoAlvVelvollinen } from './context.js';
import { type ResourceEnv, ResourceError, type Storage, type StoredTosite } from './storage.js';
import { tallennaTosite } from './tositeResource.js';

export interface MarginaaliverolaskelmaParams {
  alkupvm: IsoDate;
  loppupvm: IsoDate;
}

/** Jaa `summa` sentteinä osuuksiin painojen suhteessa; suurin jäännös -> osat summautuvat tarkalleen. */
function jaaSuhteessa(
  summa: number,
  painot: { avain: number; paino: number }[],
): Map<number, number> {
  const yhteensa = painot.reduce((a, p) => a + p.paino, 0);
  const tulos = new Map<number, number>();
  const jaannokset: { avain: number; jaannos: number }[] = [];
  let jaettu = 0;
  for (const p of painot) {
    const tarkka = (summa * p.paino) / yhteensa;
    const alas = Math.floor(tarkka);
    tulos.set(p.avain, alas);
    jaettu += alas;
    jaannokset.push({ avain: p.avain, jaannos: tarkka - alas });
  }
  jaannokset.sort((a, b) => b.jaannos - a.jaannos);
  let jaljella = summa - jaettu;
  for (const j of jaannokset) {
    if (jaljella <= 0) break;
    tulos.set(j.avain, (tulos.get(j.avain) ?? 0) + 1);
    jaljella--;
  }
  return tulos;
}

/**
 * Kirjaa kauden marginaaliveron (voittomarginaaliverotus): kullekin verokannalle
 * marginaali = myynti(13) − ostot(23) − edellinen alijäämä; positiivisesta lasketaan sisältyvä
 * vero (kanta/(10000+kanta)) ja kirjataan myyntitileittäin suhteessa (914) + ALVVELKA (113);
 * negatiivinen jää alijäämäksi seuraavalle kaudelle (verokannoittain). Legacy: laskeMarginaaliVerotus.
 * Oma MARGINAALILASKELMA(9105)-tositetyyppi — EI koskaan ALVLASKELMA, jottei se laukaise
 * tallennaAlvTilitys-funktion AlvIlmoitettu-rajavahtia uudelleentilityksiä vastaan.
 */
export async function kirjaaMarginaalivero(
  storage: Storage,
  params: MarginaaliverolaskelmaParams,
  env: ResourceEnv,
): Promise<StoredTosite | null> {
  const asetukset = await storage.getAsetukset();
  if (!onkoAlvVelvollinen(asetukset, params.loppupvm))
    throw new ResourceError('EIVEROVELVOLLINEN', 'Kirjanpito ei ole arvonlisäverovelvollinen');

  const jo = await storage.listTositteet({
    bucket: 'kirjanpidossa',
    tyyppi: TositeTyyppi.MARGINAALILASKELMA,
    alkupvm: params.alkupvm,
    loppupvm: params.loppupvm,
  });
  if (jo.length > 0)
    throw new ResourceError('JOMARGINAALILASKELMA', 'Kaudelle on jo laskettu marginaalivero');

  // Edellisen kauden alijäämät: viimeisin MARGINAALILASKELMA ennen kauden alkua.
  const aiemmat = await storage.listTositteet({
    bucket: 'kirjanpidossa',
    tyyppi: TositeTyyppi.MARGINAALILASKELMA,
    loppupvm: params.alkupvm, // <= alkupvm; ei tämän kauden tositetta (guard yllä)
  });
  aiemmat.sort((a, b) => (a.pvm < b.pvm ? -1 : a.pvm > b.pvm ? 1 : 0));
  const edellisetAlijaamat: Record<string, number> = aiemmat.at(-1)?.marginaalialijaama ?? {};

  // Kauden 13/23-viennit verokannoittain; myynnit myös tileittäin.
  const viennit = await storage.listViennit({ alkupvm: params.alkupvm, loppupvm: params.loppupvm });
  const myyntiKannalla = new Map<string, number>();
  const ostoKannalla = new Map<string, number>();
  const myyntiTileittain = new Map<string, Map<number, number>>(); // rateKey -> (tili -> myynti)
  for (const v of viennit) {
    if (v.alvKoodi !== AlvKoodi.MYYNNIT_MARGINAALI && v.alvKoodi !== AlvKoodi.OSTOT_MARGINAALI)
      continue;
    const avain = (Math.round(v.alvProsentti * 100) / 100).toFixed(2); // "25.50"
    if (v.alvKoodi === AlvKoodi.MYYNNIT_MARGINAALI) {
      const m = v.kredit - v.debet;
      myyntiKannalla.set(avain, (myyntiKannalla.get(avain) ?? 0) + m);
      const perTili = myyntiTileittain.get(avain) ?? new Map<number, number>();
      perTili.set(v.tili, (perTili.get(v.tili) ?? 0) + m);
      myyntiTileittain.set(avain, perTili);
    } else {
      ostoKannalla.set(avain, (ostoKannalla.get(avain) ?? 0) + (v.debet - v.kredit));
    }
  }

  const chart = await storage.getChart();
  const alvVelka = tiliTyypilla(chart, Luonne.ALVVELKA);

  const kaikkiKannat = new Set<string>([
    ...myyntiKannalla.keys(),
    ...ostoKannalla.keys(),
    ...Object.keys(edellisetAlijaamat),
  ]);
  const ulos: TositeVienti[] = [];
  const uudetAlijaamat: Record<string, number> = {};
  for (const avain of kaikkiKannat) {
    const myynti = myyntiKannalla.get(avain) ?? 0;
    const ostot = ostoKannalla.get(avain) ?? 0;
    const alijaama = edellisetAlijaamat[avain] ?? 0;
    const marginaali = myynti - ostot - alijaama;
    // Vero kirjataan vain kun kaudella on marginaalimyyntiä, johon vero voidaan kohdistaa
    // (myyntitileittäin). Positiivinen marginaali ilman myyntiä (esim. ostojen palautus ylittää
    // alijäämän) ei ole verollinen jälleenmyynti -> ei kirjausta eikä alijäämää.
    if (marginaali > 0 && myynti > 0) {
      const kanta = Math.round(Number(avain) * 100); // "25.50" -> 2550
      const vero = roundHalfAway((kanta * marginaali) / (10000 + kanta));
      if (vero === 0) continue;
      if (!alvVelka) throw new ResourceError('EIALVTILIA', 'ALV-velkatiliä ei löydy tilikartasta');
      const perTili = myyntiTileittain.get(avain) ?? new Map<number, number>();
      const painot = [...perTili.entries()].map(([tili, m]) => ({ avain: tili, paino: m }));
      const osuudet = jaaSuhteessa(vero, painot);
      for (const [tili, osuus] of osuudet) {
        if (osuus === 0) continue;
        ulos.push({
          tili,
          debet: osuus as Cents,
          kredit: 0 as Cents,
          pvm: params.loppupvm,
          alvKoodi: alvKoodilla(AlvKoodi.MYYNNIT_MARGINAALI, TILITYS), // 914
          alvProsentti: Number(avain),
          tyyppi: VientiTyyppi.MYYNTI + VientiTyyppi.ALVKIRJAUS,
        });
      }
      ulos.push({
        tili: alvVelka.numero,
        debet: 0 as Cents,
        kredit: vero as Cents,
        pvm: params.loppupvm,
        alvKoodi: alvKoodilla(AlvKoodi.MYYNNIT_MARGINAALI, AlvKoodi.ALVKIRJAUS), // 113
        alvProsentti: Number(avain),
        tyyppi: VientiTyyppi.MYYNTI + VientiTyyppi.ALVKIRJAUS,
      });
    } else if (marginaali < 0) {
      uudetAlijaamat[avain] = -marginaali;
    }
  }

  // Jos kaudella ei kirjattu veroa eikä syntynyt uutta alijäämää, tosite jätetään silti
  // tallentamatta VAIN, jos edellisiäkään alijäämiä ei ollut — muuten seuraava kausi lukisi
  // vanhentuneen (jo kuitatun) alijäämän uudelleen edellisestä tositteesta.
  if (
    ulos.length === 0 &&
    Object.keys(uudetAlijaamat).length === 0 &&
    Object.keys(edellisetAlijaamat).length === 0
  )
    return null;

  return tallennaTosite(
    storage,
    {
      pvm: params.loppupvm,
      tyyppi: TositeTyyppi.MARGINAALILASKELMA,
      tila: TositeTila.KIRJANPIDOSSA,
      sarja: '',
      otsikko: `Marginaalivero ${params.alkupvm} – ${params.loppupvm}`,
      viennit: ulos,
      ...(Object.keys(uudetAlijaamat).length > 0 ? { marginaalialijaama: uudetAlijaamat } : {}),
    },
    env,
  );
}
