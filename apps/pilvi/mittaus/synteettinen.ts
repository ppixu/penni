import { createHash } from 'node:crypto';
import { InProcessClient } from '@penni/asiakas';
import type { TositeSyote } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { createSqliteStorage } from '@penni/storage-sqlite';
import { oletusSiemen } from '../src/siemen.js';
import { satunnainen } from './tilasto.js';

export interface SynteettinenAsetukset {
  /** Kirjattujen tositteiden määrä (jaettu kahdelle tilikaudelle). */
  tositteita: number;
  /** Kuinka monelle tositteelle liitetään kuitti-PDF. */
  liitteita: number;
  /** Liitteen koko tavuina [min, max]. */
  liiteKoko: [number, number];
  siemen?: number;
}

export const OLETUS_SYNTEETTINEN: SynteettinenAsetukset = {
  tositteita: 3000,
  liitteita: 150,
  liiteKoko: [20_000, 200_000],
};

export interface SynteettinenTulos {
  tositteita: number;
  liitteita: number;
  liiteTavut: number;
}

const c = (n: number): Cents => n as Cents;
const kaudet = [
  { alkaa: '2025-01-01', loppuu: '2025-12-31' },
  { alkaa: '2026-01-01', loppuu: '2026-12-31' },
];

/** Toistettava PDF:n näköinen hyötykuorma (otsikko + pseudosatunnaiset tavut). */
export function pdfKuorma(tavuja: number, siemen: number): Uint8Array {
  const data = new Uint8Array(tavuja);
  const rnd = satunnainen(siemen);
  for (let i = 0; i < tavuja; i++) data[i] = Math.floor(rnd() * 256);
  data.set(new TextEncoder().encode('%PDF-1.7\n% synteettinen kuitti\n'), 0);
  data.set(new TextEncoder().encode('\n%%EOF\n'), tavuja - 7);
  return data;
}

export const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

function paiva(rnd: () => number, kausi: { alkaa: string; loppuu: string }): string {
  const alku = Date.parse(`${kausi.alkaa}T00:00:00Z`);
  const loppu = Date.parse(`${kausi.loppuu}T00:00:00Z`);
  return new Date(alku + Math.floor(rnd() * ((loppu - alku) / 86_400_000 + 1)) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Tilinumerot yritys-tilikartasta: pankki 1910, myynti 3000, ostot 4000, alv-velka 2939, alv-saatava 1763. */
export function syntVoucher(rnd: () => number, pvm: string, kumppani?: number): TositeSyote {
  const netto = Math.round((500 + rnd() * 200_000) / 10) * 10; // 5–2005 €, senttejä
  const laji = rnd();
  const kuuluu = kumppani !== undefined ? { kumppani } : {};
  const vero = Math.round(netto * 0.255);
  if (laji < 0.35) {
    return {
      pvm,
      tyyppi: 0,
      sarja: '',
      ...kuuluu,
      otsikko: 'Synteettinen myynti',
      viennit: [
        { tili: 1910, debet: c(netto + vero), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
        { tili: 3000, debet: c(0), kredit: c(netto), pvm, alvKoodi: 11, alvProsentti: 25.5 },
        { tili: 2939, debet: c(0), kredit: c(vero), pvm, alvKoodi: 111, alvProsentti: 25.5 },
      ],
    };
  }
  if (laji < 0.85) {
    return {
      pvm,
      tyyppi: 0,
      sarja: '',
      ...kuuluu,
      otsikko: 'Synteettinen osto',
      viennit: [
        { tili: 4000, debet: c(netto), kredit: c(0), pvm, alvKoodi: 21, alvProsentti: 25.5 },
        { tili: 1763, debet: c(vero), kredit: c(0), pvm, alvKoodi: 221, alvProsentti: 25.5 },
        { tili: 1910, debet: c(0), kredit: c(netto + vero), pvm, alvKoodi: 0, alvProsentti: 0 },
      ],
    };
  }
  return {
    pvm,
    tyyppi: 0,
    sarja: '',
    ...kuuluu,
    otsikko: 'Synteettinen kulu ilman alv:tä',
    viennit: [
      { tili: 4010, debet: c(netto), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
      { tili: 1910, debet: c(0), kredit: c(netto), pvm, alvKoodi: 0, alvProsentti: 0 },
    ],
  };
}

/**
 * Rakenna synteettinen `.penni`-kirja (tilikaudet 2025 ja 2026, yritys-tilikartta ja raporttipohjat,
 * ostoja/myyntejä alv:llä, kumppaneita ja kuitti-PDF-liitteitä) todellisen kirjan sijaan. Käyttää
 * samaa Storage-polkua kuin sovellus (InProcessClient → SQLite), joten skeema ja rivit ovat aitoja.
 * Ei sisällä mitään todellista dataa: nimet "Testi Oy N", summat satunnaisia.
 */
export async function luoSynteettinenKirja(
  tiedosto: string,
  a: SynteettinenAsetukset = OLETUS_SYNTEETTINEN,
): Promise<SynteettinenTulos> {
  const rnd = satunnainen(a.siemen ?? 20261010);
  const storage = createSqliteStorage(
    { ...oletusSiemen(new Date('2026-06-01T00:00:00Z')), tilikaudet: kaudet },
    { tiedosto },
  );
  try {
    let hetki = Date.parse('2026-01-01T08:00:00Z');
    // Kello etenee jokaisella kutsulla, jotta lokin aikaleimat ovat järjestyksessä.
    const seuraava = (): string => {
      hetki += 1000;
      return new Date(hetki).toISOString();
    };
    const client = new InProcessClient(storage, seuraava);
    const kumppanit: number[] = [];
    for (let i = 1; i <= 20; i++) {
      kumppanit.push((await client.tallennaKumppani({ nimi: `Testi Oy ${i}` })).id);
    }
    const tositeIdt: number[] = [];
    for (let i = 0; i < a.tositteita; i++) {
      const kausi = kaudet[i < a.tositteita / 2 ? 0 : 1] as (typeof kaudet)[number];
      const kumppani = kumppanit[Math.floor(rnd() * kumppanit.length)];
      const tosite = await client.luoTosite(syntVoucher(rnd, paiva(rnd, kausi), kumppani));
      tositeIdt.push(tosite.id);
    }
    let liiteTavut = 0;
    const liitteita = Math.min(a.liitteita, tositeIdt.length);
    for (let i = 0; i < liitteita; i++) {
      const koko = Math.floor(a.liiteKoko[0] + rnd() * (a.liiteKoko[1] - a.liiteKoko[0]));
      const data = pdfKuorma(koko, 1000 + i);
      await client.tallennaLiite({
        tosite: tositeIdt[Math.floor(rnd() * tositeIdt.length)] as number,
        nimi: `kuitti-${i + 1}.pdf`,
        tyyppi: 'application/pdf',
        sha: sha256(data),
        luotu: seuraava(),
        data,
      });
      liiteTavut += koko;
    }
    return { tositteita: a.tositteita, liitteita, liiteTavut };
  } finally {
    storage.close();
  }
}
