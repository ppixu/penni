import { Button } from '@/components/ui/button';
import { EuroInput } from '@/editori/EuroInput';
import { KENTTA_LUOKKA, LABEL_LUOKKA, VIHJE_LUOKKA, VIRHE_LUOKKA } from '@/palkat/lomakeLuokat';
import { muotoileBp, parsiBp } from '@/palkat/prosentti';
import { uusiTyontekijaId } from '@/palkat/tyontekijaId';
import type { Vakuutusperuste } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { type Tyontekija, type Verokortti, tarkistaHetu } from '@penni/palkat';
import { tarkistaIban } from '@penni/validator';
import { useState } from 'react';

const AMMATTILUOKITUS_URL = 'https://www.stat.fi/fi/luokitukset/ammatti/';
const NOLLA = 0 as Cents;

interface KorttiRivi {
  /** Alkuperäinen tallennettu verokortti: tuntemattomat kentät säilyvät muokkauksessa. */
  alkuperainen: Partial<Verokortti> | undefined;
  alkaa: string;
  paattyy: string;
  perus: string;
  lisa: string;
  tuloraja: Cents;
  aiemmin: Cents;
}

function korttiRiviksi(v: Verokortti): KorttiRivi {
  return {
    alkuperainen: v,
    alkaa: v.alkaa,
    paattyy: v.paattyy,
    perus: muotoileBp(v.perusBp),
    lisa: v.lisaBp === 0 ? '' : muotoileBp(v.lisaBp),
    tuloraja: v.tuloraja,
    aiemmin: v.aiemminMaksettu,
  };
}

function uusiKorttiRivi(): KorttiRivi {
  const vuosi = new Date().getFullYear();
  return {
    alkuperainen: undefined,
    alkaa: `${vuosi}-01-01`,
    paattyy: `${vuosi}-12-31`,
    perus: '',
    lisa: '',
    tuloraja: NOLLA,
    aiemmin: NOLLA,
  };
}

const normalisoiHetu = (s: string) => s.trim().toUpperCase();
const normalisoiIban = (s: string) => s.replace(/\s/g, '').toUpperCase();

/** Tallennettavat verokortit tai virheilmoitukset riveittäin. */
function kokoaKortit(rivit: KorttiRivi[]): { kortit: Verokortti[]; virheet: string[] } {
  const kortit: Verokortti[] = [];
  const virheet: string[] = [];
  rivit.forEach((r, i) => {
    const n = i + 1;
    const perusBp = parsiBp(r.perus);
    const lisaBp = r.lisa.trim() === '' ? 0 : parsiBp(r.lisa);
    if (r.alkaa === '' || r.paattyy === '' || r.alkaa > r.paattyy) {
      virheet.push(`Verokortti ${n}: tarkista voimassaolon päivämäärät`);
    } else if (perusBp === null) {
      virheet.push(`Verokortti ${n}: tarkista perusprosentti`);
    } else if (lisaBp === null) {
      virheet.push(`Verokortti ${n}: tarkista lisäprosentti`);
    } else {
      kortit.push({
        ...r.alkuperainen,
        alkaa: r.alkaa,
        paattyy: r.paattyy,
        perusBp,
        lisaBp,
        tuloraja: r.tuloraja,
        aiemminMaksettu: r.aiemmin,
      });
    }
  });
  return { kortit, virheet };
}

/**
 * Työntekijälomake (lisäys + muokkaus). Työntekijää ei poisteta: "Aktiivinen" poistaa hänet
 * uusilta palkka-ajoilta. Henkilötunnus tallennetaan normalisoituna (trimmattu, isot kirjaimet);
 * se näkyy vain tässä lomakkeessa, ei listoissa, eikä sitä lokiteta.
 */
