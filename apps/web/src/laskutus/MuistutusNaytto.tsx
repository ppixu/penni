import { useKpClient } from '@/app/KpClientProvider';
import {
  avaimet,
  useInit,
  useKirjaaLaskuluonnos,
  useKumppanit,
  useLisaaLiite,
  useMyyntilaskut,
  usePoistaLaskuluonnos,
  useTosite,
} from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { EdellinenSeuraava, useLaskuNaapurit } from '@/tositteet/EdellinenSeuraava.js';
import { type StoredTosite, onLaskuluonnos } from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';
import { laskuMalli } from '@penni/lasku-pdf';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { lataaLaskuPdf } from './lataaLaskuPdf';

const RIVI_LUOKKA = 'flex justify-between gap-8 py-[6px]';

/**
 * Maksumuistutuksen näkymä (`/myyntilaskut/$id`, tyyppi 216). Luonnos näyttää erittelyn ja
 * tarjoaa Kirjaa ja lataa PDF sekä Poista; kirjattu muistutus näyttää erittelyn, linkin
 * alkuperäiseen laskuun ja Lataa PDF. Erittely johdetaan tositteen `muistutus`-tiedoista
 * (muistutuksella ei ole rivejä eikä, nollamuistutusta lukuun ottamatta, summaa muualla).
 */
