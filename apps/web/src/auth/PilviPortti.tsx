import { HttpClient } from '@/client/HttpClient';
import type { KpClient } from '@penni/asiakas';
import type { ApiFetcher } from '@ts-rest/core';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Kirjautuminen } from './Kirjautuminen.js';
import { Rekisteroidy } from './Rekisteroidy.js';
import { type Kayttaja, luoAuthClient } from './authClient.js';
import { KayttajaProvider } from './kayttajaKonteksti.js';
import { lueToken, tallennaToken, tyhjennaToken } from './tokenVarasto.js';

type Tila = 'lataa' | 'kirjaudu' | 'rekisteroidy' | 'valmis';

export function PilviPortti({
  baseUrl,
  api,
  lapset,
}: {
  baseUrl: string;
  /** Testisauma: reititä ts-rest fastify.inject()-fetcheriin (tuotanto käyttää verkkoa). */
  api?: ApiFetcher;
  lapset: (client: KpClient, kayttaja: Kayttaja, kirjauduUlos: () => void) => ReactNode;
}) {
  const [tila, setTila] = useState<Tila>('lataa');
  const [kayttaja, setKayttaja] = useState<Kayttaja | null>(null);

  const authClient = (token?: string) =>
    luoAuthClient({ baseUrl, ...(token ? { token } : {}), ...(api ? { api } : {}) });

  // Alustava sessiotarkistus tallennetulla tokenilla (kerran mountissa).
  useEffect(() => {
    const token = lueToken();
    if (!token) {
      setTila('kirjaudu');
      return;
    }
    luoAuthClient({ baseUrl, token, ...(api ? { api } : {}) })
      .haeMinut()
      .then((k) => {
        setKayttaja(k);
        setTila('valmis');
      })
      .catch(() => {
        tyhjennaToken();
        setTila('kirjaudu');
      });
  }, [baseUrl, api]);

  function onnistui(k: Kayttaja, token: string) {
    tallennaToken(token);
    setKayttaja(k);
    setTila('valmis');
  }
  function kirjauduUlos() {
    const token = lueToken();
    if (token) void authClient(token).kirjauduUlos();
    tyhjennaToken();
    setKayttaja(null);
    setTila('kirjaudu');
  }
  // 401 missä tahansa moottorikutsussa → istunto on jo mitätön palvelimella,
  // joten ei kutsuta /logout-päätepistettä (toisin kuin kirjauduUlos()).
  function istuntoVanheni() {
    tyhjennaToken();
    setKayttaja(null);
    setTila('kirjaudu');
  }
  async function vaihdaSalasana(s: { vanhaSalasana: string; uusiSalasana: string }) {
    await authClient(lueToken() ?? undefined).vaihdaSalasana(s);
  }

  if (tila === 'lataa') return <p className="p-6 text-[var(--text-muted)]">Ladataan…</p>;
  if (tila === 'kirjaudu') {
    return (
      <Kirjautuminen
        onKirjaudu={async (s) => {
          const r = await authClient().kirjaudu(s);
          onnistui(r.kayttaja, r.token);
        }}
        onVaihdaRekisterointiin={() => setTila('rekisteroidy')}
      />
    );
  }
  if (tila === 'rekisteroidy' || !kayttaja) {
    return (
      <Rekisteroidy
        onRekisteroi={async (s) => {
          const r = await authClient().rekisteroi(s);
          onnistui(r.kayttaja, r.token);
        }}
        onVaihdaKirjautumiseen={() => setTila('kirjaudu')}
      />
    );
  }
  const client = new HttpClient({
    baseUrl,
    baseHeaders: { authorization: `bearer ${lueToken() ?? ''}` },
    ...(api ? { api } : {}),
    onTunnistusVanheni: istuntoVanheni,
  });
  return (
    <KayttajaProvider
      kayttaja={kayttaja}
      kirjauduUlos={kirjauduUlos}
      vaihdaSalasana={vaihdaSalasana}
    >
      {lapset(client, kayttaja, kirjauduUlos)}
    </KayttajaProvider>
  );
}
