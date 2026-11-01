import { BudjettiSivu } from '@/budjetti/BudjettiSivu';
import { createFileRoute } from '@tanstack/react-router';

/** `/budjetti?tilikausi=2026-01-01&kohdennus=3` — Asetusten tilikausiriviltä ja budjettivertailusta. */
export interface BudjettiHaku {
  tilikausi?: string | undefined;
  kohdennus?: number | undefined;
}

function lueKohdennus(arvo: unknown): number | undefined {
  const n = typeof arvo === 'string' && arvo.trim() !== '' ? Number(arvo) : arvo;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : undefined;
}

export const Route = createFileRoute('/budjetti')({
  // Tuntematon arvo putoaa oletukseen (ks. tilikartta.tsx).
  validateSearch: (haku: Record<string, unknown>): BudjettiHaku => ({
    tilikausi:
      typeof haku.tilikausi === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(haku.tilikausi)
        ? haku.tilikausi
        : undefined,
    kohdennus: lueKohdennus(haku.kohdennus),
  }),
  component: Budjetti,
});

function Budjetti() {
  const haku = Route.useSearch();
  return <BudjettiSivu tilikausi={haku.tilikausi} kohdennus={haku.kohdennus} />;
}
