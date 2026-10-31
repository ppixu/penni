import { Button } from '@/components/ui/button';
import { type TallennusTulos, TositeEditori } from '@/editori/TositeEditori';
import { alustaTila } from '@/editori/reducer';
import { tositeEditorille } from '@/editori/tositeEditorille';
import type { TositeEditoriTila } from '@/editori/types';
import { useTositeTallennus } from '@/editori/useTositeTallennus';
import { LiitePaneeli } from '@/liitteet/LiitePaneeli';
import { type LadattavaLiite, LiitteidenLataus } from '@/liitteet/LiitteidenLataus';
import { liitevirheViesti, useOdottavatLiitteet } from '@/liitteet/useOdottavatLiitteet';
import { useMuutosseuranta } from '@/tallentamaton/useMuutosseuranta';
import { useTallentamatonVaroitus } from '@/tallentamaton/useTallentamatonVaroitus';
import { tositeVertailuun } from '@/tallentamaton/vertailu';
import {
  type Tili,
  type TositeAsetukset,
  TositeTyyppi,
  type TyolistaRivi,
  riviTositteeksi,
} from '@penni/engine';
import { muotoileEuro, muotoilePvm } from '@penni/euro';
import { useEffect, useState } from 'react';
import { annaTasmaysSilta } from './silta.js';
import { mimetyyppi } from './useKirjaaRivit.js';

/**
 * Editorin alkutila työlistariviltä: sama tositeehdotus kuin "Kirjaa valitut" tekisi
 * (riviTositteeksi) riveiksi purettuna. Jos ehdotusta ei voi rakentaa tai purkaa riveiksi,
 * esitäytetään vain päivä, tyyppi ja selite — tasaava pankkirivi syntyy editorissa Enterillä.
 */
export function kasinAlkutila(
  rivi: TyolistaRivi,
  chart: readonly Tili[],
  asetukset: TositeAsetukset,
): Partial<TositeEditoriTila> {
  const perus: Partial<TositeEditoriTila> = {
    paiva: rivi.tapahtuma.pvm,
    tyyppi: rivi.tapahtuma.maara < 0 ? TositeTyyppi.MENO : TositeTyyppi.TULO,
    selite: rivi.kuitti?.kuitti.myyja ?? rivi.tapahtuma.nimi,
  };
  try {
    const syote = riviTositteeksi(rivi, chart, asetukset);
    const tila = tositeEditorille({ ...syote, sarja: syote.sarja ?? '' }, chart, {
      tiukka: false,
    });
    return tila ? { ...perus, ...tila, selite: tila.selite || (perus.selite ?? '') } : perus;
  } catch {
    return perus;
  }
}

/**
 * Täsmäytyksen rivin kirjaus käsin ruudukkoeditorissa. Näytetään täsmäytysnäkymän sisällä,
 * jotta luettu tiliote ja kuitit säilyvät. Rivin kuitti ja omat tiedostot odottavat
 * liitepaneelissa ja tallennetaan tositteelle, kun se on tallennettu kirjanpitoon.
 */
export function KasinKirjaus({
  rivi,
  chart,
  asetukset,
  pankkitili,
  omatLiitteet,
  onKirjattu,
  onTakaisin,
}: {
  rivi: TyolistaRivi;
  chart: readonly Tili[];
  asetukset: TositeAsetukset;
  pankkitili: number | undefined;
  omatLiitteet: readonly LadattavaLiite[];
  /** Tosite tallentui; `varoitus` kertoo, jos jokin liite jäi tallentamatta. */
  onKirjattu: (tulos: TallennusTulos, varoitus: string | null) => void;
  onTakaisin: () => void;
}) {
  const [alkutila] = useState(() => alustaTila(kasinAlkutila(rivi, chart, asetukset)));
  // Käsikirjaus tallennetaan vain Tallenna-painikkeella: keskeneräinen varoittaa poistuttaessa.
  const [tila, setTila] = useState(alkutila);
  const { onkoLikainen, asetaPohja } = useMuutosseuranta(tila, tositeVertailuun);
  const varoitus = useTallentamatonVaroitus(onkoLikainen);
  const tallennus = useTositeTallennus(chart);
  const liitteet = useOdottavatLiitteet(omatLiitteet);
  const [liiteVirhe, setLiiteVirhe] = useState<string | null>(null);
  const { lisaa } = liitteet;
  const kuittiPolku = rivi.kuitti?.tiedosto;

  // Rivin kuitti luetaan levyltä liitepaneeliin odottamaan (esikatselu heti näkyviin).
  useEffect(() => {
    if (!kuittiPolku) return;
    let peruttu = false;
    const nimi = kuittiPolku.split('/').pop() ?? 'kuitti';
    annaTasmaysSilta()
      .lueTiedosto(kuittiPolku)
      .then((data) => {
        if (!peruttu) lisaa({ nimi, tyyppi: mimetyyppi(nimi), data });
      })
      .catch(() => {
        if (!peruttu) setLiiteVirhe(`Kuitin ${nimi} lukeminen epäonnistui.`);
      });
    return () => {
      peruttu = true;
    };
  }, [kuittiPolku, lisaa]);

  async function tallenna(t: TositeEditoriTila) {
    setLiiteVirhe(null);
    const tulos = await tallennus.kirjaa(t);
    if (!tulos) return undefined;
    asetaPohja(t);
    onKirjattu(tulos, liitevirheViesti(await liitteet.tallennaTositteelle(tulos.id)));
    return tulos;
  }

  return (
    <>
      <TositeEditori
        chart={chart}
        alkupaiva={rivi.tapahtuma.pvm}
        initial={alkutila}
        pankkitili={pankkitili}
        otsikko={`Kirjaa käsin · ${rivi.tapahtuma.nimi}`}
        alaotsikko={`${muotoilePvm(rivi.tapahtuma.pvm)} · ${muotoileEuro(rivi.tapahtuma.maara)}`}
        onTallenna={tallenna}
        onMuutos={setTila}
        virheviesti={tallennus.virheviesti}
        tallennaJaUusi={false}
        lisatoiminnot={
          <Button variant="sec" type="button" onClick={onTakaisin}>
            Takaisin täsmäytykseen
          </Button>
        }
        sivupaneeli={
          <LiitePaneeli
            liitteet={liitteet.odottavat}
            onAvaaErikseen={liitteet.avaa}
            onPoista={liitteet.poista}
          >
            {liiteVirhe ? (
              <p role="alert" className="text-[12.5px] text-[var(--danger)]">
                {liiteVirhe}
              </p>
            ) : null}
            <LiitteidenLataus onLataa={async (l) => lisaa(l)} />
          </LiitePaneeli>
        }
      />
      {varoitus}
    </>
  );
}
