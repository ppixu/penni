import { VerokausiMuutokset } from '@/alv/VerokausiMuutokset';
import { useInit, useKohdennukset, usePaivitaAsetukset, useTallennaTilikausi } from '@/app/kysely';
import { seuraavaKausi } from '@/asetukset/asetukset';
import { SalasananVaihto } from '@/auth/SalasananVaihto';
import { useKayttaja } from '@/auth/kayttajaKonteksti';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/button';
import { DEMO } from '@/demo/tila';
import { VieKirjanpito } from '@/vienti/VieKirjanpito';
import type { AsetuksetPatch } from '@penni/asiakas';
import { type Asetukset, type Tilikausi, asetusPaalla } from '@penni/engine';
import { muotoilePvm } from '@penni/euro';
import { tarkistaIban } from '@penni/validator';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const LK_LUOKKA =
  'rounded-[var(--radius-input)] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]';

/** Varalista yritysmuodoille, jos asetukset.muodot puuttuu tai on viallinen. */
const VARA_MUODOT: ReadonlyArray<readonly [string, string]> = [
  ['oy', 'Osakeyhtiö'],
  ['tmi', 'Toiminimi'],
  ['ay', 'Avoin yhtiö'],
  ['ky', 'Kommandiittiyhtiö'],
  ['osk', 'Osuuskunta'],
];

/** Pura asetukset.muodot (JSON: { code: { fi, sv } }) [code, fi]-pareiksi; varalista virhetilanteessa. */
function muotoVaihtoehdot(asetukset: Asetukset): ReadonlyArray<readonly [string, string]> {
  const raaka = asetukset.muodot;
  if (typeof raaka === 'string' && raaka !== '') {
    try {
      const map = JSON.parse(raaka) as Record<string, { fi?: string }>;
      const parit = Object.entries(map).map(
        ([koodi, nimet]) => [koodi, nimet.fi ?? koodi] as const,
      );
      if (parit.length > 0) return parit;
    } catch {
      // putoa varalistaan
    }
  }
  return VARA_MUODOT;
}

export function AsetuksetSivu() {
  const { data: init } = useInit();
  const kayttaja = useKayttaja();

  if (!init) {
    return (
      <>
        <TopBar otsikko="Asetukset" />
        <p className="px-[22px] py-5 text-[13.5px] text-[var(--text-muted)]">Ladataan…</p>
      </>
    );
  }

  return (
    <>
      <TopBar otsikko="Asetukset" alaotsikko={init.asetukset.Nimi} />
      <section
        aria-label="asetukset"
        className="flex flex-1 flex-col gap-8 overflow-auto px-[22px] py-5"
      >
        <OrganisaatioLomake asetukset={init.asetukset} />
        <TilikausiOsio tilikaudet={init.tilikaudet} />
        <div className="flex max-w-md flex-col gap-4">
          <h2 className="text-[15px] font-[650]">Vie kirjanpito</h2>
          <VieKirjanpito />
        </div>
        <KohdennuksetOsio />
        {/* Kysy tarvitsee paikallisen kielimallin — ei selaindemossa. */}
        {!DEMO && <KysyOsio asetukset={init.asetukset} />}
        {kayttaja ? <SalasananVaihto onVaihda={kayttaja.vaihdaSalasana} /> : null}
        <TietojaOsio />
      </section>
    </>
  );
}

