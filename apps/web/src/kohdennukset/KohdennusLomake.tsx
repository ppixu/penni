import { Button } from '@/components/ui/button';
import {
  type Kohdennus,
  type KohdennusKaytolla,
  KohdennusTyyppi,
  type UusiKohdennus,
  kohdennuksenNimi,
} from '@penni/engine';
import { useState } from 'react';
import { kohdennusTyyppiNimi } from './kohdennusTeksti';

const LABEL_LUOKKA =
  'flex flex-col gap-1 text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';
const KENTTA_LUOKKA =
  'rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px] disabled:opacity-60';

const TYYPIT = [
  KohdennusTyyppi.KUSTANNUSPAIKKA,
  KohdennusTyyppi.PROJEKTI,
  KohdennusTyyppi.MERKKAUS,
] as const;

type TyyppiArvo = (typeof TYYPIT)[number];

/**
 * Kohdennuslomake (luonti + muokkaus). `alkuarvo` annettuna muokataan olemassa olevaa: kentät,
 * joita lomake ei näytä (kielet, Kitsaksen avaimet), kulkevat mukana, mutta johdettu `lkm` ei.
 * Luonnissa `tyyppi` määrää alkutyypin. Tyyppi lukitaan, kun kohdennus on käytössä, sillä on
 * budjettia tai kustannuspaikalla on projekteja. Reitti omistaa mutaation; lomake kenttätilan ja paikallisen
 * validoinnin.
 */
