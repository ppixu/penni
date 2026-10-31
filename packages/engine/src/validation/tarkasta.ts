import { type Cents, Euro } from '@penni/euro';
import { Luonne, onko } from '../accounts/luonne.js';
import { type Tili, eritellaankoTase } from '../accounts/tili.js';
import { EIALV, TositeTyyppi } from '../vouchers/enums.js';
import { type IsoDate, type Tosite, onkoPvmValidi } from '../vouchers/types.js';

export type Severity = 'block' | 'warn' | 'confirm';

export type VirheKoodi =
  | 'PVMPUUTTUU'
  | 'PVMLUKITTU'
  | 'PVMALV'
  | 'EITASMAA'
  | 'TILIPUUTTUU'
  | 'EIAVOINTAKUTTA'
  | 'EITASMAAPVM'
  | 'ALVITON_ALVKIRJAUS'
  | 'ERA_ILMAN_ERITTELYA';

export interface Violation {
  code: VirheKoodi;
  severity: Severity;
}

export interface ValidationContext {
  kausiAlkaa: IsoDate;
  kausiLoppuu: IsoDate;
  tilitPaatetty: IsoDate | null;
  chart: readonly Tili[];
  /** Tier-0: () => false. Tier-1 wires real reported-VAT-period data. */
  onkoAlvIlmoitettu: (pvm: IsoDate) => boolean;
  /** Tier-0: static settings flag. */
  onkoAlvVelvollinen: (pvm: IsoDate) => boolean;
}

const SEVERITY: Record<VirheKoodi, Severity> = {
  PVMPUUTTUU: 'block',
  PVMLUKITTU: 'block',
  PVMALV: 'block',
  EITASMAA: 'block',
  TILIPUUTTUU: 'block',
  EIAVOINTAKUTTA: 'block',
  EITASMAAPVM: 'warn',
  ALVITON_ALVKIRJAUS: 'confirm',
  ERA_ILMAN_ERITTELYA: 'confirm',
};

// Deterministic emission order.
const ORDER: VirheKoodi[] = [
  'PVMPUUTTUU',
  'EIAVOINTAKUTTA',
  'PVMLUKITTU',
  'TILIPUUTTUU',
  'PVMALV',
  'EITASMAA',
  'EITASMAAPVM',
  'ALVITON_ALVKIRJAUS',
  'ERA_ILMAN_ERITTELYA',
];

/**
 * Validate a voucher. Pure function: returns one Violation per distinct code.
 * Mirrors Tosite::tarkasta (tosite.cpp:445-521) for the flag set plus the
 * interactive confirm guards from Tosite::tallenna (tosite.cpp:398-420).
 */
export function tarkasta(t: Tosite, ctx: ValidationContext): Violation[] {
  const flags = new Set<VirheKoodi>();

  // Voucher-level date checks (tosite.cpp:465-471).
  if (!onkoPvmValidi(t.pvm)) flags.add('PVMPUUTTUU');
  if (t.pvm < ctx.kausiAlkaa || t.pvm > ctx.kausiLoppuu) flags.add('EIAVOINTAKUTTA');
  else if (ctx.tilitPaatetty !== null && t.pvm <= ctx.tilitPaatetty) flags.add('PVMLUKITTU');

  let debet = Euro.fromCents(0);
  let kredit = Euro.fromCents(0);
  const perPvm = new Map<IsoDate, Cents>();

  for (const v of t.viennit) {
    debet = Euro.add(debet, v.debet);
    kredit = Euro.add(kredit, v.kredit);

    const tili = ctx.chart.find((a) => a.numero === v.tili);
    if (!tili && (v.debet !== 0 || v.kredit !== 0)) flags.add('TILIPUUTTUU');

    if (v.alvKoodi && ctx.onkoAlvIlmoitettu(v.pvm) && t.tyyppi !== TositeTyyppi.ALVLASKELMA)
      flags.add('PVMALV');

    if (!onkoPvmValidi(v.pvm)) flags.add('PVMPUUTTUU');
    if (v.pvm < ctx.kausiAlkaa || v.pvm > ctx.kausiLoppuu) flags.add('EIAVOINTAKUTTA');
    else if (ctx.tilitPaatetty !== null && v.pvm <= ctx.tilitPaatetty) flags.add('PVMLUKITTU');

    // Per-posting-date running balance (tosite.cpp:498-500).
    const prev = perPvm.get(v.pvm) ?? Euro.fromCents(0);
    perPvm.set(v.pvm, Euro.sub(Euro.add(prev, v.debet), v.kredit));

    // Confirm guards (tosite.cpp:398-420).
    if (!ctx.onkoAlvVelvollinen(v.pvm) && (v.alvKoodi !== EIALV || v.alvProsentti > 0)) {
      flags.add('ALVITON_ALVKIRJAUS');
    }
    // C++ vienti.eraId() returns 0 when there is no era (key absent OR id 0);
    // the guard only fires for a non-zero era id, so treat era 0 as "no era".
    if (
      tili &&
      v.era !== undefined &&
      v.era !== 0 &&
      !eritellaankoTase(tili) &&
      !onko(tili.luonne, Luonne.KOHDENTAMATONALVVELKA) &&
      !onko(tili.luonne, Luonne.KOHDENTAMATONALVSAATAVA)
    ) {
      flags.add('ERA_ILMAN_ERITTELYA');
    }
  }

  // Overall balance — TILINAVAUS is exempt (tosite.cpp:424).
  if (!Euro.equals(debet, kredit) && t.tyyppi !== TositeTyyppi.TILINAVAUS) flags.add('EITASMAA');

  // Per-date balance (tosite.cpp:507-515).
  for (const saldo of perPvm.values()) {
    if (saldo !== 0) {
      flags.add('EITASMAAPVM');
      break;
    }
  }

  return ORDER.filter((code) => flags.has(code)).map((code) => ({
    code,
    severity: SEVERITY[code],
  }));
}

/**
 * The finalize rule (kirjauswg.cpp:522-523, primary clause `!(virheet & ~EITASMAAPVM)`):
 * a voucher may move to tila >= KIRJANPIDOSSA iff no block-severity violation is present.
 * EITASMAAPVM (warn) is permitted; confirm-severity violations are resolved interactively
 * by the resource/UI layer, not by this rule. (PVMALV/TILIOTE overrides: deferred.)
 */
export function voiValmistua(violations: readonly Violation[]): boolean {
  return !violations.some((v) => v.severity === 'block');
}