function OrganisaatioLomake({ asetukset }: { asetukset: Asetukset }) {
  const { tallenna, virheviesti, tallentaa } = usePaivitaAsetukset();
  const muodot = muotoVaihtoehdot(asetukset);

  // Lomakkeen paikallinen tila siemennetään nykyisistä asetuksista (tyhjä teksti -> '').
  const [nimi, setNimi] = useState(asetukset.Nimi ?? '');
  const [ytunnus, setYtunnus] = useState(asetukset.Ytunnus ?? '');
  const [kotipaikka, setKotipaikka] = useState(asetukset.Kotipaikka ?? '');
  const [muoto, setMuoto] = useState(asetukset.muoto ?? '');
  // AlvVelvollinen tallennetaan merkkijonona 'true'/'false' (Kitsas-tuonti: 'ON'/'EI').
  const [alv, setAlv] = useState(asetusPaalla(asetukset.AlvVelvollinen));
  // AlvAlkaa on ISO-päivämäärä 'YYYY-MM-DD' (tyhjä -> ei alkamispäivää).
  const [alvAlkaa, setAlvAlkaa] = useState(asetukset.AlvAlkaa ?? '');
  // Maksuperusteinen alv: puuttuva avain → tyhjä kenttä; tyhjennys poistaa avaimen.
  const [maksuAlvAlkaa, setMaksuAlvAlkaa] = useState(asetukset.MaksuAlvAlkaa ?? '');
  const [maksuAlvLoppuu, setMaksuAlvLoppuu] = useState(asetukset.MaksuAlvLoppuu ?? '');
  // Laskutustiedot (myyjäblokki + maksuyhteys laskudokumentille).
  const [osoite, setOsoite] = useState(asetukset.Osoite ?? '');
  const [postinumero, setPostinumero] = useState(asetukset.Postinumero ?? '');
  const [kaupunki, setKaupunki] = useState(asetukset.Kaupunki ?? '');
  const [puhelin, setPuhelin] = useState(asetukset.Puhelin ?? '');
  const [email, setEmail] = useState(asetukset.Email ?? '');
  const [kotisivu, setKotisivu] = useState(asetukset.Kotisivu ?? '');
  const [iban, setIban] = useState(asetukset.LaskuIban ?? '');
  const [ibanVirhe, setIbanVirhe] = useState<string | null>(null);
  const [tallennettu, setTallennettu] = useState(false);

  async function lahetaTallennus() {
    setTallennettu(false);
    setIbanVirhe(null);
    // IBAN normalisoidaan (välit pois, isot kirjaimet) ja validoidaan; tyhjä on sallittu.
    const ibanSiisti = iban.replace(/\s/g, '').toUpperCase();
    if (ibanSiisti !== '' && !tarkistaIban(ibanSiisti)) {
      setIbanVirhe('Tarkista IBAN');
      return;
    }
    // Harva PATCH: vain muuttuneet avaimet.
    const patch: AsetuksetPatch = {};
    if (nimi !== (asetukset.Nimi ?? '')) patch.Nimi = nimi;
    if (ytunnus !== (asetukset.Ytunnus ?? '')) patch.Ytunnus = ytunnus;
    if (kotipaikka !== (asetukset.Kotipaikka ?? '')) patch.Kotipaikka = kotipaikka;
    if (muoto !== (asetukset.muoto ?? '')) patch.muoto = muoto;
    const alvArvo = alv ? 'true' : 'false';
    if (alvArvo !== (asetukset.AlvVelvollinen ?? 'false')) patch.AlvVelvollinen = alvArvo;
    if (alvAlkaa !== (asetukset.AlvAlkaa ?? '')) patch.AlvAlkaa = alvAlkaa;
    // Tyhjennys poistaa avaimen null-patchilla (olemassa oleva mekanismi).
    if (maksuAlvAlkaa !== (asetukset.MaksuAlvAlkaa ?? ''))
      patch.MaksuAlvAlkaa = maksuAlvAlkaa === '' ? null : maksuAlvAlkaa;
    if (maksuAlvLoppuu !== (asetukset.MaksuAlvLoppuu ?? ''))
      patch.MaksuAlvLoppuu = maksuAlvLoppuu === '' ? null : maksuAlvLoppuu;
    if (osoite !== (asetukset.Osoite ?? '')) patch.Osoite = osoite;
    if (postinumero !== (asetukset.Postinumero ?? '')) patch.Postinumero = postinumero;
    if (kaupunki !== (asetukset.Kaupunki ?? '')) patch.Kaupunki = kaupunki;
    // Alatunnisteen yhteystiedot: valinnaisia, tyhjennys poistaa avaimen null-patchilla.
    if (puhelin !== (asetukset.Puhelin ?? ''))
      patch.Puhelin = puhelin.trim() === '' ? null : puhelin.trim();
    if (email !== (asetukset.Email ?? '')) patch.Email = email.trim() === '' ? null : email.trim();
    if (kotisivu !== (asetukset.Kotisivu ?? ''))
      patch.Kotisivu = kotisivu.trim() === '' ? null : kotisivu.trim();
    // Tyhjennys poistaa avaimen null-patchilla (olemassa oleva mekanismi).
    if (ibanSiisti !== (asetukset.LaskuIban ?? ''))
      patch.LaskuIban = ibanSiisti === '' ? null : ibanSiisti;

    const ok = await tallenna(patch);
    if (ok) setTallennettu(true);
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      <h2 className="text-[15px] font-[650]">Organisaation tiedot</h2>
      <label className={LABEL_LUOKKA}>
        Nimi
        <input
          type="text"
          aria-label="Nimi"
          value={nimi}
          onChange={(e) => setNimi(e.target.value)}
          className={LK_LUOKKA}
        />
      </label>
      <label className={LABEL_LUOKKA}>
        Y-tunnus
        {/* Tier-0: pelkkä teksti, ei tarkistussummaa. Tier-1: lisää suomalainen Y-tunnus-validaattori. */}
        <input
          type="text"
          aria-label="Y-tunnus"
          value={ytunnus}
          onChange={(e) => setYtunnus(e.target.value)}
          className={LK_LUOKKA}
        />
      </label>
      <label className={LABEL_LUOKKA}>
        Kotipaikka
        <input
          type="text"
          aria-label="Kotipaikka"
          value={kotipaikka}
          onChange={(e) => setKotipaikka(e.target.value)}
          className={LK_LUOKKA}
        />
      </label>
      <label className={LABEL_LUOKKA}>
        Osoite
        <textarea
          aria-label="Osoite"
          value={osoite}
          onChange={(e) => setOsoite(e.target.value)}
          rows={2}
          className={LK_LUOKKA}
        />
      </label>
      <div className="grid grid-cols-[120px_1fr] gap-3">
        <label className={LABEL_LUOKKA}>
          Postinumero
          <input
            type="text"
            aria-label="Postinumero"
            value={postinumero}
            onChange={(e) => setPostinumero(e.target.value)}
            className={LK_LUOKKA}
          />
        </label>
        <label className={LABEL_LUOKKA}>
          Kaupunki
          <input
            type="text"
            aria-label="Kaupunki"
            value={kaupunki}
            onChange={(e) => setKaupunki(e.target.value)}
            className={LK_LUOKKA}
          />
        </label>
      </div>
      <label className={LABEL_LUOKKA}>
        Puhelin
        <input
          type="text"
          aria-label="Puhelin"
          value={puhelin}
          onChange={(e) => setPuhelin(e.target.value)}
          className={LK_LUOKKA}
        />
      </label>
      <label className={LABEL_LUOKKA}>
        Sähköposti
        <input
          type="text"
          aria-label="Sähköposti"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={LK_LUOKKA}
        />
      </label>
      <label className={LABEL_LUOKKA}>
        Kotisivu
        <input
          type="text"
          aria-label="Kotisivu"
          value={kotisivu}
          onChange={(e) => setKotisivu(e.target.value)}
          className={LK_LUOKKA}
        />
      </label>
      <label className={LABEL_LUOKKA}>
        Yritysmuoto
        <select
          aria-label="Yritysmuoto"
          value={muoto}
          onChange={(e) => setMuoto(e.target.value)}
          className={LK_LUOKKA}
        >
          {muodot.map(([koodi, nimi]) => (
            <option key={koodi} value={koodi}>
              {nimi}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          aria-label="Arvonlisäverovelvollinen"
          checked={alv}
          onChange={(e) => setAlv(e.target.checked)}
        />
        Arvonlisäverovelvollinen
      </label>
      <label className={LABEL_LUOKKA}>
        ALV-velvollisuus alkaa
        <input
          type="date"
          aria-label="ALV-velvollisuus alkaa"
          value={alvAlkaa}
          onChange={(e) => setAlvAlkaa(e.target.value)}
          className={LK_LUOKKA}
        />
      </label>
      {/* Verokauden pituus on historia (alv/alvKaudet.ts) ja tallentuu omalla napillaan. */}
      <div className={LABEL_LUOKKA}>
        ALV-ilmoituskausi
        <div className="font-normal normal-case tracking-normal text-[var(--text)]">
          <VerokausiMuutokset asetukset={asetukset} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL_LUOKKA}>
          Maksuperusteinen ALV alkaen
          <input
            type="date"
            aria-label="Maksuperusteinen ALV alkaen"
            value={maksuAlvAlkaa}
            onChange={(e) => setMaksuAlvAlkaa(e.target.value)}
            className={LK_LUOKKA}
          />
        </label>
        <label className={LABEL_LUOKKA}>
          Maksuperusteinen ALV päättyen
          <input
            type="date"
            aria-label="Maksuperusteinen ALV päättyen"
            value={maksuAlvLoppuu}
            onChange={(e) => setMaksuAlvLoppuu(e.target.value)}
            className={LK_LUOKKA}
          />
        </label>
      </div>
      <p className="text-[11.5px] text-[var(--text-subtle)]">
        Maksuperusteisessa alv:ssä vero kohdistetaan maksupäivälle. Koskee vain LASKU-maksutavan
        myyntiä ja ostovelkakirjauksia.
      </p>
      <label className={LABEL_LUOKKA}>
        IBAN
        <input
          type="text"
          aria-label="IBAN"
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          className={`${LK_LUOKKA} tabular-nums`}
        />
      </label>
      {(ibanVirhe ?? virheviesti) && (
        <p className="text-[12.5px] text-[var(--danger)]">{ibanVirhe ?? virheviesti}</p>
      )}
      {tallennettu && <p className="text-[12.5px] text-[var(--positive)]">Tallennettu</p>}
      <div>
        <Button type="button" disabled={tallentaa} onClick={lahetaTallennus}>
          Tallenna
        </Button>
      </div>
    </div>
  );
}

function TilikausiOsio({ tilikaudet }: { tilikaudet: readonly Tilikausi[] }) {
  const { tallenna, virheviesti, tallentaa } = useTallennaTilikausi();
  // Tilikaudet ovat jo alkaa-järjestyksessä; viimeinen on aktiivinen/uusin.
  const viimeinenIndeksi = tilikaudet.length - 1;
  const viimeinen = tilikaudet[viimeinenIndeksi];

  async function lisaaSeuraava() {
    if (!viimeinen) return;
    const { alkaa, loppuu } = seuraavaKausi(viimeinen);
    // Lisäys loppuun: URL-avain (alkaa) ja kentät samat — puhdas luonti, ei päällekkäisyyttä.
    await tallenna(alkaa, { alkaa, loppuu });
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      <h2 className="text-[15px] font-[650]">Tilikaudet</h2>
      <ul aria-label="tilikaudet" className="flex flex-col gap-1">
        {tilikaudet.length === 0 && (
          <li className="text-[13px] text-[var(--text-muted)]">Ei tilikausia.</li>
        )}
        {tilikaudet.map((k, i) => {
          const aktiivinen = i === viimeinenIndeksi;
          return (
            <li
              key={k.alkaa}
              data-aktiivinen={aktiivinen ? 'true' : 'false'}
              className={`flex items-center justify-between rounded-[var(--radius-input)] px-[10px] py-2 text-[13px] tabular-nums ${
                aktiivinen
                  ? 'bg-[var(--accent-soft)] font-[600] text-[var(--text)]'
                  : 'text-[var(--text-muted)]'
              }`}
            >
              <span>
                {muotoilePvm(k.alkaa)} – {muotoilePvm(k.loppuu)}
              </span>
              <Link
                to="/budjetti"
                search={{ tilikausi: k.alkaa }}
                aria-label={`Budjetti ${muotoilePvm(k.alkaa)} – ${muotoilePvm(k.loppuu)}`}
                className="text-[12.5px] font-normal text-[var(--accent)] hover:underline"
              >
                Budjetti
              </Link>
            </li>
          );
        })}
      </ul>
      {virheviesti && <p className="text-[12.5px] text-[var(--danger)]">{virheviesti}</p>}
      <div>
        <Button
          variant="sec"
          type="button"
          disabled={tallentaa || viimeinen === undefined}
          onClick={lisaaSeuraava}
        >
          Uusi tilikausi
        </Button>
      </div>
    </div>
  );
}

function KohdennuksetOsio() {
  const { data: kohdennukset } = useKohdennukset();
  const lkm = kohdennukset?.length ?? 0;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <h2 className="text-[15px] font-[650]">Kohdennukset</h2>
      <p className="text-[12.5px] text-[var(--text-muted)]">
        Kustannuspaikoilla, projekteilla ja merkkauksilla seuraat, mihin toimintaan tulot ja menot
        kuuluvat, ja voit verrata niitä budjettiin.
      </p>
      {kohdennukset && (
        <p className="text-[13px]">
          {lkm === 0 ? 'Ei vielä kohdennuksia.' : lkm === 1 ? '1 kohdennus' : `${lkm} kohdennusta`}
        </p>
      )}
      <div>
        <Button asChild variant="sec">
          <Link to="/kohdennukset">Muokkaa kohdennuksia</Link>
        </Button>
      </div>
    </div>
  );
}

function KysyOsio({ asetukset }: { asetukset: Asetukset }) {
  const { tallenna, virheviesti, tallentaa } = usePaivitaAsetukset();

  // Puuttuva/tyhjä avain -> tyhjä kenttä; oletusmalli näytetään placeholderina.
  const [malli, setMalli] = useState(asetukset.KysyMalli ?? '');
  const [tallennettu, setTallennettu] = useState(false);

  async function lahetaTallennus() {
    setTallennettu(false);
    // Harva PATCH: vain muuttunut avain. Tyhjennys (myös pelkkä whitespace) poistaa avaimen
    // null-patchilla; reunavälit siivotaan pois ennen tallennusta.
    const patch: AsetuksetPatch = {};
    const trimmattu = malli.trim();
    if (trimmattu !== (asetukset.KysyMalli ?? ''))
      patch.KysyMalli = trimmattu === '' ? null : trimmattu;

    const ok = await tallenna(patch);
    if (ok) setTallennettu(true);
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      <h2 className="text-[15px] font-[650]">Kysy</h2>
      <label className={LABEL_LUOKKA}>
        Paikallinen malli
        <input
          type="text"
          aria-label="Paikallinen malli"
          value={malli}
          onChange={(e) => setMalli(e.target.value)}
          placeholder="qwen3.5:2b"
          className={LK_LUOKKA}
        />
      </label>
      {virheviesti && <p className="text-[12.5px] text-[var(--danger)]">{virheviesti}</p>}
      {tallennettu && <p className="text-[12.5px] text-[var(--positive)]">Tallennettu</p>}
      <div>
        <Button type="button" disabled={tallentaa} onClick={lahetaTallennus}>
          Tallenna malli
        </Button>
      </div>
    </div>
  );
}

function TietojaOsio() {
  return (
    <div className="flex max-w-md flex-col gap-2">
      <h2 className="text-[15px] font-[650]">Tietoja</h2>
      <p className="text-[13px] text-[var(--text-muted)]">
        Versio, tekijänoikeus, lisenssi ja lähdekoodi.{' '}
        <Link to="/tietoja" className="text-[var(--accent)] hover:underline">
          Tietoja Pennistä
        </Link>
      </p>
    </div>
  );
}
