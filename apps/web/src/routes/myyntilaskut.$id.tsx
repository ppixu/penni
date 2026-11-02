import { useKpClient } from '@/app/KpClientProvider';
import { useInit, useKumppanit, useLisaaLiite, useMyyntilaskut, useTosite } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { LaskuDokumentti } from '@/laskutus/LaskuDokumentti';
import { LaskuLuonnos } from '@/laskutus/LaskuLuonnos';
import { MuistutusNaytto } from '@/laskutus/MuistutusNaytto';
import { ToistoDialog } from '@/laskutus/ToistoDialog';
import { lataaLaskuPdf } from '@/laskutus/lataaLaskuPdf';
import { HyvitaVahvistus } from '@/ostolaskut/HyvitaVahvistus';
import { EdellinenSeuraava, useLaskuNaapurit } from '@/tositteet/EdellinenSeuraava.js';
import { Maksutapa, TositeTyyppi, onLaskuluonnos } from '@penni/engine';
import { laskuMalli } from '@penni/lasku-pdf';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

export const Route = createFileRoute('/myyntilaskut/$id')({ component: LaskuReitti });

/** Avain nollaa laskukohtaisen tilan (avoin hyvitysdialogi), kun Edellinen/Seuraava vaihtaa id:n.
 *  Myyntilaskuluonnos (tila 50–99) avautuu muokattavana lomakkeena; kirjattu lasku dokumenttina.
 *  Maksumuistutus (luonnos tai kirjattu) on oma näkymänsä; muut tyypit ohjataan tositenäkymään. */
function LaskuReitti() {
  const { id } = Route.useParams();
  const { data: tosite } = useTosite(Number(id));
  // Luonnoksen kirjauksen PDF-huomautus elää tässä, jotta se säilyy vaihdossa laskunäkymään.
  const [alkuHuomio, setAlkuHuomio] = useState<string | null>(null);
  if (tosite && tosite.tyyppi === TositeTyyppi.MYYNTILASKU && onLaskuluonnos(tosite))
    return <LaskuLuonnos key={id} tosite={tosite} onHuomio={setAlkuHuomio} />;
  if (tosite && tosite.tyyppi === TositeTyyppi.MAKSUMUISTUTUS)
    return <MuistutusNaytto key={id} tosite={tosite} />;
  return <LaskuNaytto key={id} alkuHuomio={alkuHuomio} />;
}

