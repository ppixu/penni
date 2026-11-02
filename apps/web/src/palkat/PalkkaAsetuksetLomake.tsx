import { useInit } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { TiliValitsin } from '@/editori/TiliValitsin';
import { KENTTA_LUOKKA, LABEL_LUOKKA, VIHJE_LUOKKA, VIRHE_LUOKKA } from '@/palkat/lomakeLuokat';
import { muotoileBp, parsiBp } from '@/palkat/prosentti';
import { TYEL_YHTIOT } from '@/palkat/tyelYhtiot';
import { PALKKATILI_KOODIT, usePalkatAsetukset } from '@/palkat/usePalkatAsetukset';
import { type Tili, lataaKartta } from '@penni/engine';
import {
  PALKKATILIT_OLETUS,
  type PalkatAsetukset,
  type PalkkaKoodi,
  type Palkkatilit,
  type TaulukkoOhitus,
  haeTaulukko,
} from '@penni/palkat';
import { muotoileYtunnus, tarkistaYtunnus } from '@penni/validator';
import { useMemo, useState } from 'react';

const MUU = 'muu';

/** Taulukon oletus-TyEL-prosentti tekstinä. Ei koskaan heitä: tallennettu data ei saa kaataa sivua. */
function tyelOletus(
  vuosi: number,
  ohitus: TaulukkoOhitus,
  kentta: 'tyelOletusKokonaisBp' | 'tyelTilapainenKokonaisBp',
): string {
  try {
    const haku = haeTaulukko(vuosi, ohitus, [kentta]);
    return haku.ok ? muotoileBp(haku.taulukko[kentta]) : 'ei taulukossa';
  } catch {
    return 'ei taulukossa';
  }
}

function virheTeksti(e: unknown): string {
  return e instanceof Error ? e.message : 'Tallennus epäonnistui.';
}

