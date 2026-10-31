import { useSaldot } from '@/app/kysely';
import { tositteenSumma } from '@/lib/tosite';
import { cn } from '@/lib/utils';
import { type Tosite, TositeTyyppi } from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';

/**
 * Tositelistan summa. Tiliotteella näytetään pankin loppusaldo: vihreä, kun kirjanpidon
 * pankkitilin saldo kauden viimeisenä päivänä on sama, punainen, kun ei (erotus vihjeenä).
 */
export function TositeSumma({
  tosite,
}: { tosite: Pick<Tosite, 'tyyppi' | 'viennit' | 'tiliote'> }) {
  const tiliote = tosite.tyyppi === TositeTyyppi.TILIOTE ? tosite.tiliote : undefined;
  const loppusaldo = tiliote?.loppusaldo;
  const { data: saldot } = useSaldot(
    { pvm: tiliote?.loppupvm ?? '', tili: tiliote?.tili ?? 0 },
    tiliote !== undefined && loppusaldo !== undefined && tiliote.loppupvm !== '',
  );
  if (!tiliote || loppusaldo === undefined) return <>{muotoileEuro(tositteenSumma(tosite))}</>;
  const kirjanpito = saldot ? ((saldot.get(tiliote.tili) ?? 0) as Cents) : undefined;
  const ok = kirjanpito === loppusaldo;
  const vihje =
    kirjanpito === undefined
      ? undefined
      : ok
        ? `Kirjanpidon saldo ${muotoilePvm(tiliote.loppupvm)} täsmää tiliotteeseen`
        : `Kirjanpidon saldo ${muotoilePvm(tiliote.loppupvm)} ${muotoileEuro(kirjanpito)}, erotus ${muotoileEuro((loppusaldo - kirjanpito) as Cents)}`;
  return (
    <span
      title={vihje}
      aria-label={vihje ? `Loppusaldo ${muotoileEuro(loppusaldo)}. ${vihje}` : undefined}
      className={cn(
        'font-medium',
        kirjanpito !== undefined && (ok ? 'text-[var(--positive)]' : 'text-[var(--danger)]'),
      )}
    >
      {muotoileEuro(loppusaldo)}
    </span>
  );
}
