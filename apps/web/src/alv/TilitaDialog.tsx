import { useKpClient } from '@/app/KpClientProvider';
import {
  type AlvValmistelu,
  alvVirheViesti,
  useTilitaAlv,
  valmisteleAlvTilitys,
} from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { muotoilePvm } from '@penni/euro';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AlvLaskelmaTaulu } from './AlvLaskelmaTaulu.js';
import { type AlvKausi, type KausiPituus, alvErapaiva } from './alvKaudet.js';

/**
 * Tilitä-dialogi (spec §4.2, vakiodialogimalli): avaus käynnistää valmistelun
 * (vanhennus → marginaalivero → tuore laskelma), jolloin dialogi näyttää täsmälleen ne
 * luvut jotka tilitetään. Tilitä ajaa saman valmistelun uudelleen mutaation sisällä
 * (idempotentti) ja kirjaa tilitystositteen. Kaksoisklikkaussuoja on moottorin oma
 * (JOILMOITETTU-frontier + backstop) — nappi vain disabloidaan mutaation ajaksi.
 */
export function TilitaDialog({
  kausi,
  kausiKk,
  onPeruuta,
  onValmis,
}: {
  kausi: AlvKausi;
  kausiKk: KausiPituus;
  onPeruuta: () => void;
  /** Kutsutaan onnistuneen tilityksen jälkeen (sivu sulkee dialogin ja näyttää vahvistuksen). */
  onValmis: () => void;
}) {
  const client = useKpClient();
  const qc = useQueryClient();
  const { tilita, virheviesti, tilittaa } = useTilitaAlv();
  const [valmistelu, setValmistelu] = useState<AlvValmistelu | null>(null);
  const [valmisteluVirhe, setValmisteluVirhe] = useState<string | null>(null);
  const kaynnistetty = useRef(false);
  const peruttu = useRef(false);

  useEffect(() => {
    // Valmistelu dialogin avautuessa. StrictMode ajaa mount-efektin kahdesti, eikä moottorin
    // idempotenssi kata RINNAKKAISTA ajoa (vartijat ovat peräkkäisiä lue–kirjoita-tarkistuksia,
    // TOCTOU): kaksi yhtaikaista valmisteluketjua voisi kirjata esikirjaukset kahdesti. Ref
    // takaa täsmälleen yhden käynnistyksen instanssia kohden — parent mounttaa dialogin
    // ehdollisesti, joten jokainen avaus saa tuoreen refin (uusi yritys toimii).
    peruttu.current = false;
    if (!kaynnistetty.current) {
      kaynnistetty.current = true;
      valmisteleAlvTilitys(client, kausi)
        .then((tulos) => {
          if (!peruttu.current) setValmistelu(tulos);
          // Vanhennus/marginaalivero kirjoittavat oikeita, pysyviä tositteita — ei vasta
          // tilityksen onnistuessa vaan heti valmistelussa. Sivu niiden takana ei saa jäädä
          // näyttämään vanhaa tilaa (nollailmoitus/vanhat summat) vaikka käyttäjä peruisi
          // tämän jälkeen — siksi invalidointi EI ole peruttu-vartioitu, toisin kuin tilan
          // asetus yllä (joka vain estää turhan setStaten unmountin jälkeen).
          if (tulos.esikirjaukset.length > 0) {
            void qc.invalidateQueries({ queryKey: ['alvLaskelma'] });
            void qc.invalidateQueries({ queryKey: ['alvErittely'] });
            void qc.invalidateQueries({ queryKey: ['euMyynti'] });
            void qc.invalidateQueries({ queryKey: ['tositteet'] });
            void qc.invalidateQueries({ queryKey: ['saldot'] });
          }
        })
        .catch((e: unknown) => {
          if (!peruttu.current) setValmisteluVirhe(alvVirheViesti(e));
        });
    }
    // peruttu estää tilan asettamisen unmountin jälkeen; ref siksi, että StrictModen
    // väli-siivouksen jälkeinen setup nollaa sen ja ainoan ketjun tulos ehtii käyttöön.
    return () => {
      peruttu.current = true;
    };
  }, [client, kausi, qc]);

  async function lahetaTilitys() {
    const stored = await tilita({ alkupvm: kausi.alkupvm, loppupvm: kausi.loppupvm });
    if (stored) onValmis();
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
      role="dialog"
      aria-modal="true"
      aria-label="Tilitä arvonlisävero"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4 print:hidden"
    >
      <div className="w-[560px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]">
        <h2 className="mb-1 text-[15px] font-[650]">Tilitä arvonlisävero</h2>
        <p className="mb-4 text-[12.5px] tabular-nums text-[var(--text-muted)]">
          {muotoilePvm(kausi.alkupvm)} – {muotoilePvm(kausi.loppupvm)}
        </p>
        <p className="mb-3 text-[12.5px] text-[var(--warning)]">
          Kaikki arvonlisäverolliset kirjaukset pitää tehdä ennen alv-ilmoituksen antamista.
        </p>
        {valmistelu === null && valmisteluVirhe === null && (
          <p className="text-[13px] text-[var(--text-muted)]">Valmistellaan laskelmaa…</p>
        )}
        {valmistelu && (
          <>
            <AlvLaskelmaTaulu laskelma={valmistelu.laskelma} />
            <p className="mt-3 text-[13px]">
              Eräpäivä {muotoilePvm(alvErapaiva(kausi.loppupvm, kausiKk))}
            </p>
            {valmistelu.esikirjaukset.length > 0 && (
              <p className="mt-2 text-[12.5px] text-[var(--text-muted)]">
                Valmistelu kirjasi tositteet:{' '}
                {valmistelu.esikirjaukset.map((t) => t.otsikko ?? `#${t.id}`).join(', ')}. Ne jäävät
                voimaan, vaikka peruisit tilityksen (lakisääteisiä kauden päätöskirjauksia).
              </p>
            )}
          </>
        )}
        {(valmisteluVirhe ?? virheviesti) && (
          <p className="mt-3 text-[12.5px] text-[var(--danger)]">
            {valmisteluVirhe ?? virheviesti}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="sec" type="button" onClick={onPeruuta}>
            Peruuta
          </Button>
          <Button
            type="button"
            disabled={valmistelu === null || valmistelu.laskelma.koodit.size === 0 || tilittaa}
            onClick={() => void lahetaTilitys()}
          >
            Tilitä
          </Button>
        </div>
      </div>
    </div>
  );
}