export function KohdennusLomake({
  alkuarvo,
  tyyppi,
  kaikki,
  budjetoitu = false,
  oletusKausi,
  tallentaa,
  virhe,
  onTallenna,
  onPeruuta,
}: {
  alkuarvo?: KohdennusKaytolla | undefined;
  tyyppi?: TyyppiArvo | undefined;
  kaikki: readonly Kohdennus[];
  /** Muokattavalla kohdennuksella on budjettirivejä jollakin tilikaudella. */
  budjetoitu?: boolean | undefined;
  /** Määräaikaisuuden oletuspäivät: tilikausi, jolla tänään on. */
  oletusKausi?: { alkaa: string; loppuu: string } | undefined;
  tallentaa: boolean;
  virhe?: string | null | undefined;
  onTallenna: (syote: UusiKohdennus) => void;
  onPeruuta: () => void;
}) {
  const [nimi, setNimi] = useState(alkuarvo ? kohdennuksenNimi(alkuarvo) : '');
  const [valittuTyyppi, setValittuTyyppi] = useState<TyyppiArvo>(
    alkuarvo?.tyyppi ?? tyyppi ?? KohdennusTyyppi.KUSTANNUSPAIKKA,
  );
  const [kuuluu, setKuuluu] = useState(String(alkuarvo?.kuuluu ?? 0));
  const [maaraaikainen, setMaaraaikainen] = useState(Boolean(alkuarvo?.alkaa || alkuarvo?.paattyy));
  const [alkaa, setAlkaa] = useState(alkuarvo?.alkaa ?? '');
  const [paattyy, setPaattyy] = useState(alkuarvo?.paattyy ?? '');
  const [paikallinenVirhe, setPaikallinenVirhe] = useState<string | null>(null);

  const kustannuspaikat = kaikki.filter((k) => k.tyyppi === KohdennusTyyppi.KUSTANNUSPAIKKA);
  const kaytossa = (alkuarvo?.lkm ?? 0) > 0;
  const onProjekteja =
    alkuarvo !== undefined &&
    alkuarvo.tyyppi === KohdennusTyyppi.KUSTANNUSPAIKKA &&
    kaikki.some((k) => k.tyyppi === KohdennusTyyppi.PROJEKTI && k.kuuluu === alkuarvo.id);
  const tyyppiLukossa = kaytossa || onProjekteja || budjetoitu;
  const lukonSyy = kaytossa
    ? `Käytössä ${alkuarvo?.lkm} viennillä, tyyppiä ei voi vaihtaa`
    : onProjekteja
      ? 'Kustannuspaikalla on projekteja, tyyppiä ei voi vaihtaa'
      : budjetoitu
        ? 'Kohdennuksella on budjetti, tyyppiä ei voi vaihtaa'
        : undefined;

  function vaihdaMaaraaikaisuus(paalla: boolean) {
    setMaaraaikainen(paalla);
    // Oletuksena tilikausi, jolla tänään on (Kitsas); jo annettuja päiviä ei ylikirjoiteta.
    if (paalla && alkaa === '' && paattyy === '' && oletusKausi) {
      setAlkaa(oletusKausi.alkaa);
      setPaattyy(oletusKausi.loppuu);
    }
  }

  function laheta() {
    setPaikallinenVirhe(null);
    if (nimi.trim() === '') {
      setPaikallinenVirhe('Anna kohdennuksen nimi.');
      return;
    }
    if (maaraaikainen && alkaa !== '' && paattyy !== '' && paattyy < alkaa) {
      setPaikallinenVirhe('Päättymispäivä ei voi olla ennen alkamispäivää.');
      return;
    }
    // Pohjana muokattava kohdennus ilman johdettua lkm:ää ja lomakkeen omia kenttiä; ne
    // asetetaan alla tuoreina, jolloin tyhjennetty kenttä myös poistuu tallennuksesta.
    const {
      lkm: _lkm,
      kuuluu: _kuuluu,
      alkaa: _alkaa,
      paattyy: _paattyy,
      ...muut
    } = alkuarvo ?? {};
    const syote: UusiKohdennus = {
      ...muut,
      tyyppi: valittuTyyppi,
      nimi: { ...alkuarvo?.nimi, fi: nimi.trim() },
      ...(valittuTyyppi === KohdennusTyyppi.PROJEKTI && Number(kuuluu) > 0
        ? { kuuluu: Number(kuuluu) }
        : {}),
      ...(maaraaikainen && alkaa !== '' ? { alkaa } : {}),
      ...(maaraaikainen && paattyy !== '' ? { paattyy } : {}),
    };
    onTallenna(syote);
  }

  return (
    <form
      aria-label={alkuarvo ? 'Muokkaa kohdennusta' : 'Uusi kohdennus'}
      onSubmit={(e) => {
        e.preventDefault();
        laheta();
      }}
      className="mb-6 flex max-w-[560px] flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] px-[16px] py-[14px]"
    >
      <h2 className="text-[15px] font-[650]">
        {alkuarvo
          ? 'Muokkaa kohdennusta'
          : `Uusi ${kohdennusTyyppiNimi(valittuTyyppi).toLowerCase()}`}
      </h2>
      <label className={LABEL_LUOKKA}>
        Nimi
        <input
          aria-label="Nimi"
          value={nimi}
          onChange={(e) => setNimi(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: lomake avataan käyttäjän toimesta, nimi on ensimmäinen kenttä
          autoFocus
          className={KENTTA_LUOKKA}
        />
      </label>
      <label className={LABEL_LUOKKA}>
        Tyyppi
        <select
          aria-label="Tyyppi"
          value={valittuTyyppi}
          disabled={tyyppiLukossa}
          title={lukonSyy}
          onChange={(e) => setValittuTyyppi(Number(e.target.value) as TyyppiArvo)}
          className={KENTTA_LUOKKA}
        >
          {TYYPIT.map((t) => (
            <option key={t} value={t}>
              {kohdennusTyyppiNimi(t)}
            </option>
          ))}
        </select>
      </label>
      {valittuTyyppi === KohdennusTyyppi.PROJEKTI && (
        <label className={LABEL_LUOKKA}>
          Kuuluu
          <select
            aria-label="Kuuluu"
            value={kuuluu}
            onChange={(e) => setKuuluu(e.target.value)}
            className={KENTTA_LUOKKA}
          >
            <option value="0">Yleinen</option>
            {kustannuspaikat.map((k) => (
              <option key={k.id} value={k.id}>
                {kohdennuksenNimi(k)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          aria-label="Määräaikainen"
          checked={maaraaikainen}
          onChange={(e) => vaihdaMaaraaikaisuus(e.target.checked)}
        />
        Määräaikainen
      </label>
      {maaraaikainen && (
        <div className="grid grid-cols-2 gap-3">
          <label className={LABEL_LUOKKA}>
            Alkaa
            <input
              type="date"
              aria-label="Alkaa"
              value={alkaa}
              onChange={(e) => setAlkaa(e.target.value)}
              className={KENTTA_LUOKKA}
            />
          </label>
          <label className={LABEL_LUOKKA}>
            Päättyy
            <input
              type="date"
              aria-label="Päättyy"
              value={paattyy}
              onChange={(e) => setPaattyy(e.target.value)}
              className={KENTTA_LUOKKA}
            />
          </label>
        </div>
      )}
      {(paikallinenVirhe ?? virhe) && (
        <p role="alert" className="text-[12.5px] text-[var(--danger)]">
          {paikallinenVirhe ?? virhe}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={tallentaa}>
          Tallenna
        </Button>
        <Button type="button" variant="sec" onClick={onPeruuta}>
          Peruuta
        </Button>
      </div>
    </form>
  );
}
