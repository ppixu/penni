import {
  type IsoDate,
  type Tili,
  alvKannat,
  keskimainenAlv,
  veroTyyppi,
  yleinenAlv,
} from '@penni/engine';

/**
 * Rivin syöttöperuste alv-koodille. Käänteisen verovelvollisuuden koodeilla (yhteisöhankinnat
 * 24/25, rakennuspalveluosto 26, palveluostot EU:n ulkopuolelta 29) syötetty summa on aina
 * veroton ostohinta: vero lisätään sekä alv-velaksi että -saatavaksi, eikä se sisälly
 * maksettuun summaan (vrt. tiliote/kuittiTosite.ts). Muilla koodeilla summa on brutto.
 */
export function bruttoSyottoKoodille(alvKoodi: number): boolean {
  return !(veroTyyppi(alvKoodi)?.kaanteinen ?? false);
}

const KESKIMMAISET = new Set([14, 13.5]);

/**
 * Tilin alv-oletus (tilin json `alvlaji` + `alvprosentti`) riville annettuna päivänä.
 * Kitsas esitäyttää rivin tilin oletuksesta (model/tositeviennit.cpp:292-303) ja korvaa
 * vanhentuneen kannan päivän kannalla (24 -> yleinenAlv, 14 -> keskimainenAlv). Tässä
 * sama yleistettynä: kanta, joka ei ole päivänä voimassa, vaihtuu päivän keskimmäiseen
 * kantaan jos se oli keskimmäinen (14 / 13,5), muuten päivän yleiseen kantaan.
 * Tuntematon tai puuttuva verolaji -> veroton (0, 0).
 */
export function tilinAlvOletus(
  tili: Tili,
  pvm: IsoDate,
): { alvKoodi: number; alvProsentti: number } {
  const alvKoodi = Number(tili.data.alvlaji) || 0;
  const tyyppi = veroTyyppi(alvKoodi);
  if (alvKoodi === 0 || !tyyppi) return { alvKoodi: 0, alvProsentti: 0 };
  if (tyyppi.nollalaji) return { alvKoodi, alvProsentti: 0 };
  const prosentti = Number(tili.data.alvprosentti) || 0;
  if (alvKannat(pvm).includes(prosentti)) return { alvKoodi, alvProsentti: prosentti };
  return {
    alvKoodi,
    alvProsentti: KESKIMMAISET.has(prosentti) ? keskimainenAlv(pvm) : yleinenAlv(pvm),
  };
}