export function MuistutusNaytto({ tosite }: { tosite: StoredTosite }) {
  const navigate = useNavigate();
  const client = useKpClient();
  const qc = useQueryClient();
  const { lisaa } = useLisaaLiite();
  const { data: init } = useInit();
  const { data: kumppanit } = useKumppanit();
  const { data: myyntirivit } = useMyyntilaskut({});
  const { data: alkuperainen } = useTosite(
    tosite.alkuperainenTosite ?? 0,
    tosite.alkuperainenTosite !== undefined,
  );
  const { kirjaa, virheviesti: kirjausVirhe, kirjaamassa } = useKirjaaLaskuluonnos();
  const { poista, virheviesti: poistoVirhe, poistaa } = usePoistaLaskuluonnos();
  const naapurit = useLaskuNaapurit(myyntirivit, tosite.id);
  const [pdfTyossa, setPdfTyossa] = useState(false);
  const [pdfHuomio, setPdfHuomio] = useState<string | null>(null);

  const luonnos = onLaskuluonnos(tosite);
  const m = tosite.muistutus;
  const asetukset = init?.asetukset;
  const asiakas = kumppanit?.find((k) => k.id === tosite.kumppani);
  // PDF-estoa varten riittää malli ilman aiempia asiakirjoja (ne haetaan vasta latauksessa).
  const malli = useMemo(
    () => (asetukset ? laskuMalli({ tosite, kumppanit: kumppanit ?? [], asetukset }) : null),
    [tosite, asetukset, kumppanit],
  );

  /** Muodosta PDF annetusta (kirjatusta) tositteesta ja lataa; huomautus palautetaan kutsujalle. */
  async function lataa(kirjattu: StoredTosite): Promise<string | null> {
    if (!asetukset) return null;
    const kumppanilista = kumppanit ?? (await client.haeKumppanit());
    return lataaLaskuPdf({
      tosite: kirjattu,
      muodosta: (aiemmat) =>
        laskuMalli({ tosite: kirjattu, kumppanit: kumppanilista, asetukset, aiemmat }),
      client: {
        haeLiitteet: (id) => client.haeLiitteet(id),
        lisaaLiite: lisaa,
        haeTosite: (id) => client.haeTosite(id),
      },
      nyt: new Date().toISOString(),
    });
  }

  async function kirjaaJaLataa() {
    const kirjattu = await kirjaa(tosite.id);
    if (!kirjattu) return;
    // Ongelma PDF:ssä ei kumoa kirjausta. Sama komponentti-instanssi jatkaa kirjattuna
    // muistutuksena (sama reitti ja avain), joten huomautus säilyy tilassa.
    setPdfHuomio(await lataa(kirjattu));
    // Vasta nyt tosite-välimuisti vanhenee: reitti vaihtaa luonnosnäkymän kirjattuun.
    await qc.invalidateQueries({ queryKey: avaimet.tosite(kirjattu.id) });
  }

  async function lataaPdf() {
    setPdfTyossa(true);
    setPdfHuomio(null);
    setPdfHuomio(await lataa(tosite));
    setPdfTyossa(false);
  }

  async function poistaLuonnos() {
    if (!window.confirm('Poistetaanko muistutusluonnos? Poisto kirjataan tositelokiin.')) return;
    if (!(await poista(tosite.id))) return;
    void navigate({ to: '/tositteet', search: { laji: 'tulot', valilehti: 'lahtevat' } });
  }

  const otsikko = luonnos
    ? 'Maksumuistutusluonnos'
    : `Maksumuistutus ${tosite.numero ?? ''}`.trim();
  const tyossa = kirjaamassa || poistaa;
  const virhe = kirjausVirhe ?? poistoVirhe;
  const summa = m ? ((m.aiempiSaldo + m.maksu + m.korko) as Cents) : null;

  return (
    <>
      <TopBar
        otsikko={otsikko}
        toiminnot={
          <>
            {!luonnos && (
              <EdellinenSeuraava
                kohde="lasku"
                naapurit={naapurit}
                onSiirry={(seuraavaId) =>
                  void navigate({ to: '/myyntilaskut/$id', params: { id: String(seuraavaId) } })
                }
              />
            )}
            {pdfHuomio && (
              <output className="text-[12px] text-[var(--text-muted)]">{pdfHuomio}</output>
            )}
            {luonnos ? (
              <>
                <Button
                  variant="sec"
                  type="button"
                  disabled={tyossa}
                  onClick={() => void poistaLuonnos()}
                >
                  Poista
                </Button>
                <Button
                  type="button"
                  disabled={tyossa || !asetukset}
                  onClick={() => void kirjaaJaLataa()}
                >
                  Kirjaa ja lataa PDF
                </Button>
              </>
            ) : (
              <Button
                type="button"
                disabled={!malli || malli.pdfEste !== null || pdfTyossa}
                title={malli?.pdfEste ?? undefined}
                onClick={() => void lataaPdf()}
              >
                Lataa PDF
              </Button>
            )}
          </>
        }
      />
      <section aria-label="muistutusnaytto" className="flex-1 overflow-auto px-[22px] py-5">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5">
          {virhe && (
            <p role="alert" className="text-[12.5px] text-[var(--danger)]">
              {virhe}
            </p>
          )}
          <dl className="flex flex-col text-[12.5px]">
            <div className={RIVI_LUOKKA}>
              <dt className="text-[var(--text-muted)]">Asiakas</dt>
              <dd>{asiakas?.nimi ?? '—'}</dd>
            </div>
            <div className={RIVI_LUOKKA}>
              <dt className="text-[var(--text-muted)]">Muistutuksen pvm</dt>
              <dd className="tabular-nums">{muotoilePvm(tosite.pvm)}</dd>
            </div>
            {tosite.erapvm && (
              <div className={RIVI_LUOKKA}>
                <dt className="text-[var(--text-muted)]">Eräpäivä</dt>
                <dd className="tabular-nums">{muotoilePvm(tosite.erapvm)}</dd>
              </div>
            )}
            {!luonnos && tosite.viite && (
              <div className={RIVI_LUOKKA}>
                <dt className="text-[var(--text-muted)]">Viite</dt>
                <dd className="tabular-nums">{tosite.viite}</dd>
              </div>
            )}
            {tosite.alkuperainenTosite !== undefined && (
              <div className={RIVI_LUOKKA}>
                <dt className="text-[var(--text-muted)]">Alkuperäinen lasku</dt>
                <dd>
                  <Link
                    to="/myyntilaskut/$id"
                    params={{ id: String(tosite.alkuperainenTosite) }}
                    className="text-[var(--accent)] underline"
                  >
                    {alkuperainen?.numero ? `Lasku ${alkuperainen.numero}` : 'Avaa lasku'}
                  </Link>
                </dd>
              </div>
            )}
          </dl>

          {m && summa !== null && (
            <section aria-label="muistutuksen erittely" className="text-[13px]">
              <div className="flex flex-col divide-y divide-[var(--border)] border-y border-[var(--border)] tabular-nums">
                <div className={RIVI_LUOKKA}>
                  <span>Laskun avoin saldo</span>
                  <span>{muotoileEuro(m.aiempiSaldo)}</span>
                </div>
                {m.maksu > 0 && (
                  <div className={RIVI_LUOKKA}>
                    <span>Huomautuskulut</span>
                    <span>{muotoileEuro(m.maksu)}</span>
                  </div>
                )}
                {m.korko > 0 && (
                  <div className={RIVI_LUOKKA}>
                    <span>
                      Viivästyskorko {muotoilePvm(m.korkoalkaa)}–{muotoilePvm(m.korkoloppuu)},{' '}
                      {m.viivkorko.toFixed(2).replace('.', ',')} %
                    </span>
                    <span>{muotoileEuro(m.korko)}</span>
                  </div>
                )}
                <div className={`${RIVI_LUOKKA} font-[650]`}>
                  <span>Maksettava yhteensä</span>
                  <span>{muotoileEuro(summa)}</span>
                </div>
              </div>
              {luonnos && (
                <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                  Erittely on luonnoksen luontihetken. Saldo ja korko lasketaan uudelleen
                  kirjattaessa.
                </p>
              )}
            </section>
          )}
        </div>
      </section>
    </>
  );
}
