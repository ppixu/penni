import type { Cents } from '@penni/euro';
import { TositeTila, TositeTyyppi, VientiTyyppi } from '../vouchers/enums.js';
import type { IsoDate, TositeVienti } from '../vouchers/types.js';
import { tilikausiPaivalle } from './numbering.js';
import { type ResourceEnv, ResourceError, type Storage, type StoredTosite } from './storage.js';
import { tallennaTosite } from './tositeResource.js';

export interface VerolaskelmaParams {
  alkupvm: IsoDate;
  loppupvm: IsoDate;
  /** Aiempien tilikausien vahvistettu tappio (vähennetään verotettavasta tuloksesta). */
  aiempiTappio?: Cents;
}

export interface Verolaskelma {
  alkupvm: IsoDate;
  loppupvm: IsoDate;
  tulo: Cents; // veronalainen tulo (tyypit C, CL)
  taysivahennys: Cents; // kokonaan vähennyskelpoiset (tyypit D, DP)
  puolivahennys: Cents; // puoleksi vähennyskelpoiset (tyyppi DH)
  vahennys: Cents; // taysivahennys + trunc(puolivahennys/2)
  ennakko: Cents; // maksetut ennakot (tyyppi DVE)
  tulos: Cents; // tulo - taysivahennys - trunc(puolivahennys/2)
  aiempiTappio: Cents;
  loppuTulos: Cents; // tulos - aiempiTappio
  vero: Cents; // loppuTulos > 0 ? trunc(loppuTulos/5) : 0
  jaaveroa: Cents; // vero - ennakko
  joKirjattu: boolean; // kaudelle on jo kirjattu TULOVERO-tosite
}

export interface TuloveroSyote {
  alkupvm: IsoDate;
  loppupvm: IsoDate;
  aiempiTappio?: Cents;
  // Valinnaiset ohitukset (legacy-dialogin muokattavat kentät); oletuksena laskettu arvo.
  tulo?: Cents;
  taysivahennys?: Cents;
  puolivahennys?: Cents;
  ennakko?: Cents;
}

/** Kokonaislukujako nollaa kohti (kuten C++ qlonglong / Euro). */
const jaa = (osoittaja: number, nimittaja: number): number => Math.trunc(osoittaja / nimittaja);

/** Summaa kauden raakasaldot (Σdebet − Σkredit) verolaskelman tilityyppeihin. */
async function summaaTyypeittain(
  storage: Storage,
  params: VerolaskelmaParams,
): Promise<{ tulo: number; taysivahennys: number; puolivahennys: number; ennakko: number }> {
  const saldot = await storage.querySaldot({ alkupvm: params.alkupvm, loppupvm: params.loppupvm });
  const chart = await storage.getChart();
  const tyyppiNumerolla = new Map(chart.map((t) => [t.numero, t.tyyppiKoodi]));
  let tulo = 0;
  let taysivahennys = 0;
  let puolivahennys = 0;
  let ennakko = 0;
  for (const [numero, saldo] of saldot) {
    switch (tyyppiNumerolla.get(numero)) {
      case 'C':
      case 'CL':
        tulo += -saldo; // tulo = kredit − debet = −(debet − kredit)
        break;
      case 'D':
      case 'DP':
        taysivahennys += saldo; // vähennys = debet − kredit
        break;
      case 'DH':
        puolivahennys += saldo;
        break;
      case 'DVE':
        ennakko += saldo;
        break;
    }
  }
  return { tulo, taysivahennys, puolivahennys, ennakko };
}

/** Verolaskelman yhteinen laskenta (tuloverodialog.cpp:132-160), ohitukset huomioiden. */
function laske(
  raaka: { tulo: number; taysivahennys: number; puolivahennys: number; ennakko: number },
  ohitus: {
    tulo?: Cents;
    taysivahennys?: Cents;
    puolivahennys?: Cents;
    ennakko?: Cents;
    aiempiTappio?: Cents;
  },
) {
  const tulo = ohitus.tulo ?? raaka.tulo;
  const taysivahennys = ohitus.taysivahennys ?? raaka.taysivahennys;
  const puolivahennys = ohitus.puolivahennys ?? raaka.puolivahennys;
  const ennakko = ohitus.ennakko ?? raaka.ennakko;
  const aiempiTappio = ohitus.aiempiTappio ?? 0;
  const vahennys = taysivahennys + jaa(puolivahennys, 2);
  const tulos = tulo - taysivahennys - jaa(puolivahennys, 2);
  const loppuTulos = tulos - aiempiTappio;
  const vero = loppuTulos > 0 ? jaa(loppuTulos, 5) : 0; // 20 % vero
  const jaaveroa = vero - ennakko;
  return {
    tulo,
    taysivahennys,
    puolivahennys,
    vahennys,
    ennakko,
    tulos,
    aiempiTappio,
    loppuTulos,
    vero,
    jaaveroa,
  };
}

