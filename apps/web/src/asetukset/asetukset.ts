import type { Tilikausi } from '@penni/engine';

/** Pura 'YYYY-MM-DD' kokonaislukukentiksi (vuosi, kuukausi 1–12, päivä). */
function puraIso(iso: string): { v: number; k: number; p: number } {
  return { v: Number(iso.slice(0, 4)), k: Number(iso.slice(5, 7)), p: Number(iso.slice(8, 10)) };
}

/** Muotoile UTC-aikaleima takaisin 'YYYY-MM-DD'-muotoon (ei aikavyöhykeriippuvuutta). */
function isoUtc(ms: number): string {
  // toISOString antaa aina 'YYYY-MM-DDT...'; otetaan päiväosa.
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Laske seuraava tilikausi (lisäys loppuun). alkaa = päivä viimeisen kauden loppumisen jälkeen,
 * loppuu = alkaa + 12 kuukautta − 1 päivä. Kaikki Date.UTC-pohjaista kokonaislukulaskentaa
 * (ei liukulukuja, ei paikallista aikavyöhykettä).
 */
export function seuraavaKausi(viimeinen: Tilikausi): { alkaa: string; loppuu: string } {
  const { v, k, p } = puraIso(viimeinen.loppuu);
  // alkaa = loppuu + 1 päivä (UTC normalisoi kuukauden/vuoden vaihteen automaattisesti).
  const alkaaMs = Date.UTC(v, k - 1, p + 1);
  const alkaa = isoUtc(alkaaMs);
  const a = puraIso(alkaa);
  // loppuu = alkaa + 12 kuukautta − 1 päivä (Date.UTC normalisoi joulukuun yli).
  const loppuuMs = Date.UTC(a.v + 1, a.k - 1, a.p - 1);
  const loppuu = isoUtc(loppuuMs);
  return { alkaa, loppuu };
}
