const AVAIN = 'penni.token';

export function lueToken(): string | null {
  return localStorage.getItem(AVAIN);
}
export function tallennaToken(token: string): void {
  localStorage.setItem(AVAIN, token);
}
export function tyhjennaToken(): void {
  localStorage.removeItem(AVAIN);
}
