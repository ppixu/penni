import type { Cents } from '@penni/euro';
import { AlvKoodi } from '../alv/koodit.js';
import type { Kumppani } from '../partners/kumppani.js';
import type { IsoDate } from '../vouchers/types.js';
import type { AlvLaskelmaParams } from './alvLaskelma.js';
import type { Storage } from './storage.js';

export interface EuMyyntiRivi {
  kumppani: number;
  nimi: string;
  alvtunnus?: string;
  maa?: string;
  tavara: Cents; // yhteisömyynti tavarat (alvKoodi 14)
  palvelu: Cents; // yhteisömyynti palvelut (alvKoodi 15)
}

export interface EuMyyntiYhteenveto {
  alkupvm: IsoDate;
  loppupvm: IsoDate;
  /** Vain kumppanit joilla nollasta poikkeava yhteisömyynti; lajiteltu nimellä. */
  rivit: EuMyyntiRivi[];
  /** true jos joltakin listalla olevalta kumppanilta puuttuu alv-tunnus (ei voi ilmoittaa). */
  puuttuviaTunnuksia: boolean;
}

/**
 * Kokoa yhteisömyynnin yhteenvetoilmoitus: summaa kirjatut (tila >= 100) yhteisömyyntiviennit
 * (alvKoodi 14 tavarat / 15 palvelut, nollalaji, luottopainotteinen kredit−debet) kumppaneittain
 * ja liitä alv-tunnus/maa. Puhdas luku, ei kirjauksia. (Legacy aggregoi tämän pilvessä — porttia
 * ei ole, joten logiikka on suunniteltu uusiksi; data on kuitenkin jo olemassa.)
 */
export async function haeEuMyyntiYhteenveto(
  storage: Storage,
  params: AlvLaskelmaParams,
): Promise<EuMyyntiYhteenveto> {
  // Kausi rajataan vientipäivän (v.pvm) mukaan, EI tositepäivän mukaan — sama peruste kuin
  // haeAlvLaskelma (listViennit{alkupvm,loppupvm}). Näin EU-myyntilistan ja alv-ilmoituksen
  // koodien 311/312 summat täsmäävät myös sekapäiväisillä tositteilla. Siksi haetaan kaikki
  // kirjatut tositteet ja suodatetaan jokainen vienti erikseen sen omalla pvm:llä.
  const tositteet = await storage.listTositteet({ bucket: 'kirjanpidossa' });
  const summat = new Map<number, { tavara: number; palvelu: number }>();
  for (const t of tositteet) {
    if (t.kumppani == null) continue;
    for (const v of t.viennit) {
      if (v.pvm < params.alkupvm || v.pvm > params.loppupvm) continue; // sama vientipäiväperuste kuin alv-laskelmassa
      const sivu = v.kredit - v.debet; // nollalaji-myynti on luottopainotteinen
      if (v.alvKoodi === AlvKoodi.YHTEISOMYYNTI_TAVARAT) {
        const s = summat.get(t.kumppani) ?? { tavara: 0, palvelu: 0 };
        s.tavara += sivu;
        summat.set(t.kumppani, s);
      } else if (v.alvKoodi === AlvKoodi.YHTEISOMYYNTI_PALVELUT) {
        const s = summat.get(t.kumppani) ?? { tavara: 0, palvelu: 0 };
        s.palvelu += sivu;
        summat.set(t.kumppani, s);
      }
    }
  }

  const kumppanit = new Map<number, Kumppani>((await storage.getKumppanit()).map((k) => [k.id, k]));
  const rivit: EuMyyntiRivi[] = [];
  for (const [kumppani, s] of summat) {
    if (s.tavara === 0 && s.palvelu === 0) continue;
    const k = kumppanit.get(kumppani);
    const rivi: EuMyyntiRivi = {
      kumppani,
      nimi: k?.nimi ?? String(kumppani),
      tavara: s.tavara as Cents,
      palvelu: s.palvelu as Cents,
    };
    if (k?.alvtunnus) rivi.alvtunnus = k.alvtunnus; // tyhjä merkkijono lasketaan puuttuvaksi
    if (k?.maa !== undefined) rivi.maa = k.maa;
    rivit.push(rivi);
  }
  rivit.sort((a, b) => (a.nimi < b.nimi ? -1 : a.nimi > b.nimi ? 1 : 0));
  const puuttuviaTunnuksia = rivit.some((r) => !r.alvtunnus);

  return { alkupvm: params.alkupvm, loppupvm: params.loppupvm, rivit, puuttuviaTunnuksia };
}
