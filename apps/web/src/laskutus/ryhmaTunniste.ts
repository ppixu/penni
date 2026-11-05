type CryptoOsa = Partial<Pick<Crypto, 'randomUUID' | 'getRandomValues'>>;

/**
 * Ryhmälaskun `ryhma`-merkintä (UUID v4). `crypto.randomUUID` on olemassa vain suojatussa
 * yhteydessä (https tai localhost); itse ylläpidetty palvelin lähiverkon http-osoitteessa ei sitä
 * tarjoa, joten tunniste muodostetaan silloin `getRandomValues`illa (saatavilla aina) ja viimeisenä
 * keinona Math.randomilla. Tunniste vain ryhmittelee luonnokset, se ei ole turvallisuustunniste.
 */
export function uusiRyhmaTunniste(c: CryptoOsa | null = globalThis.crypto ?? null): string {
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const tavut = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(tavut);
  else for (let i = 0; i < tavut.length; i++) tavut[i] = Math.floor(Math.random() * 256);
  tavut[6] = ((tavut[6] ?? 0) & 0x0f) | 0x40; // versio 4
  tavut[8] = ((tavut[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 -variantti
  const hex = Array.from(tavut, (t) => t.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
