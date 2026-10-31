/** Integer euro-cents. Branded so a raw number can't masquerade as money. */
export type Cents = number & { readonly __euro: unique symbol };

/** Round half away from zero (mirrors Qt's qRound64 used by Kitsas). */
export function roundHalfAway(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x)) || 0;
}

export class EuroParseError extends Error {
  constructor(input: string) {
    super(`Not a valid euro amount: ${JSON.stringify(input)}`);
    this.name = 'EuroParseError';
  }
}

export const Euro = {
  fromCents(n: number): Cents {
    return Math.trunc(n) as Cents;
  },

  /** Canonical wire/storage form "N.NN" (dot decimal, two cent digits). */
  toString(c: Cents): string {
    const sign = c < 0 ? '-' : '';
    const a = Math.abs(c);
    const euros = Math.trunc(a / 100);
    const cents = a % 100;
    return `${sign}${euros}.${String(cents).padStart(2, '0')}`;
  },

  /**
   * Parse a money string. Comma or dot decimal; internal whitespace ignored;
   * optional single leading +/-; >2 decimals rounded half away from zero;
   * empty -> 0; otherwise throws EuroParseError.
   */
  fromString(s: string): Cents {
    let t = s.trim();
    if (t === '') return 0 as Cents;
    let sign = 1;
    if (t.startsWith('+')) t = t.slice(1);
    else if (t.startsWith('-')) {
      sign = -1;
      t = t.slice(1);
    }
    t = t.replace(/\s/g, '').replace(',', '.');
    if (t === '' || t === '.' || !/^\d*\.?\d*$/.test(t)) throw new EuroParseError(s);
    const [intPart = '', fracPart = ''] = t.split('.');
    const whole = (intPart === '' ? 0 : Number.parseInt(intPart, 10)) * 100;
    let fracCents = Number.parseInt(fracPart.slice(0, 2).padEnd(2, '0'), 10);
    if (fracPart.length > 2 && fracPart.charCodeAt(2) >= 53 /* '5' */) fracCents += 1;
    return (sign * (whole + fracCents) || 0) as Cents;
  },

  add(x: Cents, y: Cents): Cents {
    return (x + y) as Cents;
  },
  sub(x: Cents, y: Cents): Cents {
    return (x - y) as Cents;
  },
  neg(x: Cents): Cents {
    return -x as Cents;
  },
  abs(x: Cents): Cents {
    return Math.abs(x) as Cents;
  },
  compare(x: Cents, y: Cents): number {
    return x < y ? -1 : x > y ? 1 : 0;
  },
  equals(x: Cents, y: Cents): boolean {
    return x === y;
  },

  /** Multiply cents by a floating-point rate (e.g. VAT, exchange rate), rounding half away from zero. */
  mulRate(c: Cents, rate: number): Cents {
    return roundHalfAway(c * rate) as Cents;
  },
};
