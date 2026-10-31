/** A voucher attachment (receipt/PDF/image), stored as a blob against a tosite. */
export interface Liite {
  id: number;
  tosite: number;
  nimi: string;
  roolinimi?: string; // named slot => unique per voucher + upsert-replace; absent => many allowed
  tyyppi: string; // MIME type
  sha?: string; // hex SHA-256 of data; archival checksum (not verified on read)
  luotu: string; // ISO timestamp, caller-supplied
  data: Uint8Array;
}
/** Metadata without the blob — what list/save-result return. */
export type LiiteMeta = Omit<Liite, 'data'>;
/** New/updated attachment input; id present => update, absent => insert (see upsert rule). */
export type UusiLiite = Omit<Liite, 'id'> & { id?: number };
