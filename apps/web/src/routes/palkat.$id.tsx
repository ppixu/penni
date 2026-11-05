import { useKpClient } from '@/app/KpClientProvider';
import { avaimet, useTosite } from '@/app/kysely';
import { TopBar } from '@/components/shell/TopBar';
import { Button, buttonVariants } from '@/components/ui/button';
import { AjonTaulukko } from '@/palkat/LaskelmaYhteenveto';
import { lataaTiedosto } from '@/palkat/lataaTiedosto';
import { PalkkaAjoVirhe } from '@/palkat/palkkaAjoTiedot';
import { palkkalaskelmat, palkkatietoilmoitus } from '@/palkat/palkkaAjonTiedostot';
import { merkitseLahetetyksi } from '@/palkat/tallennaPalkkaAjo';
import { ResourceError, type StoredTosite, TositeTila, TositeTyyppi } from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';
import {
  PalkatVirhe,
  omaVeroEraPaiva,
  palkkatietoilmoituksenMaarapaiva,
  sha256Hex,
} from '@penni/palkat';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

export const Route = createFileRoute('/palkat/$id')({ component: PalkanmaksuReitti });

function PalkanmaksuReitti() {
  const { id } = Route.useParams();
  return <Palkanmaksu key={id} id={Number(id)} />;
}

const LINKKI = 'font-semibold underline';

/** Tiedoston muodostuksen virhe käyttäjälle, linkki sinne, mistä puute korjataan. */
function tiedostoVirhe(e: unknown): ReactNode {
  if (e instanceof PalkkaAjoVirhe && e.koodi === 'YTUNNUS') {
    return (
      <>
        {e.message}{' '}
        <Link to="/asetukset" className={LINKKI}>
          Kirjan asetukset
        </Link>
      </>
    );
  }
  if (e instanceof PalkkaAjoVirhe && e.koodi === 'YHTEYSHENKILO') {
    return (
      <>
        {e.message}{' '}
        <Link to="/palkat/asetukset" className={LINKKI}>
          Palkka-asetukset
        </Link>
      </>
    );
  }
  if (e instanceof PalkkaAjoVirhe && (e.koodi === 'XML_MUUTTUNUT' || e.koodi === 'LAHETETTY')) {
    return e.message;
  }
  if (e instanceof PalkatVirhe || e instanceof PalkkaAjoVirhe) {
    return (
      <>
        {e.message} Tarkista{' '}
        <Link to="/palkat/tyontekijat" className={LINKKI}>
          työntekijät
        </Link>{' '}
        ja{' '}
        <Link to="/palkat/asetukset" className={LINKKI}>
          palkka-asetukset
        </Link>
        .
      </>
    );
  }
  return e instanceof Error && e.message ? e.message : 'Tiedoston muodostus epäonnistui.';
}

function toimintoVirhe(e: unknown, oletus: string): string {
  if (e instanceof ResourceError && e.code === 'PVMLUKITTU')
    return 'Palkka-ajo on lukitulla kaudella, eikä sitä voi muuttaa.';
  return e instanceof Error && e.message ? e.message : oletus;
}

const OHJE = 'text-[12.5px] text-[var(--text-muted)]';

