const PAINOT = [7, 9, 10, 5, 8, 4, 2] as const;

/**
 * Suomalaisen Y-tunnuksen mod-11-tarkiste (ytunnusvalidator.cpp:32-91).
 * Hyväksyy muodon 'NNNNNNN-T' tai 'NNNNNNNT'. Painot 7,9,10,5,8,4,2 seitsemälle etunumerolle;
 * jaannos = summa % 11; jaannos===1 -> kelvoton; jaannos===0 -> tarkiste oltava 0; muuten tarkiste = 11 - jaannos.
 */
export function tarkistaYtunnus(ytunnus: string): boolean {
  const s = ytunnus.replace(/-/g, '');
  if (!/^\d{8}$/.test(s)) return false;
  let summa = 0;
  for (let i = 0; i < 7; i++) summa += (PAINOT[i] as number) * (s.charCodeAt(i) - 48);
  const jaannos = summa % 11;
  if (jaannos === 1) return false;
  const tarkiste = jaannos === 0 ? 0 : 11 - jaannos;
  return tarkiste === s.charCodeAt(7) - 48;
}

/** Normalisoi muotoon 'NNNNNNN-T' (viiva ennen viimeistä numeroa). */
export function muotoileYtunnus(ytunnus: string): string {
  const s = ytunnus.replace(/-/g, '');
  if (s.length !== 8) return ytunnus;
  return `${s.slice(0, 7)}-${s.slice(7)}`;
}
