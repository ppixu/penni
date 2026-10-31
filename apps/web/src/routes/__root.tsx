import { useInit } from '@/app/kysely';
import { AppShell } from '@/components/shell/AppShell';
import { PiilotetutTilitKonteksti } from '@/tilikartta/PiilotetutTilit';
import { TiliValintaKonteksti } from '@/tilikartta/TiliValinta';
import { useTilienKaytto } from '@/tilikartta/tilinakyma';
import { PIILOTETUT_AVAIN, SUOSIKIT_AVAIN, lueTiliLista } from '@/tilikartta/tilisuosio';
import { ValittuTilikausiKonteksti, useTilikausiValinta } from '@/tilikausi/valittuTilikausi';
import type { KpClient } from '@penni/asiakas';
import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { useMemo } from 'react';

export interface RouterContext {
  client: KpClient;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootComponent });

function RootComponent() {
  const { data } = useInit();
  const kirjanpito = data?.asetukset.Nimi ?? 'Penni';
  const tilikausi = useTilikausiValinta(data?.tilikaudet, data?.asetukset.TilitPaatetty);
  const piilotilit = data?.asetukset[PIILOTETUT_AVAIN];
  const piilotetut = useMemo(() => lueTiliLista(piilotilit), [piilotilit]);
  const suosikkitilit = data?.asetukset[SUOSIKIT_AVAIN];
  const kaytto = useTilienKaytto(tilikausi);
  const tiliValinta = useMemo(
    () => ({ suosikit: lueTiliLista(suosikkitilit), kaytto }),
    [suosikkitilit, kaytto],
  );
  return (
    <ValittuTilikausiKonteksti.Provider value={tilikausi}>
      <PiilotetutTilitKonteksti.Provider value={piilotetut}>
        <TiliValintaKonteksti.Provider value={tiliValinta}>
          <AppShell kirjanpito={kirjanpito}>
            <Outlet />
          </AppShell>
        </TiliValintaKonteksti.Provider>
      </PiilotetutTilitKonteksti.Provider>
    </ValittuTilikausiKonteksti.Provider>
  );
}
