import type { Cents } from '@penni/euro';
import { Luonne } from '../accounts/luonne.js';
import { type Tili, tiliTyypilla } from '../accounts/tili.js';
import type { Kumppani } from '../partners/kumppani.js';
import { tiliAsetuksesta } from '../resources/myyntilaskuResource.js';
import type { SaldotParams, SaldotTulos } from '../resources/saldot.js';
import type { Asetukset, StoredTosite, TositeFilter } from '../resources/storage.js';
import type { IsoDate } from '../vouchers/types.js';
import {
  type KirjausEhdotus,
  type Kirjausmuisti,
  ehdotaKirjaus,
  opiKirjaushistoriasta,
} from './ehdotaKirjaus.js';
import { type TositeAsetukset, paatteleMenotili } from './kuittiTosite.js';
import type { Tiliote } from './poimiKuukausitiliote.js';
import type { TasmaysSaannot } from './tasmaysSaannot.js';
import { type Kuittilahde, type TapahtumaTulos, tasmaytaTiliote } from './tasmaytaTiliote.js';
import {
  KIRJATTU_PVM_VARA,
  type TyolistaRivi,
  poimiKirjatut,
  rakennaTyolista,
  siirraPaivia,
} from './tyolista.js';

/**
 * Mistä työlista lukee kirjan: tositteet, kumppanit ja saldot. `KpClient` täyttää tämän
 * sellaisenaan (työpöydän näkymä ja CLI antavat oman asiakkaansa), joten moottori ei tarvitse
 * riippuvuutta asiakaskerrokseen.
 */
export interface TyolistaLahde {
  listaaTositteet(filter: TositeFilter): Promise<StoredTosite[]>;
  haeKumppanit(): Promise<Kumppani[]>;
  haeSaldot(params: SaldotParams): Promise<SaldotTulos>;
}

/**
 * Täsmäytyksen oletuspankkitili: kirjaan tallennettu `TasmaysPankkitili`, muuten tilikartan
 * ensimmäinen pankkitili-luonteinen tili.
 */
export function tasmayksenPankkitili(
  asetukset: Asetukset,
  chart: readonly Tili[],
): number | undefined {
  return (
    tiliAsetuksesta(asetukset, 'TasmaysPankkitili') ??
    tiliTyypilla(chart, Luonne.PANKKITILI)?.numero
  );
}

/** Työlistan rivien kirjauksen oletukset: pankkitili ja myyjäkohtaiset menotilisäännöt. */
export function tyolistanTositeAsetukset(
  pankkitili: number | undefined,
  saannot: TasmaysSaannot,
): TositeAsetukset {
  return {
    ...(pankkitili !== undefined ? { pankkitili } : {}),
    menotiliSaannot: saannot.menotiliSaannot,
  };
}

/**
 * Vanhin ja tuorein tapahtumapäivä — rajaa jo-kirjattujen tositteiden haun. Rajoja levennetään
 * jo-kirjattu-tunnistuksen päivävaralla, jotta kauden reunan tosite eri päivällä löytyy.
 */
export function tyolistanPvmVali(tapahtumat: readonly { pvm: IsoDate }[]): {
  alkupvm: IsoDate;
  loppupvm: IsoDate;
} {
  const pvmt = tapahtumat.map((t) => t.pvm);
  return {
    alkupvm: siirraPaivia(
      pvmt.reduce((min, p) => (p < min ? p : min)),
      -KIRJATTU_PVM_VARA,
    ),
    loppupvm: siirraPaivia(
      pvmt.reduce((max, p) => (p > max ? p : max)),
      KIRJATTU_PVM_VARA,
    ),
  };
}

/**
 * Historian ehdotus riville. Käyttäjän tallentama myyjäkohtainen menotilisääntö on
 * nimenomainen valinta ja voittaa historian: sääntöön osuvalle menolle ei ehdoteta mitään,
 * jolloin moottori käyttää sääntöä kirjatessa.
 */