function LaskuNaytto({ alkuHuomio }: { alkuHuomio: string | null }) {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: tosite, isLoading } = useTosite(Number(id));
  const { data: init } = useInit();
  const { data: kumppanit, isLoading: kumppanitLadataan } = useKumppanit();
  const { data: myyntirivit } = useMyyntilaskut({});
  // Hyvityslaskun dokumentti tulostaa alkuperäisen rivit ja viitteen → alkuperäinen haetaan mukaan.
  const onHyvitys = tosite?.tyyppi === TositeTyyppi.HYVITYSLASKU;
  const { data: alkuperainen, isLoading: alkuperainenLadataan } = useTosite(
    tosite?.alkuperainenTosite ?? 0,
    onHyvitys && tosite?.alkuperainenTosite !== undefined,
  );
  const [hyvitysAuki, setHyvitysAuki] = useState(false);
  const [toistoAuki, setToistoAuki] = useState(false);
  const client = useKpClient();
  const { lisaa } = useLisaaLiite();
  const [pdfTyossa, setPdfTyossa] = useState(false);
  const [pdfHuomio, setPdfHuomio] = useState<string | null>(alkuHuomio);
  const naapurit = useLaskuNaapurit(myyntirivit, Number(id));

  // Vartija (spec §4.1): dokumenttireitti ei yritä renderöidä muita tositetyyppejä
  // (maksumuistutus on käsitelty jo LaskuReitissä), vaan ohjaa tavalliseen tositenäkymään.
  const vieras =
    tosite != null &&
    tosite.tyyppi !== TositeTyyppi.MYYNTILASKU &&
    tosite.tyyppi !== TositeTyyppi.HYVITYSLASKU;
  // Näkymämalli lasketaan kerran; sekä dokumentti että (Task 7) PDF-nappi käyttävät sitä.
  const asetukset = init?.asetukset;
  const malli = useMemo(
    () =>
      tosite && asetukset && !vieras
        ? laskuMalli({
            tosite,
            kumppanit: kumppanit ?? [],
            asetukset,
            ...(alkuperainen ? { alkuperainen } : {}),
          })
        : null,
    [tosite, asetukset, kumppanit, alkuperainen, vieras],
  );
  /** Lataa PDF: muodosta tavut → lataa selaimeen → yritä tallentaa liitteeksi vain-lisäävästi.
   *  Tallennusongelmat eivät koskaan estä latausta; vain PDF:n muodostusvirhe näytetään virheenä. */
  async function lataaPdf() {
    if (!tosite || !malli) return;
    setPdfTyossa(true);
    setPdfHuomio(null);
    setPdfHuomio(
      await lataaLaskuPdf({
        tosite,
        // Tämä reitti käsittelee vain laskuja ja hyvityslaskuja: aiempia asiakirjoja ei ole.
        muodosta: () => malli,
        client: {
          haeLiitteet: (id) => client.haeLiitteet(id),
          lisaaLiite: lisaa,
          haeTosite: (id) => client.haeTosite(id),
        },
        nyt: new Date().toISOString(),
      }),
    );
    setPdfTyossa(false);
  }
  useEffect(() => {
    if (vieras && tosite) {
      void navigate({ to: '/tositteet/$id', params: { id: String(tosite.id) }, replace: true });
    }
  }, [vieras, tosite, navigate]);

  if (isLoading || !init || alkuperainenLadataan || kumppanitLadataan)
    return <p className="px-[22px] py-5 text-[var(--text-muted)]">Ladataan…</p>;
  if (!tosite)
    return (
      <>
        <TopBar otsikko="Laskua ei löytynyt" />
        <section className="flex-1 px-[22px] py-5 text-[var(--text-muted)]">
          Laskua {id} ei ole.
        </section>
      </>
    );
  if (vieras || !malli) return null; // uudelleenohjaus käynnissä

  // Hyvitys (Task 9 -backfill): sama estologiikka kuin ostolaskunäkymässä — nappi
  // disabloituu kunnes myyntilaskurivi on ladattu ja aina kun lasku ei ole enää täysin
  // avoinna (avoin !== summa: osittain maksettu, kokonaan maksettu tai jo hyvitetty).
  // Moottori tukee vain täyshyvitystä, joten vain koskematon lasku on hyvitettävissä —
  // tämä disabloi Hyvitän myös käteis-/korttikuiteilla, joilla avoin=0 ≠ summa.
  const myyntirivi = myyntirivit?.find((r) => r.tosite === tosite.id);
  return (
    <>
      <TopBar
        otsikko={`${malli.otsikko} ${tosite.numero ?? ''}`.trim()}
        toiminnot={
          <>
            <EdellinenSeuraava
              kohde="lasku"
              naapurit={naapurit}
              onSiirry={(seuraavaId) =>
                void navigate({ to: '/myyntilaskut/$id', params: { id: String(seuraavaId) } })
              }
            />
            {/* Toisto vaatii kirjatun myyntilaskun (spec §5.2); tämä näkymä näyttää vain kirjattuja,
                luonnos avautuu lomakkeena ilman tätä nappia. Hyvityslaskua ei toisteta. */}
            {tosite.tyyppi === TositeTyyppi.MYYNTILASKU && (
              <Button variant="sec" type="button" onClick={() => setToistoAuki(true)}>
                Toista
              </Button>
            )}
            {/* Ennakkolaskusta ei tehdä hyvityslaskua (spec §6.1; moottori kieltäytyy koodilla
                ENNAKKOLASKU): ennakko hyvitetään loppulaskulla, joten nappia ei näytetä. */}
            {tosite.maksutapa !== Maksutapa.ENNAKKOLASKU && (
              <Button
                variant="sec"
                type="button"
                disabled={onHyvitys || !myyntirivi || myyntirivi.avoin !== myyntirivi.summa}
                onClick={() => setHyvitysAuki(true)}
              >
                Hyvitä
              </Button>
            )}
            {pdfHuomio && (
              <output className="text-[12px] text-[var(--text-muted)]">{pdfHuomio}</output>
            )}
            <Button
              type="button"
              disabled={malli.pdfEste !== null || pdfTyossa}
              title={malli.pdfEste ?? undefined}
              onClick={() => void lataaPdf()}
            >
              Lataa PDF
            </Button>
          </>
        }
      />
      <section
        aria-label="laskunaytto"
        className="flex-1 overflow-auto px-[22px] py-5 print:overflow-visible print:p-0"
      >
        <LaskuDokumentti malli={malli} tositeId={tosite.id} />
      </section>

      {toistoAuki && (
        <ToistoDialog
          tosite={tosite}
          onPeruuta={() => setToistoAuki(false)}
          onValmis={() => {
            setToistoAuki(false);
            void navigate({ to: '/toistot' });
          }}
        />
      )}
      {hyvitysAuki && (
        <HyvitaVahvistus
          tosite={tosite.id}
          onPeruuta={() => setHyvitysAuki(false)}
          onValmis={() => setHyvitysAuki(false)}
        />
      )}
    </>
  );
}
