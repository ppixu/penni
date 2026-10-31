import type { KpClient } from '@penni/asiakas';
import {
  type IsoDate,
  ResourceError,
  type StoredTosite,
  type TositeSyote,
  lataaKartta,
  tasmayksenPankkitili,
} from '@penni/engine';
import type { Cents } from '@penni/euro';

/** Mitattavan kirjan perustiedot: valittu tilikausi ja neljännes sekä tilit testitositteille. */
export interface KirjaTiedot {
  kausi: { alkaa: IsoDate; loppuu: IsoDate };
  neljannes: { alkupvm: IsoDate; loppupvm: IsoDate; tositteita: number };
  /** Tilikauden kirjattujen tositteiden määrä (vain luku; ei sisältöä). */
  kaudenTositteita: number;
  /** Testitositteiden tilit: pankki (debet), tulo (kredit), meno (debet). */
  tilit: { pankki: number; tulo: number; meno: number };
}

const lisaaKuukausia = (pvm: string, kk: number): string => {
  const d = new Date(`${pvm}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + kk);
  return d.toISOString().slice(0, 10);
};
const edellinenPaiva = (pvm: string): string => {
  const d = new Date(`${pvm}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Valitse mitattava jakso: uusin tilikausi, jossa on kirjattuja tositteita, ja sen kolmen kuukauden
 * jakso, jossa on eniten tositteita (tai annettu `alkupvm`/`loppupvm`). Valitsee myös tilit
 * testitositteille tilityypin perusteella (ARP, CL, D), joten sama koodi toimii mille tahansa
 * tilikartalle.
 */
export async function selvitaKirja(
  client: KpClient,
  ohitus: { alkupvm?: IsoDate; loppupvm?: IsoDate } = {},
): Promise<KirjaTiedot> {
  const kaudet = [...(await client.haeTilikaudet())].sort((a, b) => b.alkaa.localeCompare(a.alkaa));
  if (kaudet.length === 0) throw new Error('Kirjassa ei ole tilikausia');

  let kausi = kaudet[0] as (typeof kaudet)[number];
  let kaudenTositteita = 0;
  for (const k of kaudet) {
    const n = (await client.listaaTositteet({ alkupvm: k.alkaa, loppupvm: k.loppuu })).length;
    if (n > 0) {
      kausi = k;
      kaudenTositteita = n;
      break;
    }
  }

  let neljannes: KirjaTiedot['neljannes'];
  if (ohitus.alkupvm && ohitus.loppupvm) {
    const n = (await client.listaaTositteet({ alkupvm: ohitus.alkupvm, loppupvm: ohitus.loppupvm }))
      .length;
    neljannes = { alkupvm: ohitus.alkupvm, loppupvm: ohitus.loppupvm, tositteita: n };
  } else {
    let paras: KirjaTiedot['neljannes'] | undefined;
    for (let i = 0; i < 4; i++) {
      const alku = lisaaKuukausia(kausi.alkaa, 3 * i);
      if (alku > kausi.loppuu) break;
      const loppuRaaka = edellinenPaiva(lisaaKuukausia(alku, 3));
      const loppu = loppuRaaka > kausi.loppuu ? kausi.loppuu : loppuRaaka;
      const n = (await client.listaaTositteet({ alkupvm: alku, loppupvm: loppu })).length;
      if (!paras || n > paras.tositteita) paras = { alkupvm: alku, loppupvm: loppu, tositteita: n };
    }
    neljannes = paras ?? { alkupvm: kausi.alkaa, loppupvm: kausi.loppuu, tositteita: 0 };
  }

  const init = await client.haeInit();
  const lehdet = init.tilit.filter((t) => !String(t.tyyppi).startsWith('H'));
  const ensin = (tyyppi: string): number | undefined => {
    const numero = lehdet.find((t) => t.tyyppi === tyyppi)?.numero;
    return typeof numero === 'number' ? numero : undefined;
  };
  const pankki = tasmayksenPankkitili(init.asetukset, lataaKartta(init.tilit)) ?? ensin('ARP');
  const tulo = ensin('CL');
  const meno = ensin('D');
  if (pankki === undefined || tulo === undefined || meno === undefined) {
    throw new Error('Tilikartasta puuttuu pankkitili (ARP), tulotili (CL) tai menotili (D)');
  }
  return {
    kausi: { alkaa: kausi.alkaa, loppuu: kausi.loppuu },
    neljannes,
    kaudenTositteita,
    tilit: { pankki, tulo, meno },
  };
}

const c = (n: number): Cents => n as Cents;

/** Tositesyöte testikirjaukselle: myynti (pankki debet / tulo kredit) tai kulu, ilman alv:tä. */
export function testiTosite(
  t: KirjaTiedot,
  pvm: IsoDate,
  sentit: number,
  laji: 'myynti' | 'kulu' = 'myynti',
  tila?: number,
): TositeSyote {
  const [debet, kredit] =
    laji === 'myynti' ? [t.tilit.pankki, t.tilit.tulo] : [t.tilit.meno, t.tilit.pankki];
  return {
    pvm,
    tyyppi: 0,
    sarja: '',
    otsikko: 'Mittaus',
    ...(tila !== undefined ? { tila } : {}),
    viennit: [
      { tili: debet, debet: c(sentit), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
      { tili: kredit, debet: c(0), kredit: c(sentit), pvm, alvKoodi: 0, alvProsentti: 0 },
    ],
  };
}

/**
 * Tallenna tosite; jos kausi on lukittu (PVMLUKITTU), avaa lukitus tässä paikallisessa
 * mittauskopiossa ja yritä uudelleen. Palauttaa tositteen ja tiedon lukituksen avauksesta.
 */
export async function tallennaAvaten(
  client: KpClient,
  t: KirjaTiedot,
  syote: TositeSyote,
): Promise<{ tosite: StoredTosite; avasiLukituksen: boolean }> {
  try {
    return { tosite: await client.luoTosite(syote), avasiLukituksen: false };
  } catch (e) {
    if (!(e instanceof ResourceError) || e.code !== 'PVMLUKITTU') throw e;
    await client.avaaTilikausi(t.kausi.alkaa);
    return { tosite: await client.luoTosite(syote), avasiLukituksen: true };
  }
}
