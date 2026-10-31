import { Luonne } from '../accounts/luonne.js';
import { tiliTyypilla } from '../accounts/tili.js';
import { TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import type { IsoDate, TositeVienti } from '../vouchers/types.js';
import { tunnistaVeroVienti } from './maksuperusteinenTunnistus.js';
import { type ResourceEnv, ResourceError, type Storage, type StoredTosite } from './storage.js';
import { tallennaTosite } from './tositeResource.js';

export interface VanhennusSyote {
  loppupvm: IsoDate;
}

/** loppupvm miinus n vuotta ISO-merkkijonona (Date normalisoi karkauspäivät). */
function vuosiaEteen(pvm: IsoDate, vuodet: number): IsoDate {
  const d = new Date(`${pvm}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + vuodet);
  return d.toISOString().slice(0, 10) as IsoDate;
}

/**
 * Vanhentaa maksuperusteisen alv:n: kirjaa vielä lykätyn veron oikealle alv-tilille kun lasku on
 * maksamatta yli 12 kk (myyntipuoli) tai kun maksuperusteisuus on päättynyt (MaksuAlvLoppuu, molemmat
 * puolet). Kirjaus tehdään yhteen JARJESTELMATOSITE-tositteeseen loppupvm:lle; idempotenssi tulee
 * tunnistusrivien maksuperusteinenTosite-linkistä (alkuperäistä laskua EI muokata — se voi olla
 * lukitulla kaudella). Legacy: AlvLaskelma::tilaaNollausLista / nollaaMaksuperusteinenEra.
 */
export async function vanhennaMaksuperusteinenAlv(
  storage: Storage,
  syote: VanhennusSyote,
  env: ResourceEnv,
): Promise<StoredTosite | null> {
  const asetukset = await storage.getAsetukset();
  if (asetukset.MaksuAlvAlkaa == null || asetukset.MaksuAlvAlkaa === '')
    throw new ResourceError('EIMAKSUPERUSTEINEN', 'Kirjanpito ei ole maksuperusteinen');

  const chart = await storage.getChart();
  const alvVelka = tiliTyypilla(chart, Luonne.ALVVELKA);
  const alvSaatava = tiliTyypilla(chart, Luonne.ALVSAATAVA);
  const eraMap = await storage.queryErat({});
  const tositteet = await storage.listTositteet({ bucket: 'kirjanpidossa' });

  // Jo vanhennetut laskut = ne joihin jokin kirjattu rivi linkittää.
  const joVanhennetut = new Set<number>();
  for (const t of tositteet)
    for (const v of t.viennit)
      if (v.maksuperusteinenTosite != null) joVanhennetut.add(v.maksuperusteinenTosite);

  const loppuu = asetukset.MaksuAlvLoppuu;
  const lopetettu = loppuu != null && loppuu !== '' && loppuu <= syote.loppupvm;
  const cutoff = vuosiaEteen(syote.loppupvm, -1);

  const viennit: TositeVienti[] = [];
  for (const t of tositteet) {
    if (joVanhennetut.has(t.id)) continue;
    const lykatyt = t.viennit.filter((v) => v.alvKoodi === 418 || v.alvKoodi === 428);
    if (lykatyt.length === 0) continue;

    let kohteet: TositeVienti[];
    if (lopetettu)
      kohteet = lykatyt; // molemmat puolet
    else if (t.pvm <= cutoff)
      kohteet = lykatyt.filter((v) => v.alvKoodi === 418); // 12 kk: vain myynti
    else kohteet = [];
    if (kohteet.length === 0) continue;

    // Tunnistus- ja purkutositteet (vanhennus, suoritus, hyvitys) eivät kirjaa erää lykätyn alv:n
    // riville, joten ne suodattuvat tästä pois eikä niitä koskaan vanhenneta uudelleen; lisäksi
    // purkurivin V (kredit myynnissä / debet ostossa) on 0, jolloin tunnistaVeroVienti palauttaa [].
    const eraLeg = t.viennit.find((v) => v.era != null && (v.debet > 0 || v.kredit > 0));
    if (!eraLeg || eraLeg.era == null) continue;
    const saatavaPuoli = eraLeg.debet > 0;
    const T = saatavaPuoli ? eraLeg.debet : eraLeg.kredit;
    const saldo = eraMap.get(eraLeg.era) ?? 0;
    const avoinEnnen = saatavaPuoli ? saldo : -saldo;
    const maksettu = Math.min(T, Math.max(0, T - avoinEnnen));

    for (const l of kohteet) {
      viennit.push(
        ...tunnistaVeroVienti(
          l,
          T,
          maksettu,
          T,
          alvVelka,
          alvSaatava,
          syote.loppupvm,
          'Vanhentunut maksuperusteinen alv',
          t.id,
        ),
      );
    }
  }

  if (viennit.length === 0) return null;
  return tallennaTosite(
    storage,
    {
      pvm: syote.loppupvm,
      tyyppi: TositeTyyppi.JARJESTELMATOSITE,
      tila: TositeTila.KIRJANPIDOSSA,
      sarja: '',
      otsikko: 'Maksuperusteisen alv:n vanhennus',
      viennit,
    },
    env,
  );
}
