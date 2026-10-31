import { AlvLaskelmaDokumentti, type DokumenttiOsio } from '@/alv/AlvLaskelmaDokumentti';
import { IlmoitusHistoria } from '@/alv/IlmoitusHistoria';
import { OmaVeroTayttoapu } from '@/alv/OmaVeroTayttoapu';
import { TilitaDialog } from '@/alv/TilitaDialog';
import { KAUSINIMET, VerokausiMuutokset } from '@/alv/VerokausiMuutokset';
import {
  type AlvKausi,
  alvErapaiva,
  alvKausiTilikaudella,
  erapaivanVari,
  kausiKkPaivalle,
  osuuTilikaudelle,
  parsiIlmoitusOtsikko,
  seuraavaAlvKausi,
  siirraKautta,
  verokausiHistoria,
  viimeisinIlmoitettu,
} from '@/alv/alvKaudet';
import { useAlvErittely, useAlvLaskelma, useEuMyynti, useInit, useTositteet } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { useValittuTilikausi } from '@/tilikausi/valittuTilikausi';
import {
  type EuMyyntiYhteenveto,
  type InitBundle,
  type StoredTosite,
  type Tilikausi,
  TositeTyyppi,
  lataaKartta,
  onkoAlvVelvollinen,
  onkoMaksuperusteinenAlv,
} from '@penni/engine';
import { muotoileEuro, muotoilePvm } from '@penni/euro';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';

export const Route = createFileRoute('/alv')({ component: AlvSivu });

/** Kuuluuko annettu ilmoitus valitulle tilikaudelle: parsittu kausi, muuten tositepäivä. */
function ilmoitusKaudella(t: StoredTosite, tilikausi: Tilikausi): boolean {
  const kausi = t.otsikko ? parsiIlmoitusOtsikko(t.otsikko) : null;
  return osuuTilikaudelle(kausi ?? { alkupvm: t.pvm, loppupvm: t.pvm }, tilikausi);
}

/** Legacy-tekstit yhdistettynä (spec §4.2). */
const VAHVISTUS =
  'Arvonlisäverolaskelma tallennettu. Huolehdi ilmoittamisesta verottajalle esimerkiksi OmaVerossa.';

const OTSIKKOLUOKKA =
  'pb-[7px] text-left text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

function AlvSivu() {
  const { data: init } = useInit();
  const { kausi: tilikausi } = useValittuTilikausi();
  // Vahvistus elää täällä (ei AlvNaytossa), jotta se säilyy rajan siirron key-remountin yli.
  const [vahvistus, setVahvistus] = useState<string | null>(null);

  if (!init) {
    return (
      <>
        <TopBar otsikko="Arvonlisävero" />
        <p className="px-[22px] py-5 text-[13.5px] text-[var(--text-muted)]">Ladataan…</p>
      </>
    );
  }
  return (
    <>
      <TopBar otsikko="Arvonlisävero" alaotsikko={init.asetukset.Nimi} />
      <section
        aria-label="alv-sivu"
        className="flex flex-1 flex-col gap-8 overflow-auto px-[22px] py-5 print:overflow-visible print:p-0"
      >
        {vahvistus && (
          <p className="text-[12.5px] text-[var(--positive)] print:hidden">{vahvistus}</p>
        )}
        {/* key: AlvIlmoitettu-rajan siirtyessä (tilitys/poisto) näkymä alustuu uudelleen,
            jolloin oletuskausi seuraa rajaa ilman erillistä tilasynkronointia. */}
        {/* key: myös tilikauden vaihto alustaa näkymän, jolloin oletuskausi on uuden
            tilikauden sisällä eikä edellisen kauden ‹ ›-selaus jää voimaan. */}
        <AlvNaytto
          key={`${init.asetukset.AlvIlmoitettu ?? ''}_${init.asetukset.AlvKausiHistoria ?? ''}_${tilikausi?.alkaa ?? ''}`}
          init={init}
          tilikausi={tilikausi}
          onVahvistus={() => setVahvistus(VAHVISTUS)}
        />
      </section>
    </>
  );
}