function Palkanmaksu({ id }: { id: number }) {
  const { data: tosite, isLoading } = useTosite(id);
  const client = useKpClient();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tyossa, setTyossa] = useState(false);
  const [virhe, setVirhe] = useState<ReactNode>(null);
  /** Tässä näkymässä viimeksi ladatun XML:n SHA-256: merkintä tallentaa vain lähetetyn tiedoston tiivisteen. */
  const [ladattuSha, setLadattuSha] = useState<string | null>(null);

  if (isLoading) {
    return <p className="px-[22px] py-5 text-[13.5px] text-[var(--text-muted)]">Ladataan…</p>;
  }
  const avaaTosite = (
    <Link to="/tositteet/$id" params={{ id: String(id) }} className="underline">
      Avaa tosite
    </Link>
  );
  if (!tosite || tosite.tyyppi !== TositeTyyppi.PALKKA || !tosite.palkka) {
    return (
      <>
        <TopBar otsikko="Palkanmaksu" />
        <section className="flex flex-1 flex-col gap-2 px-[22px] py-5 text-[13px] text-[var(--text-muted)]">
          <p>{tosite ? 'Tosite ei ole palkka-ajo.' : `Palkka-ajoa ${id} ei ole.`}</p>
          {tosite ? <p>{avaaTosite}</p> : null}
        </section>
      </>
    );
  }

  const t: StoredTosite = tosite;
  const ajo = tosite.palkka;
  const lahetetty = ajo.ilmoitus;
  const poistettu = t.tila === TositeTila.POISTETTU;
  const nro = t.tunniste > 0 ? `${t.sarja} ${t.tunniste}`.trim() : '';
  const maarapaiva = palkkatietoilmoituksenMaarapaiva(t.pvm);
  const omaVero = ajo.henkilot.reduce(
    (a, h) => a + h.tulos.ennakonpidatys + h.tulos.sava,
    0,
  ) as Cents;

  async function tee(toiminto: () => Promise<void>) {
    setTyossa(true);
    setVirhe(null);
    try {
      await toiminto();
    } finally {
      setTyossa(false);
    }
  }

  const lataaXml = () =>
    tee(async () => {
      try {
        const { nimi, xml } = await palkkatietoilmoitus(client, t);
        lataaTiedosto(xml, nimi, 'application/xml');
        setLadattuSha(await sha256Hex(xml));
      } catch (e) {
        setVirhe(tiedostoVirhe(e));
      }
    });

  const lataaLaskelmat = () =>
    tee(async () => {
      try {
        for (const { nimi, pdf } of await palkkalaskelmat(client, t)) {
          lataaTiedosto(pdf, nimi, 'application/pdf');
        }
      } catch (e) {
        setVirhe(tiedostoVirhe(e));
      }
    });

  const merkitse = () =>
    tee(async () => {
      if (!ladattuSha) return;
      if (
        !window.confirm(
          'Merkitäänkö palkkatietoilmoitus lähetetyksi? Palkkalaskelmat liitetään tositteeseen, eikä palkka-ajoa voi sen jälkeen muuttaa Pennissä.',
        )
      )
        return;
      try {
        await merkitseLahetetyksi(client, t.id, ladattuSha);
      } catch (e) {
        setVirhe(
          e instanceof PalkatVirhe || e instanceof PalkkaAjoVirhe
            ? tiedostoVirhe(e)
            : toimintoVirhe(e, 'Merkintä epäonnistui.'),
        );
        return;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: avaimet.tosite(t.id) }),
        qc.invalidateQueries({ queryKey: avaimet.liitteet(t.id) }),
        qc.invalidateQueries({ queryKey: ['tositteet'] }),
      ]);
    });

  const poista = () =>
    tee(async () => {
      if (
        !window.confirm(
          `Poistetaanko palkka-ajo${nro ? ` ${nro}` : ''}? Tosite poistetaan kirjanpidosta, ja poisto kirjataan tositelokiin.`,
        )
      )
        return;
      try {
        await client.poistaTosite(t.id);
      } catch (e) {
        setVirhe(toimintoVirhe(e, 'Poisto epäonnistui.'));
        return;
      }
      await Promise.all(
        ['tositteet', 'tosite', 'saldot', 'viennit', 'raportti'].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      );
      await navigate({ to: '/tositteet' });
    });

  const muokattava = !lahetetty && !poistettu;

  return (
    <>
      <TopBar
        otsikko={`Palkanmaksu${nro ? ` ${nro}` : ''}`}
        alaotsikko={`Maksupäivä ${muotoilePvm(t.pvm)} · kausi ${muotoilePvm(ajo.kausiAlkaa)}–${muotoilePvm(ajo.kausiLoppuu)}`}
        toiminnot={
          <>
            <Button
              variant="sec"
              type="button"
              disabled={tyossa}
              onClick={() => void lataaLaskelmat()}
            >
              Lataa palkkalaskelmat
            </Button>
            <Button variant="sec" type="button" disabled={tyossa} onClick={() => void lataaXml()}>
              Lataa XML
            </Button>
            {muokattava ? (
              <>
                <Link
                  to="/palkat/$id/muokkaa"
                  params={{ id: String(t.id) }}
                  className={buttonVariants({ variant: 'sec' })}
                >
                  Muokkaa
                </Link>
                <Button variant="sec" type="button" disabled={tyossa} onClick={() => void poista()}>
                  Poista
                </Button>
                <Button
                  type="button"
                  disabled={tyossa || !ladattuSha}
                  title={ladattuSha ? undefined : 'Lataa ensin XML ja vie se Tulorekisteriin.'}
                  onClick={() => void merkitse()}
                >
                  Merkitse lähetetyksi
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <section
        aria-label="palkanmaksu"
        className="flex flex-1 flex-col gap-5 overflow-auto px-[22px] py-5"
      >
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <span className="font-semibold text-[var(--text)]">Palkkatietoilmoitus</span>
          <span className="text-[var(--text-muted)]">Määräpäivä {muotoilePvm(maarapaiva)}</span>
          {lahetetty ? (
            <span className="rounded-full border border-[var(--positive-border)] bg-[var(--positive-soft)] px-[9px] py-[2px] text-[11.5px] font-semibold text-[var(--positive)]">
              Lähetetty {muotoilePvm(lahetetty.lahetetty)}
            </span>
          ) : null}
          {poistettu ? (
            <span className="text-[var(--danger)]">Palkka-ajo on poistettu.</span>
          ) : null}
        </div>
        {lahetetty ? (
          <p className={OHJE}>
            Ilmoitus on merkitty lähetetyksi (tunniste {lahetetty.deliveryId}), joten palkka-ajoa ei
            voi enää muuttaa Pennissä. Jo lähetetyn ilmoituksen korjaukset tehdään Tulorekisterin
            asiointipalvelussa.
          </p>
        ) : !poistettu ? (
          <p className={`${OHJE} ${ladattuSha ? 'font-semibold text-[var(--text)]' : ''}`}>
            Kun olet ladannut XML:n Tulorekisterin lataus- ja tallennuspalveluun, merkitse ilmoitus
            lähetetyksi. Jo lähetetyn ilmoituksen korjaukset tehdään Tulorekisterin
            asiointipalvelussa.
          </p>
        ) : null}
        {virhe ? (
          <p role="alert" className="text-[12.5px] text-[var(--danger)]">
            {virhe}
          </p>
        ) : null}

        <AjonTaulukko henkilot={ajo.henkilot} />

        <p className={OHJE}>
          OmaVeroon maksettavaa (ennakonpidätykset ja sairausvakuutusmaksu){' '}
          <span className="tabular-nums text-[var(--text)]">{muotoileEuro(omaVero)}</span>, eräpäivä{' '}
          {muotoilePvm(omaVeroEraPaiva(t.pvm.slice(0, 7)))}. {avaaTosite}
        </p>
      </section>
    </>
  );
}
