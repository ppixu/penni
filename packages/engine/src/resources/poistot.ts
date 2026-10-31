import type { Cents } from '@penni/euro';
import { TositeTila, TositeTyyppi, VientiTyyppi } from '../vouchers/enums.js';
import type { IsoDate, TositeVienti } from '../vouchers/types.js';
import { tilikausiPaivalle } from './numbering.js';
import { type ResourceEnv, ResourceError, type Storage, type StoredTosite } from './storage.js';
import { tallennaTosite } from './tositeResource.js';

export interface PoistolaskelmaParams {
  loppupvm: IsoDate;
}

export interface PoistoRivi {
  tili: number; // poistettava omaisuustili (APM)
  ennen: Cents; // kirjanpitoarvo ennen poistoa
  poisto: Cents; // menojäännöspoisto
  poistotili: number; // tulosvaikutteinen poistotili (DP)
}

export interface Poistolaskelma {
  loppupvm: IsoDate;
  rivit: PoistoRivi[];
  yhteensa: Cents; // Σ poisto
  joKirjattu: boolean; // kaudelle on jo kirjattu POISTOLASKELMA
}

export type PoistotSyote = PoistolaskelmaParams;

/**
 * Kauden menojäännöspoistot (APM-tilit): poisto = trunc(prosentti × arvo / 100)
 * (tilikaudetroute.cpp:207-229). Kirjanpitoarvo = querySaldot loppupvm:ään asti
 * (raaka debet − kredit). Vain positiiviset poistot mukaan. Kokonaislukusentit.
 */
async function laskeRivit(storage: Storage, params: PoistolaskelmaParams): Promise<PoistoRivi[]> {
  const saldot = await storage.querySaldot({ loppupvm: params.loppupvm });
  const chart = await storage.getChart();
  const rivit: PoistoRivi[] = [];
  for (const tili of chart) {
    if (tili.tyyppiKoodi !== 'APM') continue;
    const ennen = saldot.get(tili.numero) ?? 0;
    const prosentti = Number(tili.data.menojaannospoisto);
    if (!Number.isFinite(prosentti) || prosentti <= 0 || ennen <= 0) continue;
    const poisto = Math.trunc((prosentti * ennen) / 100);
    if (poisto <= 0) continue;
    rivit.push({
      tili: tili.numero,
      ennen: ennen as Cents,
      poisto: poisto as Cents,
      poistotili: Number(tili.data.poistotili),
    });
  }
  return rivit;
}

/** Onko kaudelle jo kirjattu POISTOLASKELMA-tosite (tila >= 100)? */
async function joPoistettu(storage: Storage, loppupvm: IsoDate): Promise<boolean> {
  const aiemmat = await storage.listTositteet({
    bucket: 'kirjanpidossa',
    tyyppi: TositeTyyppi.POISTOLASKELMA,
    alkupvm: loppupvm,
    loppupvm,
  });
  return aiemmat.length > 0;
}

/** Kauden poistolaskelman esikatselu (puhdas luku — ei kirjauksia). */
export async function haePoistolaskelma(
  storage: Storage,
  params: PoistolaskelmaParams,
): Promise<Poistolaskelma> {
  const rivit = await laskeRivit(storage, params);
  const yhteensa = rivit.reduce((summa, r) => summa + r.poisto, 0) as Cents;
  const joKirjattu = await joPoistettu(storage, params.loppupvm);
  return { loppupvm: params.loppupvm, rivit, yhteensa, joKirjattu };
}

/**
 * Kirjaa kauden suunnitelman mukaiset poistot: yksi POISTOLASKELMA(9910)-tosite,
 * per poistorivi KREDIT omaisuustili (POISTO+VASTAKIRJAUS) / DEBET poistotili (POISTO)
 * (poistaja.cpp:51-122). B1-analogia (kuten tulovero): ei jakso­metatietoja — poistoa
 * ei pureta. Tasapaino syntyy rakenteesta (Σ omaisuuskreditit = Σ poistotilidebetit).
 */
export async function tallennaPoistot(
  storage: Storage,
  syote: PoistotSyote,
  env: ResourceEnv,
): Promise<StoredTosite> {
  const kaudet = await storage.getTilikaudet();
  const kausi = tilikausiPaivalle(kaudet, syote.loppupvm);
  if (!kausi || kausi.loppuu !== syote.loppupvm)
    throw new ResourceError('EIKAUDENLOPPU', 'Poistot kirjataan tilikauden viimeiselle päivälle');

  if (await joPoistettu(storage, syote.loppupvm))
    throw new ResourceError('JOPOISTETTU', 'Tilikauden poistot on jo kirjattu');

  const rivit = await laskeRivit(storage, syote);
  if (rivit.length === 0)
    throw new ResourceError('EIPOISTETTAVAA', 'Kaudella ei ole poistettavaa omaisuutta');

  const chart = await storage.getChart();
  const varmistaTili = (numero: number): number => {
    if (!Number.isFinite(numero) || numero <= 0 || !chart.some((t) => t.numero === numero))
      throw new ResourceError('EITILIA', `Poistotiliä ${numero} ei ole tilikartassa`);
    return numero;
  };

  const selite = `Suunnitelman mukaiset poistot ${syote.loppupvm}`;
  const viennit: TositeVienti[] = [];
  for (const rivi of rivit) {
    const poistotili = varmistaTili(rivi.poistotili);
    viennit.push({
      tili: rivi.tili,
      debet: 0 as Cents,
      kredit: rivi.poisto,
      pvm: syote.loppupvm,
      alvKoodi: 0,
      alvProsentti: 0,
      tyyppi: VientiTyyppi.POISTO + VientiTyyppi.VASTAKIRJAUS,
      selite,
    });
    viennit.push({
      tili: poistotili,
      debet: rivi.poisto,
      kredit: 0 as Cents,
      pvm: syote.loppupvm,
      alvKoodi: 0,
      alvProsentti: 0,
      tyyppi: VientiTyyppi.POISTO,
      selite,
    });
  }

  return tallennaTosite(
    storage,
    {
      pvm: syote.loppupvm,
      tyyppi: TositeTyyppi.POISTOLASKELMA,
      tila: TositeTila.KIRJANPIDOSSA,
      sarja: '',
      otsikko: selite,
      viennit,
    },
    env,
  );
}
