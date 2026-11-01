import type { Cents } from '@penni/euro';
import { Euro } from '@penni/euro';
import { Luonne } from '../accounts/luonne.js';
import { type Tili, tiliTyypilla } from '../accounts/tili.js';
import { normalisoiMerkkaukset } from '../kohdennukset/kohdennus.js';
import { ResourceError } from '../resources/storage.js';
import { VientiTyyppi } from '../vouchers/enums.js';
import type { IsoDate, TositeVienti } from '../vouchers/types.js';
import { bruttoNetosta, nettoBrutosta, veroBrutosta } from './kannat.js';
import { AlvKoodi, alvKoodilla, veroTyyppi } from './koodit.js';

/** One taxable base line to expand into base + VAT leg(s). */
export interface VerollinenRivi {
  tili: number;
  alvKoodi: number;
  alvProsentti: number;
  /** entered amount (interpreted per `bruttoSyotto`). */
  maara: Cents;
  /** true: `maara` is gross; false: net. */
  bruttoSyotto: boolean;
  /** where the base posting goes: income => 'kredit', expense => 'debet'. */
  puoli: 'debet' | 'kredit';
  pvm: IsoDate;
  /** reverse-charge deduction right; default true. */
  alvVahennys?: boolean;
  kohdennus?: number;
  merkkaukset?: number[];
  selite?: string;
}

const ZERO: Cents = Euro.fromCents(0);

/** Build a posting on the given side, other side zero. */
function vienti(
  tili: number,
  puoli: 'debet' | 'kredit',
  summa: Cents,
  pvm: IsoDate,
  alvKoodi: number,
  alvProsentti: number,
  tyyppi: number,
  rivi: VerollinenRivi,
): TositeVienti {
  const v: TositeVienti = {
    tili,
    debet: puoli === 'debet' ? summa : ZERO,
    kredit: puoli === 'kredit' ? summa : ZERO,
    pvm,
    alvKoodi,
    alvProsentti,
    tyyppi,
  };
  if (rivi.kohdennus !== undefined) v.kohdennus = rivi.kohdennus;
  const merkkaukset = normalisoiMerkkaukset(rivi.merkkaukset);
  if (merkkaukset) v.merkkaukset = merkkaukset;
  if (rivi.selite) v.selite = rivi.selite;
  return v;
}

/**
 * Expand taxable base lines into base + VAT legs. Verbatim port of
 * ApuriRivi::viennit (apuririvi.cpp:187-380). Pure; integer cents.
 * BRUTTO codes record gross with NO leg; nollalaji codes get no leg;
 * reverse-charge codes get output + (deductible | non-deductible) legs.
 */
