/**
 * Isomorfinen base64 Uint8Array <-> merkkijono (btoa/atob löytyvät selaimesta ja Node 22:sta;
 * ei Bufferia, jotta toimii myös selain-HttpClientissä). Pilviväylä (ts-rest JSON) kuljettaa
 * liitteen datan base64-merkkijonona, in-process-väylä käyttää raakaa Uint8Arrayta.
 */
const PALA = 0x8000; // pilko fromCharCode-kutsu, jottei iso taulukko ylitä argumenttirajaa

export function bytesToBase64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += PALA) {
    s += String.fromCharCode(...u8.subarray(i, i + PALA));
  }
  return btoa(s);
}

export function base64ToBytes(s: string): Uint8Array {
  const merkit = atob(s);
  const u8 = new Uint8Array(merkit.length);
  for (let i = 0; i < merkit.length; i++) u8[i] = merkit.charCodeAt(i);
  return u8;
}