/** Työnantajan tiedot: TyEL-yhtiö ja -sopimus, TyEL-prosentti vuodelle, liput, yhteyshenkilö. */
export function TyonantajaLomake({ vuosi }: { vuosi: number }) {
  const { asetukset, ohitus, tallennaAsetukset, tallentaa, virheet } = usePalkatAsetukset();
  const onLista = (koodi: string | undefined) => TYEL_YHTIOT.some((y) => y.koodi === koodi);
  const [yhtioValinta, setYhtioValinta] = useState(
    asetukset.tyelYhtio === undefined || onLista(asetukset.tyelYhtio)
      ? (asetukset.tyelYhtio ?? '')
      : MUU,
  );
  const [muuKoodi, setMuuKoodi] = useState(
    onLista(asetukset.tyelYhtio) ? '' : (asetukset.tyelYhtio ?? ''),
  );
  const [sopimus, setSopimus] = useState(asetukset.tyelSopimus ?? '');
  const [tyelTekstit, setTyelTekstit] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(asetukset.tyelKokonaisBp ?? {}).map(([v, bp]) => [v, muotoileBp(bp)]),
    ),
  );
  const [tilapainen, setTilapainen] = useState(asetukset.tilapainenTyonantaja);
  const [tvrVapautus, setTvrVapautus] = useState(asetukset.tvrVapautus);
  const [tapaturmaYhtio, setTapaturmaYhtio] = useState(asetukset.tapaturmaYhtio ?? '');
  const [tapaturmaSopimus, setTapaturmaSopimus] = useState(asetukset.tapaturmaSopimus ?? '');
  const [yhteysNimi, setYhteysNimi] = useState(asetukset.yhteyshenkilo?.nimi ?? '');
  const [yhteysPuhelin, setYhteysPuhelin] = useState(asetukset.yhteyshenkilo?.puhelin ?? '');
  const [omaVero, setOmaVero] = useState(asetukset.omaVeroViite ?? '');
  const [virhe, setVirhe] = useState<string | null>(null);
  const [tallennettu, setTallennettu] = useState(false);

  // Oletusprosentti taulukosta (tilapäisellä työnantajalla oma arvo), mukana käyttäjän omat arvot.
  const oletusKentta = tilapainen ? 'tyelTilapainenKokonaisBp' : 'tyelOletusKokonaisBp';
  const oletus = tyelOletus(vuosi, ohitus, oletusKentta);

  async function laheta() {
    setTallennettu(false);
    setVirhe(null);
    const tyelKokonaisBp: Record<string, number> = {};
    for (const [v, teksti] of Object.entries(tyelTekstit)) {
      if (teksti.trim() === '') continue;
      const bp = parsiBp(teksti);
      if (bp === null) {
        setVirhe(`Tarkista TyEL-kokonaismaksu (${v}): anna prosentti, esim. 24,85.`);
        return;
      }
      tyelKokonaisBp[v] = bp;
    }
    const yhtio = (yhtioValinta === MUU ? muuKoodi : yhtioValinta).trim();
    const sopimusSiisti = sopimus.trim();
    // Sama ehto kuin Tulorekisterin XML:n rakentajalla (tyelTiedot): tunnus 2 tai 5 numeroa,
    // vakuutusnumero alkaa tunnuksella ja on enintään 11 merkkiä.
    if (yhtio !== '' || sopimusSiisti !== '') {
      if (!/^(\d{2}|\d{5})$/.test(yhtio)) {
        setVirhe(
          'Valitse TyEL-vakuutusyhtiö (tai anna eläkelaitoksen koodi, 2 tai 5 numeroa) vakuutusnumeron kanssa.',
        );
        return;
      }
      if (!sopimusSiisti.startsWith(yhtio) || sopimusSiisti.length > 11) {
        setVirhe(
          sopimusSiisti.length > 11
            ? 'Vakuutusnumero saa olla enintään 11 merkkiä.'
            : `Vakuutusnumeron pitää alkaa eläkelaitoksen tunnuksella (${yhtio}).`,
        );
        return;
      }
    }
    // Tapaturmavakuutus ilmoitetaan vain, kun molemmat tiedot on annettu (Y-tunnus kelvollinen).
    const tapaturmaTunnus = tapaturmaYhtio.trim();
    const tapaturmaNumero = tapaturmaSopimus.trim();
    if (tapaturmaTunnus !== '' || tapaturmaNumero !== '') {
      if (tapaturmaTunnus === '' || !tarkistaYtunnus(tapaturmaTunnus)) {
        setVirhe('Tarkista tapaturmavakuutusyhtiön Y-tunnus.');
        return;
      }
      if (tapaturmaNumero === '') {
        setVirhe('Anna tapaturmavakuutuksen numero tai tyhjennä Y-tunnus.');
        return;
      }
    }
    const uusi: PalkatAsetukset = {
      tilapainenTyonantaja: tilapainen,
      tvrVapautus,
      ...(yhtio !== '' ? { tyelYhtio: yhtio } : {}),
      ...(sopimusSiisti !== '' ? { tyelSopimus: sopimusSiisti } : {}),
      ...(Object.keys(tyelKokonaisBp).length > 0 ? { tyelKokonaisBp } : {}),
      ...(tapaturmaTunnus !== '' ? { tapaturmaYhtio: muotoileYtunnus(tapaturmaTunnus) } : {}),
      ...(tapaturmaNumero !== '' ? { tapaturmaSopimus: tapaturmaNumero } : {}),
      ...(yhteysNimi.trim() !== '' || yhteysPuhelin.trim() !== ''
        ? { yhteyshenkilo: { nimi: yhteysNimi.trim(), puhelin: yhteysPuhelin.trim() } }
        : {}),
      ...(omaVero.trim() !== '' ? { omaVeroViite: omaVero.trim() } : {}),
    };
    try {
      await tallennaAsetukset(uusi);
      setTallennettu(true);
    } catch (e) {
      setVirhe(virheTeksti(e));
    }
  }

  return (
    <section aria-label="työnantajan tiedot" className="flex max-w-md flex-col gap-3">
      <h2 className="text-[15px] font-[650]">Työnantajan tiedot</h2>
      {virheet.asetukset && (
        <p role="alert" className={VIRHE_LUOKKA}>
          Tallennetut palkka-asetukset ovat virheelliset: {virheet.asetukset}
        </p>
      )}

      <label className={LABEL_LUOKKA}>
        TyEL-vakuutusyhtiö
        <select
          aria-label="TyEL-vakuutusyhtiö"
          value={yhtioValinta}
          onChange={(e) => setYhtioValinta(e.target.value)}
          className={KENTTA_LUOKKA}
        >
          <option value="">Valitse yhtiö</option>
          {TYEL_YHTIOT.map((y) => (
            <option key={y.koodi} value={y.koodi}>
              {y.nimi}
            </option>
          ))}
          <option value={MUU}>Muu (eläkesäätiö tms.), anna koodi</option>
        </select>
      </label>
      {yhtioValinta === MUU && (
        <label className={LABEL_LUOKKA}>
          Eläkelaitoksen koodi
          <input
            aria-label="Eläkelaitoksen koodi"
            inputMode="numeric"
            value={muuKoodi}
            onChange={(e) => setMuuKoodi(e.target.value)}
            className={KENTTA_LUOKKA}
          />
          <span className={VIHJE_LUOKKA}>
            Tulorekisterin koodisto (PensionProvIdCode), esim. eläkesäätiön viisinumeroinen koodi.
          </span>
        </label>
      )}
      <label className={LABEL_LUOKKA}>
        TyEL-sopimusnumero
        <input
          aria-label="TyEL-sopimusnumero"
          value={sopimus}
          onChange={(e) => setSopimus(e.target.value)}
          className={KENTTA_LUOKKA}
        />
      </label>
      <label className={LABEL_LUOKKA}>
        TyEL-kokonaismaksu (%)
        <input
          aria-label="TyEL-kokonaismaksu (%)"
          inputMode="decimal"
          placeholder={oletus}
          value={tyelTekstit[String(vuosi)] ?? ''}
          onChange={(e) => setTyelTekstit({ ...tyelTekstit, [String(vuosi)]: e.target.value })}
          className={`${KENTTA_LUOKKA} text-right tabular-nums`}
        />
        <span className={VIHJE_LUOKKA}>
          Vuoden {vuosi} kokonaismaksu sopimuksesi mukaan. Tyhjänä käytetään taulukon oletusta{' '}
          {oletus} %.
        </span>
      </label>

      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          aria-label="Tilapäinen työnantaja"
          checked={tilapainen}
          onChange={(e) => setTilapainen(e.target.checked)}
        />
        Tilapäinen työnantaja
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          aria-label="Palkkasumma alle 1 500 €/v (vapautus työttömyysvakuutusmaksusta)"
          checked={tvrVapautus}
          onChange={(e) => setTvrVapautus(e.target.checked)}
        />
        Palkkasumma alle 1 500 €/v (vapautus työttömyysvakuutusmaksusta)
      </label>

      <label className={LABEL_LUOKKA}>
        Tapaturmavakuutusyhtiön Y-tunnus
        <input
          aria-label="Tapaturmavakuutusyhtiön Y-tunnus"
          value={tapaturmaYhtio}
          onChange={(e) => setTapaturmaYhtio(e.target.value)}
          className={KENTTA_LUOKKA}
        />
      </label>
      <label className={LABEL_LUOKKA}>
        Tapaturmavakuutuksen numero
        <input
          aria-label="Tapaturmavakuutuksen numero"
          value={tapaturmaSopimus}
          onChange={(e) => setTapaturmaSopimus(e.target.value)}
          className={KENTTA_LUOKKA}
        />
        <span className={VIHJE_LUOKKA}>
          Valinnainen: tapaturmavakuutus ilmoitetaan Tulorekisteriin vain, kun molemmat tiedot on
          annettu.
        </span>
      </label>

      <label className={LABEL_LUOKKA}>
        Yhteyshenkilön nimi
        <input
          aria-label="Yhteyshenkilön nimi"
          value={yhteysNimi}
          onChange={(e) => setYhteysNimi(e.target.value)}
          className={KENTTA_LUOKKA}
        />
      </label>
      <label className={LABEL_LUOKKA}>
        Yhteyshenkilön puhelin
        <input
          aria-label="Yhteyshenkilön puhelin"
          value={yhteysPuhelin}
          onChange={(e) => setYhteysPuhelin(e.target.value)}
          className={KENTTA_LUOKKA}
        />
      </label>
      <label className={LABEL_LUOKKA}>
        OmaVero-viite
        <input
          aria-label="OmaVero-viite"
          value={omaVero}
          onChange={(e) => setOmaVero(e.target.value)}
          className={KENTTA_LUOKKA}
        />
        <span className={VIHJE_LUOKKA}>Oma-aloitteisten verojen maksuviite.</span>
      </label>

      {virhe && (
        <p role="alert" className={VIRHE_LUOKKA}>
          {virhe}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button disabled={tallentaa || virheet.asetukset !== undefined} onClick={laheta}>
          Tallenna työnantajan tiedot
        </Button>
        {tallennettu && (
          <output className="text-[12.5px] text-[var(--text-muted)]">Tallennettu</output>
        )}
      </div>
    </section>
  );
}

const TILI_SELITE: Record<PalkkaKoodi, string> = {
  PA: 'Palkat',
  LK: 'Lisät ja muut palkkaerät',
  LU: 'Luontoisedut (kulu)',
  LV: 'Luontoisedut (vastatili)',
  KM: 'Kilometrikorvaukset',
  PR: 'Päivärahat',
  AT: 'Ateriakorvaukset',
  EP: 'Ennakonpidätysvelka',
  SB: 'Sairausvakuutusmaksuvelka (sava)',
  SV: 'Sairausvakuutusmaksu (kulu)',
  EL: 'Työnantajan TyEL-maksu (kulu)',
  TV: 'Työnantajan työttömyysvakuutusmaksu (kulu)',
  TL: 'TyEL-velka',
  TT: 'Työttömyysvakuutusvelka',
  MP: 'Nettopalkkojen maksutili',
};

/** Palkkatilit: kullekin koodille tilivalitsin; MP (nettopalkkojen maksutili) on pakollinen. */
export function PalkkatiliLomake() {
  const { data: init } = useInit();
  const { palkkatiliLuonnos, mpPuuttuu, tallennaPalkkatilit, tallentaa, virheet } =
    usePalkatAsetukset();
  const tilit = useMemo<Tili[]>(() => (init ? lataaKartta(init.tilit) : []), [init]);
  const [valinta, setValinta] = useState<Partial<Palkkatilit>>(palkkatiliLuonnos);
  const [virhe, setVirhe] = useState<string | null>(null);
  const [tallennettu, setTallennettu] = useState(false);
  const mpValittu = valinta.MP !== undefined;

  async function laheta() {
    setTallennettu(false);
    setVirhe(null);
    if (valinta.MP === undefined) {
      setVirhe('Valitse nettopalkkojen maksutili ennen tallennusta.');
      return;
    }
    // Puuttuvat koodit täydennetään yritystilikartan oletuksilla ensimmäisessä tallennuksessa.
    const koko: Palkkatilit = { ...PALKKATILIT_OLETUS, ...valinta, MP: valinta.MP };
    try {
      await tallennaPalkkatilit(koko);
      setTallennettu(true);
    } catch (e) {
      setVirhe(virheTeksti(e));
    }
  }

  return (
    <section aria-label="palkkatilit" className="flex max-w-xl flex-col gap-3">
      <h2 className="text-[15px] font-[650]">Palkkatilit</h2>
      <p className="text-[12.5px] text-[var(--text-muted)]">
        Tilit, joille palkka-ajon tosite kirjataan. TyEL- ja työttömyysvakuutusmaksut jaksotetaan
        velkatileille (TL, TT), ja vakuutuslaitoksen lasku maksetaan ostolaskuna näitä vastaan.
      </p>
      {virheet.palkkatilit && (
        <p role="alert" className={VIRHE_LUOKKA}>
          Tallennettu palkkatilit-asetus on virheellinen: {virheet.palkkatilit}
        </p>
      )}
      {(mpPuuttuu || !mpValittu) && (
        <p className="text-[12.5px] font-semibold text-[var(--accent)]">
          Valitse nettopalkkojen maksutili
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-2">
        {PALKKATILI_KOODIT.map((koodi) => (
          <div key={koodi} className="contents">
            <span className="text-[12.5px]">
              <span className="inline-block w-[28px] font-semibold tabular-nums">{koodi}</span>
              {TILI_SELITE[koodi]}
            </span>
            <div className="rounded-[6px] border border-[var(--border-strong)] px-[10px] py-[6px] text-[13px]">
              <TiliValitsin
                tilit={tilit}
                arvo={valinta[koodi]}
                ariaLabel={`${koodi} ${TILI_SELITE[koodi]}`}
                onValitse={(numero) => {
                  setTallennettu(false);
                  setValinta((v) => ({ ...v, [koodi]: numero }));
                }}
              />
            </div>
          </div>
        ))}
      </div>
      {virhe && (
        <p role="alert" className={VIRHE_LUOKKA}>
          {virhe}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button disabled={tallentaa || virheet.palkkatilit !== undefined} onClick={laheta}>
          Tallenna palkkatilit
        </Button>
        {tallennettu && (
          <output className="text-[12.5px] text-[var(--text-muted)]">Tallennettu</output>
        )}
      </div>
    </section>
  );
}