export function ehdotusRiville(
  muisti: Kirjausmuisti,
  tulos: TapahtumaTulos,
  saannot: TasmaysSaannot,
): KirjausEhdotus | undefined {
  const { tapahtuma } = tulos;
  if (tapahtuma.maara < 0) {
    const nimi = [tulos.kuitti?.kuitti.myyja, tapahtuma.nimi].filter(Boolean).join(' ');
    if (paatteleMenotili(nimi, saannot.menotiliSaannot, undefined) !== undefined) return undefined;
  }
  return ehdotaKirjaus(muisti, tapahtuma, { omistajanNimet: saannot.omistajanNimet });
}

export interface TyolistaTulos {
  rivit: TyolistaRivi[];
  /** Kuitit joille ei löytynyt pankkitapahtumaa. */
  kuititIlmanTapahtumaa: Kuittilahde[];
  /**
   * Kirjanpidon pankkitilin saldo tiliotteen kautta edeltävänä päivänä; vain kun tiliotteella
   * on kausi ja alkusaldo (kuukausitiliote), muuten `undefined`.
   */
  kirjanpidonAlkusaldo?: Cents;
}

export interface MuodostaTyolistaOptiot {
  pankkitili: number;
  chart: readonly Tili[];
  saannot: TasmaysSaannot;
}

/**
 * Rakentaa täsmäytyksen työlistan luetusta tiliotteesta ja kuiteista kirjan tiedoilla:
 *
 * 1. jo kirjatut rivit tunnistetaan pankkitilin vienneistä tapahtumien päiväväliltä
 *    (± `KIRJATTU_PVM_VARA`); luonnokset lasketaan mukaan, jotta osittain kirjattua erää ei
 *    ehdoteta kirjattavaksi kahteen kertaan (lukumääräperusteinen paritus, ks. rakennaTyolista);
 * 2. kirjaamattomille riveille kirjaushistorian ehdotus (ehdotusRiville);
 * 3. kuukausitiliotteelle kirjanpidon pankkisaldo kautta edeltävänä päivänä alkusaldon
 *    vertailuun.
 *
 * Työpöydän Täsmäytys-näkymä ja CLI:n `tiliote`-komento käyttävät tätä samaa polkua.
 */
export async function muodostaTyolista(
  lahde: TyolistaLahde,
  tiliote: Pick<Tiliote, 'tapahtumat' | 'kausi' | 'alkusaldo'>,
  kuitit: readonly Kuittilahde[],
  optiot: MuodostaTyolistaOptiot,
): Promise<TyolistaTulos> {
  const { pankkitili, chart, saannot } = optiot;
  const { tapahtumat, kausi } = tiliote;
  let kirjatutLahde: StoredTosite[] = [];
  if (tapahtumat.length > 0) {
    const { alkupvm, loppupvm } = tyolistanPvmVali(tapahtumat);
    const [kirjanpidossa, luonnokset] = await Promise.all([
      lahde.listaaTositteet({ bucket: 'kirjanpidossa', alkupvm, loppupvm }),
      lahde.listaaTositteet({ bucket: 'luonnos', alkupvm, loppupvm }),
    ]);
    kirjatutLahde = [...kirjanpidossa, ...luonnokset];
  }
  const [historia, kumppanit, saldot] = await Promise.all([
    lahde.listaaTositteet({ bucket: 'kirjanpidossa' }),
    lahde.haeKumppanit(),
    kausi && tiliote.alkusaldo !== undefined
      ? lahde.haeSaldot({ pvm: kausi.alkaa, tili: pankkitili, alkusaldot: true })
      : Promise.resolve(undefined),
  ]);
  const muisti = opiKirjaushistoriasta(historia, chart, {
    kumppanit: new Map(kumppanit.map((k) => [k.id, k.nimi])),
  });
  const raportti = tasmaytaTiliote(tapahtumat, [...kuitit], {
    omistajanNimet: saannot.omistajanNimet,
    vendorAliakset: saannot.vendorAliakset,
  });
  const tulos: TyolistaTulos = {
    rivit: rakennaTyolista(raportti, poimiKirjatut(kirjatutLahde, pankkitili), {
      ehdota: (t) => ehdotusRiville(muisti, t, saannot),
    }),
    kuititIlmanTapahtumaa: raportti.kuititIlmanTapahtumaa,
  };
  if (saldot) tulos.kirjanpidonAlkusaldo = (saldot.get(pankkitili) ?? 0) as Cents;
  return tulos;
}