export function TyontekijaLomake({
  alkuarvo,
  kaytossaOlevatIdt,
  toiminimi,
  tallentaa,
  virhe,
  onTallenna,
  onPeru,
}: {
  alkuarvo?: Tyontekija | undefined;
  kaytossaOlevatIdt: ReadonlySet<string>;
  /** Kirjan yritysmuoto on toiminimi: YEL-valinnalle näytetään huomautus. */
  toiminimi: boolean;
  tallentaa: boolean;
  virhe?: string | null | undefined;
  onTallenna: (t: Tyontekija) => void;
  onPeru: () => void;
}) {
  const [nimi, setNimi] = useState(alkuarvo?.nimi ?? '');
  const [hetu, setHetu] = useState(alkuarvo?.hetu ?? '');
  const [katu, setKatu] = useState(alkuarvo?.osoite?.katu ?? '');
  const [postinumero, setPostinumero] = useState(alkuarvo?.osoite?.postinumero ?? '');
  const [kaupunki, setKaupunki] = useState(alkuarvo?.osoite?.kaupunki ?? '');
  const [iban, setIban] = useState(alkuarvo?.iban ?? '');
  const [vakuutusperuste, setVakuutusperuste] = useState<Vakuutusperuste>(
    alkuarvo?.vakuutusperuste ?? 'tyontekija',
  );
  const [ammattikoodi, setAmmattikoodi] = useState(alkuarvo?.ammattikoodi ?? '');
  const [palkkamuoto, setPalkkamuoto] = useState<'kuukausi' | 'tunti'>(
    alkuarvo?.palkkamuoto ?? 'kuukausi',
  );
  const [kuukausipalkka, setKuukausipalkka] = useState<Cents>(alkuarvo?.kuukausipalkka ?? NOLLA);
  const [tuntipalkka, setTuntipalkka] = useState<Cents>(alkuarvo?.tuntipalkka ?? NOLLA);
  const [puhelinetu, setPuhelinetu] = useState(alkuarvo?.puhelinetu ?? false);
  const [aktiivinen, setAktiivinen] = useState(alkuarvo?.aktiivinen ?? true);
  const [kortit, setKortit] = useState<KorttiRivi[]>(
    () => alkuarvo?.verokortit.map(korttiRiviksi) ?? [],
  );
  const [hetuKosketettu, setHetuKosketettu] = useState(false);
  const [ibanKosketettu, setIbanKosketettu] = useState(false);
  const [yritetty, setYritetty] = useState(false);

  const hetuVirhe = !tarkistaHetu(normalisoiHetu(hetu)) ? 'Tarkista henkilötunnus' : null;
  const ibanVirhe =
    normalisoiIban(iban) !== '' && !tarkistaIban(normalisoiIban(iban)) ? 'Tarkista IBAN' : null;
  const koodiPakollinen = vakuutusperuste !== 'yel';
  const koodi = ammattikoodi.trim();
  const koodiVirhe =
    (koodiPakollinen || koodi !== '') && !/^\d{5}$/.test(koodi)
      ? 'Anna viisinumeroinen ammattikoodi'
      : null;
  const nimiVirhe = nimi.trim() === '' ? 'Anna työntekijän nimi' : null;
  const { kortit: kelvolliset, virheet: korttiVirheet } = kokoaKortit(kortit);

  const naytaHetuVirhe = (hetuKosketettu || yritetty) && hetuVirhe;
  const naytaIbanVirhe = (ibanKosketettu || yritetty) && ibanVirhe;

  function laheta() {
    setYritetty(true);
    if (nimiVirhe || hetuVirhe || ibanVirhe || koodiVirhe || korttiVirheet.length > 0) return;
    const {
      osoite: _osoite,
      iban: _iban,
      ammattikoodi: _koodi,
      kuukausipalkka: _kk,
      tuntipalkka: _tunti,
      ...muut
    } = alkuarvo ?? ({} as Partial<Tyontekija>);
    const osoiteOn = [katu, postinumero, kaupunki].some((s) => s.trim() !== '');
    const tyontekija: Tyontekija = {
      ...muut,
      id: alkuarvo?.id ?? uusiTyontekijaId(kaytossaOlevatIdt),
      nimi: nimi.trim(),
      hetu: normalisoiHetu(hetu),
      ...(osoiteOn
        ? {
            osoite: {
              katu: katu.trim(),
              postinumero: postinumero.trim(),
              kaupunki: kaupunki.trim(),
            },
          }
        : {}),
      ...(normalisoiIban(iban) !== '' ? { iban: normalisoiIban(iban) } : {}),
      vakuutusperuste,
      ...(koodi !== '' ? { ammattikoodi: koodi } : {}),
      palkkamuoto,
      ...(kuukausipalkka > 0 ? { kuukausipalkka } : {}),
      ...(tuntipalkka > 0 ? { tuntipalkka } : {}),
      puhelinetu,
      verokortit: kelvolliset,
      aktiivinen,
    };
    onTallenna(tyontekija);
  }

  function paivitaKortti(i: number, osa: Partial<KorttiRivi>) {
    setKortit((rivit) => rivit.map((r, j) => (j === i ? { ...r, ...osa } : r)));
  }

  return (
    <section
      aria-label="työntekijälomake"
      className="flex max-w-[640px] flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] p-4"
    >
      <h2 className="text-[15px] font-[650]">
        {alkuarvo ? 'Muokkaa työntekijää' : 'Uusi työntekijä'}
      </h2>

      <label className={LABEL_LUOKKA}>
        Nimi
        <input
          aria-label="Nimi"
          value={nimi}
          onChange={(e) => setNimi(e.target.value)}
          className={KENTTA_LUOKKA}
        />
        <span className={VIHJE_LUOKKA}>Sukunimi ensin, kuten palkkalaskelmalla.</span>
        {yritetty && nimiVirhe && <span className={VIRHE_LUOKKA}>{nimiVirhe}</span>}
      </label>

      <label className={LABEL_LUOKKA}>
        Henkilötunnus
        <input
          aria-label="Henkilötunnus"
          value={hetu}
          autoComplete="off"
          onChange={(e) => setHetu(e.target.value)}
          onBlur={() => setHetuKosketettu(true)}
          aria-invalid={naytaHetuVirhe ? true : undefined}
          className={KENTTA_LUOKKA}
        />
        {naytaHetuVirhe && <span className={VIRHE_LUOKKA}>{naytaHetuVirhe}</span>}
      </label>

      <label className={LABEL_LUOKKA}>
        Katuosoite
        <input
          aria-label="Katuosoite"
          value={katu}
          onChange={(e) => setKatu(e.target.value)}
          className={KENTTA_LUOKKA}
        />
      </label>
      <div className="grid grid-cols-[120px_1fr] gap-3">
        <label className={LABEL_LUOKKA}>
          Postinumero
          <input
            aria-label="Postinumero"
            value={postinumero}
            onChange={(e) => setPostinumero(e.target.value)}
            className={KENTTA_LUOKKA}
          />
        </label>
        <label className={LABEL_LUOKKA}>
          Kaupunki
          <input
            aria-label="Kaupunki"
            value={kaupunki}
            onChange={(e) => setKaupunki(e.target.value)}
            className={KENTTA_LUOKKA}
          />
        </label>
      </div>

      <label className={LABEL_LUOKKA}>
        IBAN
        <input
          aria-label="IBAN"
          value={iban}
          autoComplete="off"
          onChange={(e) => setIban(e.target.value)}
          onBlur={() => setIbanKosketettu(true)}
          aria-invalid={naytaIbanVirhe ? true : undefined}
          className={KENTTA_LUOKKA}
        />
        {naytaIbanVirhe && <span className={VIRHE_LUOKKA}>{naytaIbanVirhe}</span>}
      </label>

      <label className={LABEL_LUOKKA}>
        Vakuutusperuste
        <select
          aria-label="Vakuutusperuste"
          value={vakuutusperuste}
          onChange={(e) => setVakuutusperuste(e.target.value as Vakuutusperuste)}
          className={KENTTA_LUOKKA}
        >
          <option value="tyontekija">Työntekijä (TyEL)</option>
          <option value="yel">Yrittäjä (YEL)</option>
          <option value="osaomistaja">Osaomistaja</option>
        </select>
        {vakuutusperuste === 'yel' && toiminimi && (
          <span className={VIHJE_LUOKKA}>
            Kirjan yritysmuoto on toiminimi: toiminimen yrittäjä ei ole työsuhteessa eikä hänelle
            makseta palkkaa, vaan nostot ovat yksityisnostoja. Käytä YEL-valintaa vain, jos tiedät
            sen olevan tarpeen.
          </span>
        )}
      </label>

      <label className={LABEL_LUOKKA}>
        Ammattikoodi (TK10)
        <input
          aria-label="Ammattikoodi (TK10)"
          inputMode="numeric"
          maxLength={5}
          value={ammattikoodi}
          onChange={(e) => setAmmattikoodi(e.target.value)}
          className={KENTTA_LUOKKA}
        />
        <span className={VIHJE_LUOKKA}>
          Viisinumeroinen Tilastokeskuksen koodi. {koodiPakollinen ? 'Pakollinen' : 'Valinnainen'}{' '}
          tällä vakuutusperusteella. Koodit:{' '}
          <a
            href={AMMATTILUOKITUS_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] underline"
          >
            Ammattiluokitus 2010
          </a>
          .
        </span>
        {(yritetty || koodi !== '') && koodiVirhe && (
          <span className={VIRHE_LUOKKA}>{koodiVirhe}</span>
        )}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL_LUOKKA}>
          Palkkamuoto
          <select
            aria-label="Palkkamuoto"
            value={palkkamuoto}
            onChange={(e) => setPalkkamuoto(e.target.value as 'kuukausi' | 'tunti')}
            className={KENTTA_LUOKKA}
          >
            <option value="kuukausi">Kuukausipalkka</option>
            <option value="tunti">Tuntipalkka</option>
          </select>
        </label>
        {palkkamuoto === 'kuukausi' ? (
          <div className={LABEL_LUOKKA}>
            Kuukausipalkka
            <EuroInput
              aria-label="Kuukausipalkka"
              arvo={kuukausipalkka}
              onCommit={setKuukausipalkka}
              className={`${KENTTA_LUOKKA} text-right tabular-nums`}
            />
          </div>
        ) : (
          <div className={LABEL_LUOKKA}>
            Tuntipalkka
            <EuroInput
              aria-label="Tuntipalkka"
              arvo={tuntipalkka}
              onCommit={setTuntipalkka}
              className={`${KENTTA_LUOKKA} text-right tabular-nums`}
            />
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          aria-label="Puhelinetu"
          checked={puhelinetu}
          onChange={(e) => setPuhelinetu(e.target.checked)}
        />
        Puhelinetu (kuukausittainen luontoisetu)
      </label>

      <fieldset className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
        <legend className="text-[12.5px] font-semibold">Verokortit</legend>
        {kortit.length === 0 && (
          <p className="text-[12.5px] text-[var(--text-muted)]">
            Ei verokortteja. Lisää kortin voimassaolo, prosentit ja tuloraja sellaisina kuin ne on
            kortilla.
          </p>
        )}
        {kortit.map((k, i) => {
          const n = i + 1;
          return (
            <div key={n} className="flex flex-col gap-2 rounded-[6px] bg-[var(--bg-subtle)] p-3">
              <div className="grid grid-cols-2 gap-3">
                <label className={LABEL_LUOKKA}>
                  Alkaa
                  <input
                    type="date"
                    aria-label={`Verokortti ${n}: alkaa`}
                    value={k.alkaa}
                    onChange={(e) => paivitaKortti(i, { alkaa: e.target.value })}
                    className={KENTTA_LUOKKA}
                  />
                </label>
                <label className={LABEL_LUOKKA}>
                  Päättyy
                  <input
                    type="date"
                    aria-label={`Verokortti ${n}: päättyy`}
                    value={k.paattyy}
                    onChange={(e) => paivitaKortti(i, { paattyy: e.target.value })}
                    className={KENTTA_LUOKKA}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={LABEL_LUOKKA}>
                  Perusprosentti (%)
                  <input
                    inputMode="decimal"
                    aria-label={`Verokortti ${n}: perusprosentti`}
                    value={k.perus}
                    onChange={(e) => paivitaKortti(i, { perus: e.target.value })}
                    className={`${KENTTA_LUOKKA} text-right tabular-nums`}
                  />
                </label>
                <label className={LABEL_LUOKKA}>
                  Lisäprosentti (%)
                  <input
                    inputMode="decimal"
                    aria-label={`Verokortti ${n}: lisäprosentti`}
                    value={k.lisa}
                    onChange={(e) => paivitaKortti(i, { lisa: e.target.value })}
                    className={`${KENTTA_LUOKKA} text-right tabular-nums`}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className={LABEL_LUOKKA}>
                  Tuloraja (€)
                  <EuroInput
                    aria-label={`Verokortti ${n}: tuloraja`}
                    arvo={k.tuloraja}
                    onCommit={(tuloraja) => paivitaKortti(i, { tuloraja })}
                    className={`${KENTTA_LUOKKA} text-right tabular-nums`}
                  />
                </div>
                <div className={LABEL_LUOKKA}>
                  Aiemmin maksettu (€)
                  <EuroInput
                    aria-label={`Verokortti ${n}: aiemmin maksettu`}
                    arvo={k.aiemmin}
                    onCommit={(aiemmin) => paivitaKortti(i, { aiemmin })}
                    className={`${KENTTA_LUOKKA} text-right tabular-nums`}
                  />
                </div>
              </div>
              {yritetty && korttiVirheet.some((v) => v.startsWith(`Verokortti ${n}:`)) && (
                <span className={VIRHE_LUOKKA}>
                  {korttiVirheet.find((v) => v.startsWith(`Verokortti ${n}:`))}
                </span>
              )}
              <div>
                <Button
                  variant="ghost"
                  size="compact"
                  type="button"
                  aria-label={`Poista verokortti ${n}`}
                  onClick={() => setKortit((rivit) => rivit.filter((_, j) => j !== i))}
                >
                  Poista kortti
                </Button>
              </div>
            </div>
          );
        })}
        <div>
          <Button
            variant="sec"
            size="compact"
            type="button"
            onClick={() => setKortit((rivit) => [...rivit, uusiKorttiRivi()])}
          >
            + Lisää verokortti
          </Button>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          aria-label="Aktiivinen"
          checked={aktiivinen}
          onChange={(e) => setAktiivinen(e.target.checked)}
        />
        Aktiivinen (näkyy uusissa palkka-ajoissa; työntekijää ei koskaan poisteta)
      </label>

      {virhe && (
        <p role="alert" className={VIRHE_LUOKKA}>
          {virhe}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={tallentaa} onClick={laheta}>
          Tallenna
        </Button>
        <Button variant="sec" type="button" onClick={onPeru}>
          Peruuta
        </Button>
      </div>
    </section>
  );
}
