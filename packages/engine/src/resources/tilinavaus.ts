import type { Cents } from '@penni/euro';
import { Luonne, onko } from '../accounts/luonne.js';
import { TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import type { IsoDate, TositeVienti } from '../vouchers/types.js';
import { type ResourceEnv, ResourceError, type Storage, type StoredTosite } from './storage.js';
import { tallennaTosite } from './tositeResource.js';

export interface TilinavausSyote {
  pvm: IsoDate;
  /** Luonnollinen etumerkillinen saldo per tili; puoli johdetaan tilin luonteesta. */
  saldot: { tili: number; saldo: Cents }[];
}

const NOLLA = 0 as Cents;

/**
 * Kirjaa kertaluonteisen tilinavauksen (TILINAVAUS 9010): yksi vienti per nollasta poikkeava
 * tili, puoli tilin luonteen mukaan (verbatim tilinavausmodel.cpp:337-341): vastaavaa-tili
 * positiivisella saldolla debetiin, muuten kreditiin; negatiivinen saldo kääntää puolen.
 * TILINAVAUS on EITASMAA-vapaa, joten epätasapainoinenkin avaus kirjautuu; PVMLUKITTU /
 * EIAVOINTAKUTTA pätevät silti (pvm:n on osuttava avoimeen, lukitsemattomaan kauteen).
 */
export async function luoTilinavaus(
  storage: Storage,
  syote: TilinavausSyote,
  env: ResourceEnv,
): Promise<StoredTosite> {
  const chart = await storage.getChart();
  const viennit: TositeVienti[] = [];
  for (const { tili, saldo } of syote.saldot) {
    if (saldo === 0) continue;
    const t = chart.find((a) => a.numero === tili);
    if (!t) throw new ResourceError('TILIPUUTTUU', `Tiliä ${tili} ei ole tilikartassa`);
    const debetPuoli = onko(t.luonne, Luonne.VASTAAVAA) === saldo >= 0;
    const maara = Math.abs(saldo) as Cents;
    viennit.push({
      tili,
      debet: debetPuoli ? maara : NOLLA,
      kredit: debetPuoli ? NOLLA : maara,
      pvm: syote.pvm,
      alvKoodi: 0,
      alvProsentti: 0,
    });
  }

  const tosite = await tallennaTosite(
    storage,
    {
      pvm: syote.pvm,
      tyyppi: TositeTyyppi.TILINAVAUS,
      tila: TositeTila.KIRJANPIDOSSA,
      sarja: '',
      otsikko: 'Tilinavaus',
      viennit,
    },
    env,
  );

  await storage.patchAsetukset({ Tilinavaus: '1', TilinavausPvm: syote.pvm });
  return tosite;
}
