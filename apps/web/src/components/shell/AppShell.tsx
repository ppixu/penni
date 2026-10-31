import { Historiaeleet } from '@/navigointi/Historiaeleet';
import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar.js';

export function AppShell({
  kirjanpito,
  children,
}: {
  kirjanpito: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen print:block print:h-auto">
      <Sidebar kirjanpito={kirjanpito} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden print:overflow-visible">
        {children}
      </main>
      <Historiaeleet />
    </div>
  );
}
