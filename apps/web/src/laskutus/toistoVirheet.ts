import { laskuVirheViesti } from '@/app/kysely';
import { type EpaonnistunutToisto, ResourceError } from '@penni/engine';

/**
 * Epäonnistuneiden toistojen luettelo käyttäjälle: toiston nimi (tai "toisto N") ja syy suomeksi,
 * esim. "Toiston luonti epäonnistui: Vuokra (Laskulla ei ole rivejä)". Tyhjä lista → null.
 */
export function epaonnistuneetTeksti(
  lista: readonly EpaonnistunutToisto[] | undefined,
): string | null {
  if (!lista || lista.length === 0) return null;
  const osat = lista.map(
    (e) =>
      `${e.nimi?.trim() || `toisto ${e.toisto}`} (${laskuVirheViesti(new ResourceError(e.virhe, e.virhe))})`,
  );
  return `${lista.length === 1 ? 'Toiston' : 'Toistojen'} luonti epäonnistui: ${osat.join(', ')}`;
}
