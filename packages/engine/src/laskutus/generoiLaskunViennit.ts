import { type Cents, roundHalfAway } from '@penni/euro';
import { AlvKoodi, alvKoodilla } from '../alv/koodit.js';
import { normalisoiMerkkaukset } from '../kohdennukset/kohdennus.js';
import { Maksutapa, VientiTyyppi } from '../vouchers/enums.js';
import { nettoYhteensaCents } from '../vouchers/rivi.js';
import type { IsoDate, TositeRivi, TositeVienti } from '../vouchers/types.js';

/** Resolved account numbers a sales invoice posts to. */
export interface LaskuTilit {
  saatava: number; // AR (LaskuSaatavaTili)
  kateinen: number; // cash (LaskuKateistili)
  kortti: number; // card (LaskuKorttitili)
  oletusMyynti: number; // default revenue account when rivi.tili unset (OletusMyyntitili)
  alvVelka: number; // VAT payable (AlvVelkaTili)
  kohdentamatonAlvVelka: number; // KOHDENTAMATONALVVELKA (maksuperusteinen deferral target)
}

export interface LaskunViennitSyote {
  rivit: TositeRivi[];
  maksutapa: number; // Maksutapa
  pvm: IsoDate;
  otsikko?: string; // becomes each vienti.selite
  tilit: LaskuTilit;
  maksuperusteinen?: boolean; // defer VAT to the holding account (cash-basis)
}

interface TiliKertyma {
  tili: number;
  kohdennus: number;
  merkkaukset: number[] | undefined;
  alvKoodi: number;
  alvProsentti: number;
  netto: number; // cents
}
interface VeroKertyma {
  alvKoodi: number;
  alvProsentti: number;
  netto: number; // cents
}

/**
 * Turn invoice rows into the balanced three-leg posting (RiviVientiGeneroija standard flow):
 * one receivable/cash debit, one revenue credit per (tili,kohdennus,code,rate,tags) bucket, and one
 * VAT credit per (MYYNNIT_NETTO,rate) bucket. Zero-rated codes emit no VAT leg (gross = net).
 * Single rounding boundary: VAT = roundHalfAway(Σnet × rate / 100) per rate bucket.
 */
export function generoiLaskunViennit(s: LaskunViennitSyote): TositeVienti[] {
  const { rivit, maksutapa, pvm, otsikko, tilit, maksuperusteinen } = s;

  const tiliKertymat = new Map<string, TiliKertyma>();
  const veroKertymat = new Map<string, VeroKertyma>();

  for (const r of rivit) {
    const netto = nettoYhteensaCents(r) as number;
    if (netto === 0) continue;
    const tili = r.tili ?? tilit.oletusMyynti;
    const kohdennus = r.kohdennus ?? 0;
    const merkkaukset = normalisoiMerkkaukset(r.merkkaukset);
    // Merkkaukset ryhmittelyavaimeen (rivivientigeneroija.cpp:162-237); normalisoitu lista, joten järjestys ei erota.
    const tiliAvain = `${tili}/${kohdennus}/${r.alvKoodi}/${r.alvProsentti}/${(merkkaukset ?? []).join(',')}`;
    const tk = tiliKertymat.get(tiliAvain);
    if (tk) tk.netto += netto;
    else
      tiliKertymat.set(tiliAvain, {
        tili,
        kohdennus,
        merkkaukset,
        alvKoodi: r.alvKoodi,
        alvProsentti: r.alvProsentti,
        netto,
      });

    const veroAvain = `${r.alvKoodi}/${r.alvProsentti}`;
    const vk = veroKertymat.get(veroAvain);
    if (vk) vk.netto += netto;
    else veroKertymat.set(veroAvain, { alvKoodi: r.alvKoodi, alvProsentti: r.alvProsentti, netto });
  }

  const selite = otsikko;
  const tuloViennit: TositeVienti[] = [];
  let nettoYhteensa = 0;
  for (const k of tiliKertymat.values()) {
    nettoYhteensa += k.netto;
    const v: TositeVienti = {
      tili: k.tili,
      debet: 0 as Cents,
      kredit: k.netto as Cents,
      pvm,
      alvKoodi:
        maksuperusteinen && k.alvKoodi === AlvKoodi.MYYNNIT_NETTO
          ? AlvKoodi.MAKSUPERUSTEINEN_MYYNTI
          : k.alvKoodi,
      alvProsentti: k.alvProsentti,
      tyyppi: VientiTyyppi.MYYNTI + VientiTyyppi.KIRJAUS,
    };
    if (k.kohdennus) v.kohdennus = k.kohdennus;
    if (k.merkkaukset) v.merkkaukset = [...k.merkkaukset];
    if (selite) v.selite = selite;
    tuloViennit.push(v);
  }

  const veroViennit: TositeVienti[] = [];
  let veroYhteensa = 0;
  for (const b of veroKertymat.values()) {
    if (b.alvKoodi !== AlvKoodi.MYYNNIT_NETTO) continue; // zero-rated / non-net codes: no VAT leg
    const vero = roundHalfAway((b.netto * b.alvProsentti) / 100) as number;
    if (vero === 0) continue;
    veroYhteensa += vero;
    const v: TositeVienti = {
      tili: maksuperusteinen ? tilit.kohdentamatonAlvVelka : tilit.alvVelka,
      debet: 0 as Cents,
      kredit: vero as Cents,
      pvm,
      alvKoodi: maksuperusteinen
        ? alvKoodilla(AlvKoodi.MAKSUPERUSTEINEN_MYYNTI, AlvKoodi.MAKSUPERUSTEINEN_KOHDENTAMATON)
        : alvKoodilla(AlvKoodi.MYYNNIT_NETTO, AlvKoodi.ALVKIRJAUS),
      alvProsentti: b.alvProsentti,
      tyyppi: VientiTyyppi.MYYNTI + VientiTyyppi.ALVKIRJAUS,
    };
    if (selite) v.selite = selite;
    veroViennit.push(v);
  }

  const vastatili =
    maksutapa === Maksutapa.KATEINEN
      ? tilit.kateinen
      : maksutapa === Maksutapa.KORTTIMAKSU
        ? tilit.kortti
        : tilit.saatava;
  const vastavienti: TositeVienti = {
    tili: vastatili,
    debet: (nettoYhteensa + veroYhteensa) as Cents,
    kredit: 0 as Cents,
    pvm,
    alvKoodi: 0,
    alvProsentti: 0,
    tyyppi: VientiTyyppi.MYYNTI + VientiTyyppi.VASTAKIRJAUS,
  };
  if (selite) vastavienti.selite = selite;
  // Erä asetetaan resurssikerroksessa (tallennaMyyntilasku), kun tosite.id on tiedossa.

  return [vastavienti, ...tuloViennit, ...veroViennit];
}
