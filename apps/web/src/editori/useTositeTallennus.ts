import { useKpClient } from '@/app/KpClientProvider';
import { useInit } from '@/app/kysely';
import {
  ResourceError,
  type StoredTosite,
  type Tili,
  type TositeSyote,
  TositeTila,
  muodostaValidointiKonteksti,
  onKirjanpidossa,
} from '@penni/engine';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { rakennaSyote } from './syote.js';
import { voiTallentaaKirjattuna, voiTallentaaLuonnoksena } from './tallennuskelpoisuus.js';
import type { TositeEditoriTila } from './types.js';

/** Map a thrown engine ResourceError to a Finnish inline message. */
export function tallennusVirhe(e: unknown): string {
  if (e instanceof ResourceError) {
    switch (e.code) {
      case 'PVMLUKITTU':
        return 'Tosite osuu lukittuun tilikauteen.';
      case 'EITILIKAUTTA':
        return 'Päivälle ei ole avointa tilikautta.';
      case 'EIVALMISTU':
        return e.message; // already lists the blocking codes
      default:
        return e.message || 'Tallennus epäonnistui.';
    }
  }
  return 'Tallennus epäonnistui.';
}

/**
 * Tallennetun tositteen päivityssyöte: editorin kentät (päivä, tyyppi, sarja, otsikko, viennit)
 * tallennetun päälle, muut kentät (kumppani, viite, eräpäivä…) ja tila säilyvät. Tunniste jää
 * pois, jolloin moottori säilyttää tositteen numeron.
 */
export function paivitysSyote(
  vanha: StoredTosite,
  tila: TositeEditoriTila,
  chart: readonly Tili[],
): TositeSyote {
  const { id: _id, tunniste: _tunniste, otsikko: _otsikko, ...sailyva } = vanha;
  const { tila: _uusiTila, id: _uusiId, ...uusi } = rakennaSyote(tila, 'kirjattu', chart);
  return { ...sailyva, ...uusi, tila: vanha.tila };
}

/**
 * Pelkän tyypin vaihto: tallennettu tosite sellaisenaan (viennit, päivä, sarja, otsikko, tila,
 * laskutiedot), vain tyyppi uusi. Tunniste jää pois, jolloin moottori säilyttää numeron.
 */
export function tyypinVaihtoSyote(vanha: StoredTosite, tyyppi: number): TositeSyote {
  const { id: _id, tunniste: _tunniste, ...sailyva } = vanha;
  return { ...sailyva, tyyppi };
}

/** Tallennuksen jälkeen vanhentuneet kyselyt (kojelauta, selaimet, raportit, tosite itse). */
export function mitatoiTallennuksenKyselyt(qc: QueryClient, tositeId: number): void {
  for (const avain of ['tositteet', 'saldot', 'tulot', 'menot', 'viennit', 'raportti']) {
    void qc.invalidateQueries({ queryKey: [avain] });
  }
  void qc.invalidateQueries({ queryKey: ['tosite', tositeId] });
}

/**
 * Tositteen tallennus editorista. Automaattinen tallennus käyttää `luoLuonnos`- ja
 * `paivita`-funktioita (heittävät virheen; eivät mitätöi kyselyitä, jottei editorin oma tosite
 * latautuisi kesken kirjoituksen), Kirjaa `kirjaa`-funktiota (virhe → `virheviesti`).
 * Viimeksi tallennettu tosite on seuraavan päivityksen pohja: sen tila (luonnos/kirjattu),
 * numero ja laskutiedot säilyvät. Irrotettaessa automaattisten tallennusten jälkeen
 * selaimet, saldot ja tosite itse mitätöidään.
 */
export function useTositeTallennus(chart: readonly Tili[], muokattava?: StoredTosite) {
  const client = useKpClient();
  const qc = useQueryClient();
  const { data: init } = useInit();
  const [virheviesti, setVirheviesti] = useState<string | null>(null);
  /** Viimeksi tallennettu tosite: päivitysten pohja ja id. */
  const tallennettu = useRef<StoredTosite | undefined>(muokattava);
  /** Automaattinen tallennus muutti kirjaa, eikä kyselyitä ole vielä mitätöity. */
  const muutettu = useRef(false);
  const kiinni = useRef(true);
  const ctx = useMemo(
    () => (init ? muodostaValidointiKonteksti(chart, init.tilikaudet, init.asetukset) : null),
    [chart, init],
  );

  useEffect(() => {
    kiinni.current = true;
    return () => {
      kiinni.current = false;
      const t = tallennettu.current;
      if (muutettu.current && t) mitatoiTallennuksenKyselyt(qc, t.id);
      muutettu.current = false;
    };
  }, [qc]);

  /** Automaattisen tallennuksen jälkeen: irrotuksen jälkeen valmistunut mitätöi heti. */
  function merkitse(t: StoredTosite): StoredTosite {
    tallennettu.current = t;
    if (kiinni.current) muutettu.current = true;
    else mitatoiTallennuksenKyselyt(qc, t.id);
    return t;
  }

  async function luoLuonnos(tila: TositeEditoriTila): Promise<StoredTosite> {
    return merkitse(await client.luoTosite(rakennaSyote(tila, 'luonnos', chart)));
  }

  async function paivita(tila: TositeEditoriTila): Promise<StoredTosite> {
    const vanha = tallennettu.current;
    if (!vanha) throw new Error('Päivitettävää tositetta ei ole');
    return merkitse(await client.paivitaTosite(vanha.id, paivitysSyote(vanha, tila, chart)));
  }

  async function kirjaa(tila: TositeEditoriTila): Promise<StoredTosite | undefined> {
    setVirheviesti(null);
    const vanha = tallennettu.current;
    try {
      const t = vanha
        ? await client.paivitaTosite(vanha.id, {
            ...paivitysSyote(vanha, tila, chart),
            tila: onKirjanpidossa(vanha.tila) ? vanha.tila : TositeTila.KIRJANPIDOSSA,
          })
        : await client.luoTosite(rakennaSyote(tila, 'kirjattu', chart));
      tallennettu.current = t;
      muutettu.current = false;
      mitatoiTallennuksenKyselyt(qc, t.id);
      return t;
    } catch (e) {
      setVirheviesti(tallennusVirhe(e));
      return undefined;
    }
  }

  /** Miksi tilaa ei tallenneta automaattisesti; null = saa. Ennen kirjan latausta ei estettä. */
  function este(tila: TositeEditoriTila): string | null {
    if (!ctx) return null;
    const kirjattu = onKirjanpidossa(tallennettu.current?.tila ?? TositeTila.LUONNOS);
    const arvio = kirjattu
      ? voiTallentaaKirjattuna(tila, chart, ctx)
      : voiTallentaaLuonnoksena(tila, chart, ctx);
    return arvio.voi ? null : arvio.syy;
  }

  /** Kirjaa ja uusi: seuraava tallennus luo uuden luonnoksen. */
  function nollaa(): void {
    tallennettu.current = undefined;
  }

  return {
    luoLuonnos,
    paivita,
    kirjaa,
    este,
    nollaa,
    id: () => tallennettu.current?.id,
    virheviesti,
  };
}
