/** A business partner (customer/supplier). id assigned on first save. */
export interface Kumppani {
  id: number;
  nimi: string;
  alvtunnus?: string; // VAT id; Finnish = "FI" + ytunnus (dashes stripped)
  maa?: string; // ISO country, legacy default "fi"
  osoite?: string; // street address (may be multiline)
  postinumero?: string;
  kaupunki?: string;
  email?: string;
  puhelin?: string;
  kieli?: string; // "fi" | "sv" | "en"
  iban?: string[]; // 0+ IBANs (legacy child table, stored inline here)
  [avain: string]: unknown; // Unmapped Kitsas keys round-trip verbatim
}

/**
 * New/updated partner input; id present => update, absent => insert.
 * Spelled out explicitly rather than derived via Omit to preserve all named properties.
 * (Omit<Kumppani,'id'> would drop every named property due to the index signature.)
 */
export interface UusiKumppani {
  id?: number;
  nimi: string;
  alvtunnus?: string; // VAT id; Finnish = "FI" + ytunnus (dashes stripped)
  maa?: string; // ISO country, legacy default "fi"
  osoite?: string; // street address (may be multiline)
  postinumero?: string;
  kaupunki?: string;
  email?: string;
  puhelin?: string;
  kieli?: string; // "fi" | "sv" | "en"
  iban?: string[]; // 0+ IBANs (legacy child table, stored inline here)
  [avain: string]: unknown; // Unmapped Kitsas keys round-trip verbatim
}
