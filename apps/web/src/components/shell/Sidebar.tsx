import { useKayttaja } from '@/auth/kayttajaKonteksti';
import { DemoMerkki, DemoTunnus } from '@/demo/DemoMerkki';
import { DEMO } from '@/demo/tila';
import { cn } from '@/lib/utils';
import { onkoTasmaysSilta } from '@/tasmays/silta';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  BookCheck,
  FilePlus2,
  FileText,
  Landmark,
  LayoutDashboard,
  Percent,
  Receipt,
  Settings,
  SquarePlus,
  Table2,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { KirjanVaihto } from './KirjanVaihto.js';
import { NavigointiNapit } from './NavigointiNapit.js';
import { TilikausiValitsin } from './TilikausiValitsin.js';

interface NavKohta {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Alipolku, jolla kohta ei ole aktiivinen (sillä on oma kohtansa). */
  paitsi?: string;
}

const NAV_ALKU: NavKohta[] = [
  { to: '/', label: 'Kojelauta', icon: LayoutDashboard },
  { to: '/tositteet/uusi', label: 'Uusi tosite', icon: SquarePlus },
  { to: '/tositteet', label: 'Tositteet', icon: Receipt, paitsi: '/tositteet/uusi' },
];

const NAV_LOPPU: NavKohta[] = [
  { to: '/kumppanit', label: 'Kumppanit', icon: Users },
  { to: '/raportit', label: 'Raportit', icon: FileText },
  { to: '/alv', label: 'ALV', icon: Percent },
  { to: '/tilikartta', label: 'Tilikartta', icon: Table2 },
];

// Harvemmin käytetyt kohdat painuvat alas kirjanvaihdon viereen.
const NAV_ALA: NavKohta[] = [
  { to: '/tilinpaatos', label: 'Tilinpäätös', icon: BookCheck },
  { to: '/asetukset', label: 'Asetukset', icon: Settings },
];

const UUSI_KIRJANPITO: NavKohta = {
  to: '/uusikirjanpito',
  label: 'Uusi kirjanpito',
  icon: FilePlus2,
};

function Erotin() {
  return <hr className="mx-[5px] my-[5px] border-0 border-t border-[var(--border)]" />;
}

function NavLinkki({ to, label, icon: Icon, paitsi }: NavKohta) {
  const polku = useRouterState({ select: (s) => s.location.pathname });
  const poissa = paitsi !== undefined && polku.startsWith(paitsi);
  return (
    <Link
      // Routes other than '/' arrive in later sub-tiers; `to` is a plain string here so the
      // typed router does not reject not-yet-generated paths. Visual/active behavior is exact.
      to={to}
      className="flex items-center gap-[9px] rounded-[8px] px-[10px] py-[7px] text-[12.5px] text-[var(--text-muted)] hover:bg-[var(--track)]"
      activeProps={
        poissa
          ? {}
          : {
              className: cn(
                'bg-[var(--surface)] text-[var(--text)] font-semibold',
                'shadow-[0_0_0_1px_var(--border)]',
              ),
            }
      }
      activeOptions={{ exact: to === '/' }}
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              'h-4 w-4',
              isActive && !poissa ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]',
            )}
          />
          {label}
        </>
      )}
    </Link>
  );
}

export function Sidebar({ kirjanpito }: { kirjanpito: string }) {
  const kayttaja = useKayttaja();
  // Täsmäytys lukee tiedostoja levyltä työpöytäsillan kautta — piilossa pelkässä selaimessa
  // (sama ehto kuin itse näkymän suojauksessa, ks. tasmays/silta.ts).
  const nav: NavKohta[] = [
    ...NAV_ALKU,
    ...(onkoTasmaysSilta() ? [{ to: '/tasmays', label: 'Tuo tiliote', icon: Landmark }] : []),
    ...NAV_LOPPU,
  ];
  return (
    <nav className="print:hidden flex w-[158px] shrink-0 flex-col gap-[3px] border-r border-[var(--border)] bg-[var(--bg-subtle)] px-[11px] py-4">
      <div className="mx-[5px] mb-4 mt-[2px] flex items-center gap-[10px] text-[16px] font-bold tracking-[-0.3px]">
        <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-[7px]">
          {/* Rasteri eikä penni-icon.svg: SVG:n pinotut ekstruusiokerrokset sahaavat reunoja
              näin pienessä koossa. PNG:t on pienennetty apps/desktop/assets/penni-icon.png:stä. */}
          <img
            src="/penni-icon-80.png"
            srcSet="/penni-icon-80.png 2x, /penni-icon-120.png 3x"
            alt=""
            className="absolute left-1/2 top-1/2 h-10 w-10 max-w-none -translate-x-1/2 -translate-y-1/2"
          />
        </span>
        Penni
        {DEMO && <DemoTunnus />}
      </div>
      <div className="mx-[3px] -mt-[6px] mb-3">
        <NavigointiNapit />
      </div>
      <TilikausiValitsin />
      {nav.map((kohta) => (
        <NavLinkki key={kohta.to} {...kohta} />
      ))}
      <div className="mt-auto flex flex-col gap-[3px]">
        {NAV_ALA.map((kohta) => (
          <NavLinkki key={kohta.to} {...kohta} />
        ))}
        <Erotin />
        {/* Demossa ei luoda uutta kirjaa: muistissa oleva demokirja palautetaan latauksella. */}
        {DEMO ? <DemoMerkki /> : <NavLinkki {...UUSI_KIRJANPITO} />}
        <Erotin />
        <KirjanVaihto kirjanpito={kirjanpito} />
      </div>
      {kayttaja && (
        <div className="mt-2 px-[5px] text-[10.5px] text-[var(--text-subtle)]">
          <div className="truncate">{kayttaja.kayttaja.nimi ?? kayttaja.kayttaja.email}</div>
          <button type="button" className="mt-1 underline" onClick={kayttaja.kirjauduUlos}>
            Kirjaudu ulos
          </button>
        </div>
      )}
    </nav>
  );
}
