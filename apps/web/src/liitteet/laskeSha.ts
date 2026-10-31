/** SHA-256 heksana Web Cryptolla (selain + Node 22). Arkistollinen tarkiste liitteille. */
export async function laskeSha(tavut: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(tavut));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