/** Onko kaudelle jo kirjattu TULOVERO-tosite (tila >= 100)? */
async function joVerokirjattu(storage: Storage, loppupvm: IsoDate): Promise<boolean> {
  const aiemmat = await storage.listTositteet({
    bucket: 'kirjanpidossa',
    tyyppi: TositeTyyppi.TULOVERO,
    alkupvm: loppupvm,
    loppupvm,
  });
  return aiemmat.length > 0;
}

/** Kauden tuloverolaskelman esikatselu (puhdas luku — ei kirjauksia). */
export async function haeVerolaskelma(
  storage: Storage,
  params: VerolaskelmaParams,
): Promise<Verolaskelma> {
  const raaka = await summaaTyypeittain(storage, params);
  const l = laske(raaka, {
    ...(params.aiempiTappio !== undefined ? { aiempiTappio: params.aiempiTappio } : {}),
  });
  const joKirjattu = await joVerokirjattu(storage, params.loppupvm);
  return {
    alkupvm: params.alkupvm,
    loppupvm: params.loppupvm,
    tulo: l.tulo as Cents,
    taysivahennys: l.taysivahennys as Cents,
    puolivahennys: l.puolivahennys as Cents,
    vahennys: l.vahennys as Cents,
    ennakko: l.ennakko as Cents,
    tulos: l.tulos as Cents,
    aiempiTappio: l.aiempiTappio as Cents,
    loppuTulos: l.loppuTulos as Cents,
    vero: l.vero as Cents,
    jaaveroa: l.jaaveroa as Cents,
    joKirjattu,
  };
}

/** Lue asetuksesta tilinumero (merkkijono) tai palauta oletus. */
function tiliNumero(asetukset: Record<string, string>, avain: string, oletus: number): number {
  const arvo = Number(asetukset[avain]);
  return Number.isFinite(arvo) && arvo > 0 ? arvo : oletus;
}

/**
 * Kirjaa tilikauden tuloveron jaksotus: yksi kaksirivinen TULOVERO(9930)-tosite
 * (tuloverodialog.cpp:77-129). B1-päätös: jätä pois legacy-jakso­metatiedot
 * (jaksoalkaa/jaksoloppuu/jaksotustili) ja era=-1 — ne palvelevat vain seuraavan
 * kauden purkukirjausta (1i-2 jaksotukset), jota ei ole vielä rakennettu.
 */
export async function tallennaTulovero(
  storage: Storage,
  syote: TuloveroSyote,
  env: ResourceEnv,
): Promise<StoredTosite> {
  const kaudet = await storage.getTilikaudet();
  const kausi = tilikausiPaivalle(kaudet, syote.loppupvm);
  if (!kausi || kausi.loppuu !== syote.loppupvm)
    throw new ResourceError('EIKAUDENLOPPU', 'Tulovero kirjataan tilikauden viimeiselle päivälle');

  if (await joVerokirjattu(storage, syote.loppupvm))
    throw new ResourceError('JOVEROKIRJATTU', 'Tilikauden tulovero on jo kirjattu');

  const raaka = await summaaTyypeittain(storage, syote);
  const { jaaveroa } = laske(raaka, syote);
  if (jaaveroa === 0)
    throw new ResourceError('EIVEROA', 'Ennakkovero täsmää tuloveroon, ei kirjattavaa');

  const asetukset = await storage.getAsetukset();
  const chart = await storage.getChart();
  const varmistaTili = (numero: number): number => {
    if (!chart.some((t) => t.numero === numero))
      throw new ResourceError('EITILIA', `Tiliä ${numero} ei ole tilikartassa`);
    return numero;
  };

  const jaksotustili = varmistaTili(tiliNumero(asetukset, 'Tuloverojaksotustili', 9940));
  const selite = `Tuloveron jaksotus tilikaudelta ${syote.alkupvm} – ${syote.loppupvm}`;
  const vienti = (tili: number, debet: number, kredit: number): TositeVienti => ({
    tili,
    debet: debet as Cents,
    kredit: kredit as Cents,
    pvm: syote.loppupvm,
    alvKoodi: 0,
    alvProsentti: 0,
    tyyppi: VientiTyyppi.SIIRTO,
    selite,
  });

  const viennit: TositeVienti[] = [];
  if (jaaveroa > 0) {
    const siirtovelka = varmistaTili(tiliNumero(asetukset, 'Tuloverosiirtovelat', 2968));
    viennit.push(vienti(jaksotustili, jaaveroa, 0));
    viennit.push(vienti(siirtovelka, 0, jaaveroa));
  } else {
    const siirtosaaminen = varmistaTili(tiliNumero(asetukset, 'Tuloverosiirtosaamiset', 1813));
    viennit.push(vienti(jaksotustili, 0, -jaaveroa));
    viennit.push(vienti(siirtosaaminen, -jaaveroa, 0));
  }

  return tallennaTosite(
    storage,
    {
      pvm: syote.loppupvm,
      tyyppi: TositeTyyppi.TULOVERO,
      tila: TositeTila.KIRJANPIDOSSA,
      sarja: '',
      otsikko: selite,
      viennit,
    },
    env,
  );
}