function AlvNaytto({
  init,
  tilikausi,
  onVahvistus,
}: {
  init: InitBundle;
  /** Sivupalkin valitsema tilikausi; alv-kaudet selataan sen sisällä. */
  tilikausi: Tilikausi | undefined;
  onVahvistus: () => void;
}) {
  const asetukset = init.asetukset;
  const historia = verokausiHistoria(asetukset);
  const raja = asetukset.AlvIlmoitettu;
  const [valittuKausi, setKausi] = useState<AlvKausi | null>(null);
  const [dialogiAuki, setDialogiAuki] = useState(false);
  const [verokausiAuki, setVerokausiAuki] = useState(false);
  // Osioiden taittotila elää täällä: dokumentti ja täyttöapu remountataan kauden vaihtuessa.
  const [osioAuki, setOsioAuki] = useState<Record<DokumenttiOsio | 'tayttoapu', boolean>>({
    laskelma: true,
    erittely: false,
    tayttoapu: false,
  });
  const vaihdaOsio = (osio: DokumenttiOsio | 'tayttoapu') =>
    setOsioAuki((a) => ({ ...a, [osio]: !a[osio] }));

  const { data: ilmoitukset } = useTositteet({ tyyppi: TositeTyyppi.ALVLASKELMA });
  // Ilmoitettu raja: asetus tai annettujen ilmoitusten kausista uusin (tuodussa kirjassa
  // asetus voi puuttua). Oletuskausi on ensimmäinen sen jälkeinen kausi.
  const ilmoitettuAsti = viimeisinIlmoitettu(raja, ilmoitukset ?? []);
  const oletusKausi = seuraavaAlvKausi(
    ilmoitettuAsti,
    historia,
    asetukset.AlvAlkaa,
    init.tilikaudet,
  );
  const kausi =
    valittuKausi ??
    (oletusKausi && tilikausi
      ? alvKausiTilikaudella(oletusKausi, tilikausi, historia)
      : oletusKausi);
  const params = kausi ?? { alkupvm: '', loppupvm: '' };
  const haeLaskelma = kausi !== null && ilmoitukset !== undefined;
  const { data: laskelma } = useAlvLaskelma(params, haeLaskelma);
  const { data: eu } = useEuMyynti(params, haeLaskelma);
  const { data: erittely, isError: erittelyVirhe } = useAlvErittely(params, haeLaskelma);
  const kartta = useMemo(() => lataaKartta(init.tilit), [init]);

  if (ilmoitukset === undefined) {
    return <p className="text-[13.5px] text-[var(--text-muted)]">Ladataan…</p>;
  }

  // Erikoistila: ei alv-velvollinen JA ei aiempia ilmoituksia (spec §3.2).
  const velvollinen = kausi !== null && onkoAlvVelvollinen(asetukset, kausi.loppupvm);
  if (!velvollinen && ilmoitukset.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-[13.5px] text-[var(--text-muted)]">
          Kirjanpito ei ole arvonlisäverovelvollinen. Voit ottaa alv-velvollisuuden käyttöön
          asetuksissa.
        </p>
        <Button variant="sec" asChild>
          <Link to="/asetukset">Avaa asetukset</Link>
        </Button>
      </div>
    );
  }
  if (kausi === null) {
    return <p className="text-[13.5px] text-[var(--text-muted)]">Ei tilikausia.</p>;
  }
  // Näytetyn kauden oma pituus (historia: pituus voi vaihtua vuosien välillä).
  const kausiKk = kausiKkPaivalle(historia, kausi.alkupvm);

  // Selainpäivä: vain UI-säännöt (kesken-vihje, eräpäivän väri) — ei rahaa (Kellohuomio).
  const tanaan = new Date().toISOString().slice(0, 10);
  const ilmoitettu = ilmoitettuAsti !== undefined && kausi.alkupvm <= ilmoitettuAsti;
  const kesken = kausi.loppupvm > tanaan;
  const maksuperusteinen = onkoMaksuperusteinenAlv(asetukset, kausi.loppupvm);
  const nolla = laskelma !== undefined && laskelma.koodit.size === 0;
  // Poikkeama 2 (laajennettu): tyhjä ESIKATSELU ei koskaan estä Tilitä-napin avaamista —
  // sekä maksuperusteinen vanhennus että marginaalivero tuottavat luvut vasta dialogin
  // valmistelussa (kirjaaMarginaalivero/vanhennaMaksuperusteinenAlv), joten sivutason
  // nollaesto sulkisi ainoan polun jolla marginaali- tai maksuperusteisen kauden voi
  // tilittää. Dialogin oma post-sweep-tarkistus (TilitaDialog) ja moottorin EITILITYSTA
  // ovat lopulliset vartijat aidosti tyhjälle kaudelle.
  const erapvm = alvErapaiva(kausi.loppupvm, historia);
  // Dokumentti näytetään (ja tulostetaan) kun laskelma on valmis ja erittely on joko haettu
  // tai sen haku on epäonnistunut (silloin dokumentti näyttää virherivin).
  const dokumenttiValmis = laskelma !== undefined && (erittely !== undefined || erittelyVirhe);
  const vari = erapaivanVari(erapvm, tanaan);

  return (
    <>
      {/* Kausikortti kattaa myös täyttöavun ja historian, jotta tarttuva kausirivi pysyy
          näkyvissä koko sivun vierityksen ajan. Tilitä/Tulosta ovat dokumentissa ilmoituksen
          tietojen alla, erittelyjen yläpuolella. */}
      <section aria-label="kausikortti" className="flex max-w-4xl flex-col print:max-w-none">
        {/* -top-5/-mt-5/pt-7: rivi ulottuu vierityssäiliön py-5-täytteeseen, jottei sisältö
            näy tarttuneen rivin yläpuolelta. */}
        <div className="sticky -top-5 z-10 -mx-[22px] -mt-5 flex items-center gap-2 bg-[var(--bg-app)] px-[22px] pt-7 pb-2 print:hidden">
          <Button
            variant="ghost"
            size="compact"
            type="button"
            aria-label="Edellinen kausi"
            disabled={tilikausi !== undefined && kausi.alkupvm <= tilikausi.alkaa}
            onClick={() => setKausi(siirraKautta(kausi, -1, historia))}
          >
            ‹
          </Button>
          <h2 className="text-[15px] font-[650] tabular-nums">
            {muotoilePvm(kausi.alkupvm)} – {muotoilePvm(kausi.loppupvm)}
          </h2>
          <Button
            variant="ghost"
            size="compact"
            type="button"
            aria-label="Seuraava kausi"
            disabled={tilikausi !== undefined && kausi.loppupvm >= tilikausi.loppuu}
            onClick={() => setKausi(siirraKautta(kausi, 1, historia))}
          >
            ›
          </Button>
          <Button
            variant="ghost"
            size="compact"
            type="button"
            aria-expanded={verokausiAuki}
            aria-label={`Verokausi: ${KAUSINIMET[kausiKk]}`}
            onClick={() => setVerokausiAuki((a) => !a)}
            className="text-[12.5px] font-normal text-[var(--text-muted)]"
          >
            {KAUSINIMET[kausiKk]}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          {ilmoitettu && (
            <span className="rounded-full bg-[var(--accent-soft)] px-2 py-[2px] text-[11px] font-semibold text-[var(--accent)]">
              Ilmoitettu
            </span>
          )}
          {maksuperusteinen && (
            <span className="rounded-full bg-[var(--positive-soft)] px-2 py-[2px] text-[11px] font-semibold text-[var(--positive)]">
              Maksuperusteinen
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-col gap-3 print:mt-0 print:gap-0">
          <div className="flex flex-col gap-3 print:hidden">
            {verokausiAuki && (
              <section
                aria-label="verokausi"
                className="rounded-[var(--radius-card)] border border-[var(--border)] p-3"
              >
                <VerokausiMuutokset asetukset={asetukset} />
              </section>
            )}
            <p className="text-[13px]">
              Eräpäivä{' '}
              <span
                className={
                  vari === 'danger'
                    ? 'font-semibold text-[var(--danger)]'
                    : vari === 'warn'
                      ? 'font-semibold text-[var(--warning)]'
                      : ''
                }
              >
                {muotoilePvm(erapvm)}
              </span>
            </p>
            {nolla && (
              <p className="text-[13.5px] text-[var(--text-muted)]">
                Kaudella ei ole arvonlisäverollisia tapahtumia (nollailmoitus).
              </p>
            )}
          </div>
          {dokumenttiValmis ? (
            <AlvLaskelmaDokumentti
              nimi={asetukset.Nimi}
              kausi={kausi}
              laskelma={laskelma}
              erittely={erittely ?? null}
              tilit={kartta}
              auki={osioAuki}
              onVaihda={vaihdaOsio}
              toiminnot={
                <>
                  {!ilmoitettu && (
                    <Button
                      type="button"
                      disabled={laskelma === undefined || kesken}
                      title={kesken ? 'Kausi on vielä kesken' : undefined}
                      onClick={() => setDialogiAuki(true)}
                    >
                      Tilitä
                    </Button>
                  )}
                  <Button
                    variant="sec"
                    type="button"
                    disabled={!dokumenttiValmis}
                    onClick={() => window.print()}
                  >
                    Tulosta
                  </Button>
                </>
              }
            />
          ) : (
            <p className="text-[13.5px] text-[var(--text-muted)] print:hidden">Ladataan…</p>
          )}
        </div>

        {/* Tulosteesta piilotetaan kaikki laskelman ulkopuolinen. */}
        <div className="mt-8 flex flex-col gap-8 print:hidden">
          {laskelma && (
            // key: kopiointikuittaus ei saa jäädä edellisen kauden riville.
            <OmaVeroTayttoapu
              key={`omavero_${kausi.alkupvm}_${kausi.loppupvm}`}
              kausi={kausi}
              kausiKk={kausiKk}
              laskelma={laskelma}
              erapvm={erapvm}
              ytunnus={asetukset.Ytunnus}
              ilmoitettu={ilmoitettu}
              auki={osioAuki.tayttoapu}
              onVaihda={() => vaihdaOsio('tayttoapu')}
            />
          )}

          {/* puuttuviaTunnuksia voi olla tosi vain kun rivejä on (euMyynti.ts:75) —
            rivit.length > 0 kattaa specin §5 näkyvyysehdon kokonaan. */}
          {eu && eu.rivit.length > 0 && <EuMyyntiOsio eu={eu} />}

          <IlmoitusHistoria
            ilmoitukset={
              tilikausi ? ilmoitukset.filter((t) => ilmoitusKaudella(t, tilikausi)) : ilmoitukset
            }
            kausiKk={historia}
            raja={raja}
            tilit={kartta}
            onValitse={setKausi}
          />
        </div>
      </section>

      {dialogiAuki && (
        // key: kausi vaihtuu taustalla (‹ › on näppäimistöllä tavoitettavissa, dialogilla ei
        // ole focus-trapia) — dialogin kaynnistetty-ref ei ikinä uudelleenviritä, joten ilman
        // remounttia otsikko seuraisi uutta kautta mutta valmisteltu laskelma jäisi vanhaan.
        // Uusi avain per kausi pakottaa tuoreet refit ja tuoreen valmistelun aina kun kausi
        // muuttuu, jolloin näytetyt luvut eivät voi koskaan poiketa tilitettävästä kaudesta.
        <TilitaDialog
          key={`${kausi.alkupvm}_${kausi.loppupvm}`}
          kausi={kausi}
          kausiKk={historia}
          onPeruuta={() => setDialogiAuki(false)}
          onValmis={() => {
            setDialogiAuki(false);
            onVahvistus();
          }}
        />
      )}
    </>
  );
}

function EuMyyntiOsio({ eu }: { eu: EuMyyntiYhteenveto }) {
  return (
    <section aria-label="eu-myynti" className="flex max-w-2xl flex-col gap-2">
      <h2 className="text-[15px] font-[650]">EU-myynnin yhteenveto</h2>
      {eu.puuttuviaTunnuksia && (
        <p className="text-[12.5px] text-[var(--danger)]">
          Kaikilla yhteisömyynnin asiakkailla ei ole ALV-tunnusta — täydennä tunnukset ennen
          yhteenvetoilmoituksen antamista.
        </p>
      )}
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={OTSIKKOLUOKKA}>Asiakas</th>
            <th className={OTSIKKOLUOKKA}>ALV-tunnus</th>
            <th className={OTSIKKOLUOKKA}>Maa</th>
            <th className={`${OTSIKKOLUOKKA} text-right`}>Tavaramyynti</th>
            <th className={`${OTSIKKOLUOKKA} text-right`}>Palvelumyynti</th>
          </tr>
        </thead>
        <tbody>
          {eu.rivit.map((rivi) => (
            <tr key={rivi.kumppani} className="border-t border-[var(--border-faint)]">
              <td className="py-[5px]">{rivi.nimi}</td>
              <td className="py-[5px] tabular-nums">{rivi.alvtunnus ?? '—'}</td>
              <td className="py-[5px]">{rivi.maa ?? ''}</td>
              <td className="py-[5px] text-right tabular-nums">{muotoileEuro(rivi.tavara)}</td>
              <td className="py-[5px] text-right tabular-nums">{muotoileEuro(rivi.palvelu)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11.5px] text-[var(--text-subtle)]">
        Anna yhteenvetoilmoitus OmaVerossa myyntikuukautta seuraavan kuukauden 20. päivään mennessä.
      </p>
    </section>
  );
}
