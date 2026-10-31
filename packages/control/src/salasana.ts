import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt-parametrit (128*N*r*p ≈ 16 MB < oletus maxmem 32 MB).
const N = 16384;
const R = 8;
const P = 1;
const AVAINPITUUS = 64;

/** Tiivistä salasana per-käyttäjä-suolalla. Muoto: `scrypt$N$r$p$<suola-b64>$<tiiviste-b64>`. */
export async function hashaaSalasana(selko: string): Promise<string> {
  const suola = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(selko, suola, AVAINPITUUS, { N, r: R, p: P }, (err, tiiviste) => {
      if (err) reject(err);
      else
        resolve(`scrypt$${N}$${R}$${P}$${suola.toString('base64')}$${tiiviste.toString('base64')}`);
    });
  });
}

/** Vakioaikainen vertailu jäsennetyillä parametreilla. false muodottomalle syötteelle. */
export async function tarkistaSalasana(selko: string, koodattu: string): Promise<boolean> {
  const osat = koodattu.split('$');
  if (osat.length !== 6 || osat[0] !== 'scrypt') return false;
  const n = Number(osat[1]);
  const r = Number(osat[2]);
  const p = Number(osat[3]);
  const suola = Buffer.from(osat[4] ?? '', 'base64');
  const odotettu = Buffer.from(osat[5] ?? '', 'base64');
  if (odotettu.length === 0) return false;
  return new Promise((resolve) => {
    scrypt(selko, suola, odotettu.length, { N: n, r, p }, (err, tiiviste) => {
      if (err) resolve(false);
      else {
        try {
          resolve(tiiviste.length === odotettu.length && timingSafeEqual(tiiviste, odotettu));
        } catch {
          resolve(false);
        }
      }
    });
  });
}