export function generoiVeroviennit(
  rivit: readonly VerollinenRivi[],
  chart: readonly Tili[],
  maksuperusteinen = false,
): TositeVienti[] {
  const out: TositeVienti[] = [];
  for (const r of rivit) {
    const t = veroTyyppi(r.alvKoodi);
    const kaanteinen = t?.kaanteinen ?? false;
    const nollalaji = t?.nollalaji ?? r.alvKoodi === AlvKoodi.EIALV;
    const prosentti = nollalaji ? 0 : r.alvProsentti;
    const plusOnKredit = r.puoli === 'kredit';
    const alvVahennys = r.alvVahennys ?? true;
    const kanta = r.puoli === 'debet' ? VientiTyyppi.OSTO : VientiTyyppi.MYYNTI;

    // Marginaalivero: kirjataan koko summa ilman veroeriä; vero lasketaan kaudelta (kirjaaMarginaalivero).
    if (t?.marginaali) {
      out.push(
        vienti(
          r.tili,
          r.puoli,
          r.maara,
          r.pvm,
          r.alvKoodi,
          r.alvProsentti,
          kanta + VientiTyyppi.KIRJAUS,
          r,
        ),
      );
      continue;
    }

    // Maksuperusteisuus koskee vain kotimaan tavallista ostoa — ei käänteistä (M10).
    const rMaksuperusteinen = maksuperusteinen && r.alvKoodi === AlvKoodi.OSTOT_NETTO;
    const perusKoodi = rMaksuperusteinen ? AlvKoodi.MAKSUPERUSTEINEN_OSTO : r.alvKoodi;

    // Derive netto / brutto / vero from the entered amount (single rounding boundary).
    const brutto: Cents = r.bruttoSyotto ? r.maara : bruttoNetosta(r.maara, prosentti);
    const netto: Cents = r.bruttoSyotto ? nettoBrutosta(r.maara, prosentti) : r.maara;
    const vero: Cents = r.bruttoSyotto
      ? veroBrutosta(r.maara, prosentti)
      : ((brutto - netto) as Cents);

    // Base amount: net only for the netto & reverse-charge codes; else gross (brutto codes/EIALV/nollalaji).
    const nettoKirjaus =
      r.alvKoodi === AlvKoodi.MYYNNIT_NETTO || r.alvKoodi === AlvKoodi.OSTOT_NETTO || kaanteinen;
    const kirjattava: Cents = nettoKirjaus ? netto : brutto;

    out.push(
      vienti(
        r.tili,
        r.puoli,
        kirjattava,
        r.pvm,
        perusKoodi,
        prosentti,
        kanta + VientiTyyppi.KIRJAUS,
        r,
      ),
    );

    if (nollalaji) continue; // ALV0 / EIALV / EU-myynti / rakennus-myynti: no leg
    if (r.alvKoodi === AlvKoodi.MYYNNIT_BRUTTO || r.alvKoodi === AlvKoodi.OSTOT_BRUTTO) continue; // gross recording

    const alvVelka = tiliTyypilla(chart, Luonne.ALVVELKA);
    const alvSaatava = tiliTyypilla(chart, Luonne.ALVSAATAVA);

    // Deductible leg -> ALVSAATAVA (same side as base); maksuperusteisena kohdentamattomalle tilille.
    if ((r.alvKoodi === AlvKoodi.OSTOT_NETTO || kaanteinen) && alvVahennys) {
      if (rMaksuperusteinen) {
        const kohdentamaton = tiliTyypilla(chart, Luonne.KOHDENTAMATONALVSAATAVA);
        if (!kohdentamaton)
          throw new ResourceError(
            'EIKOHDENTAMATONTILIA',
            'Maksuperusteisen alv:n kohdentamaton saatavatili puuttuu tilikartasta',
          );
        out.push(
          vienti(
            kohdentamaton.numero,
            r.puoli,
            vero,
            r.pvm,
            alvKoodilla(AlvKoodi.MAKSUPERUSTEINEN_OSTO, AlvKoodi.MAKSUPERUSTEINEN_KOHDENTAMATON),
            prosentti,
            kanta + VientiTyyppi.ALVKIRJAUS,
            r,
          ),
        );
      } else {
        if (!alvSaatava)
          throw new ResourceError('EIALVTILIA', 'ALV-tiliä (saatava) ei löydy tilikartasta');
        out.push(
          vienti(
            alvSaatava.numero,
            r.puoli,
            vero,
            r.pvm,
            alvKoodilla(r.alvKoodi, AlvKoodi.ALVVAHENNYS),
            prosentti,
            kanta + VientiTyyppi.ALVKIRJAUS,
            r,
          ),
        );
      }
    }

    // Output leg -> ALVVELKA. Direction: (kaanteinen === plusOnKredit) ? debet : kredit.
    if (r.alvKoodi === AlvKoodi.MYYNNIT_NETTO || kaanteinen) {
      if (!alvVelka)
        throw new ResourceError('EIALVTILIA', 'ALV-tiliä (velka) ei löydy tilikartasta');
      const puoli = kaanteinen === plusOnKredit ? 'debet' : 'kredit';
      out.push(
        vienti(
          alvVelka.numero,
          puoli,
          vero,
          r.pvm,
          alvKoodilla(r.alvKoodi, AlvKoodi.ALVKIRJAUS),
          prosentti,
          kanta + VientiTyyppi.ALVKIRJAUS,
          r,
        ),
      );
    }

    // Reverse-charge without deduction right: capitalise VAT into the base account (same side as base).
    if (kaanteinen && !alvVahennys) {
      out.push(
        vienti(
          r.tili,
          r.puoli,
          vero,
          r.pvm,
          AlvKoodi.VAHENNYSKELVOTON,
          prosentti,
          kanta + VientiTyyppi.VAHENNYSKELVOTON,
          r,
        ),
      );
    }
  }
  return out;
}
