import {
  AlvKoodi,
  type Asetukset,
  type Kumppani,
  Maksutapa,
  type StoredTosite,
  type TositeRivi,
  TositeTyyppi,
  asetusPaalla,
  bruttoYhteensa,
  laskuSummat,
} from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm, roundHalfAway } from '@penni/euro';
import { bic, muotoileIban, muotoileViite, sepaQr, virtuaaliviivakoodi } from '@penni/validator';

export type LaskuLaji = 'lasku' | 'kuitti' | 'hyvityslasku';
export interface InfoRivi {
  nimike: string;
  arvo: string;
}
export interface MalliRivi {
  selite: string;
  maara: string;
  aHinta: string;
  alv: string;
  yhteensa: string;
}
export interface Maksuosa {
  saaja: string;
  iban: string;
  bic: string;
  viite: string;
  erapvm: string;
  summa: string;
  /** 54 numeroa tai '' (ei viivakoodia). */
  virtuaaliviivakoodi: string;
  /** sepaQr-payload tai ''. */
  qr: string;
}
export interface LaskuMalli {
  laji: LaskuLaji;
  /** 'Lasku' | 'Kuitti' | 'Hyvityslasku' */
  otsikko: string;
  /** null → tulostuu '—', PDF estetty. */
  numero: string | null;
  /** Deterministisiä PDF-päivämääriä varten. */
  laskupvmIso: string;
  /** Nimi, katuosoiterivit, 'postinumero kaupunki'. */
  myyja: string[];
  ostaja: string[];
  /** Tyhjät arvot jo pudotettu. */
  info: InfoRivi[];
  /** tosite.otsikko */
  aihe: string | null;
  rivit: MalliRivi[];
  summat: { nimike: string; arvo: string; vahva?: boolean }[];
  maksu: Maksuosa | null;
  /** Alatunnisteen sarakkeet, kukin rivilista. */
  alatunniste: string[][];
  /** Syy, miksi PDF-nappi on pois käytöstä; muuten null. */
  pdfEste: string | null;
  tiedostonimi: string;
}

/** Prosentti suomalaisella desimaalipilkulla (25.5 → '25,5'). */
function prosenttiTeksti(prosentti: number): string {
  return String(prosentti).replace('.', ',');
}

/** Määrä suomalaisella desimaalipilkulla ja typografisella miinuksella (-1.5 → '−1,5'). */
function maaraTeksti(maara: number): string {
  return String(maara).replace('.', ',').replace('-', '\u2212');
}

/** Päivien ero ISO-päivien välillä (Date.parse tulkitsee 'YYYY-MM-DD':n UTC-keskiyönä). */
function paivienEro(alku: string, loppu: string): number {
  return Math.round((Date.parse(loppu) - Date.parse(alku)) / 86_400_000);
}

/** Osapuolen osoiteblokki: nimi, katurivit, 'postinumero kaupunki'; tyhjät rivit pudotettu. */
function osoiteRivit(
  nimi: string | undefined,
  osoite: string | undefined,
  postinumero: string | undefined,
  kaupunki: string | undefined,
): string[] {
  return [
    nimi ?? '',
    ...(osoite ?? '').split('\n'),
    [postinumero, kaupunki].filter(Boolean).join(' '),
  ]
    .map((r) => r.trim())
    .filter((r) => r !== '');
}

/** Suomalainen ALV-tunnus FI12345678 → Y-tunnus 1234567-8; muu → ''. */
function ytunnusAlvtunnuksesta(alvtunnus: string | undefined): string {
  const m = /^FI(\d{7})(\d)$/.exec((alvtunnus ?? '').replace(/\s/g, '').toUpperCase());
  return m ? `${m[1]}-${m[2]}` : '';
}

const OTSIKOT: Record<LaskuLaji, string> = {
  lasku: 'Lasku',
  kuitti: 'Kuitti',
  hyvityslasku: 'Hyvityslasku',
};

/**
 * Yksi näkymämalli, jonka sekä web-HTML että PDF-piirtäjä tulostavat. Kaikki raha tulee
 * laskuSummat/bruttoYhteensa-helpereistä, joten näyttö, PDF ja kirjanpito eivät voi
 * näyttää eri summia.
 */
export function laskuMalli(p: {
  tosite: StoredTosite;
  kumppanit: readonly Kumppani[];
  asetukset: Asetukset;
  alkuperainen?: StoredTosite;
}): LaskuMalli {
  const { tosite, kumppanit, asetukset, alkuperainen } = p;
  const laji: LaskuLaji =
    tosite.tyyppi === TositeTyyppi.HYVITYSLASKU
      ? 'hyvityslasku'
      : (tosite.maksutapa ?? Maksutapa.LASKU) !== Maksutapa.LASKU
        ? 'kuitti'
        : 'lasku';

  // Hyvityslaskun rivit ovat alkuperäisen rivit määrä käännettynä → summat tulostuvat negatiivisina.
  const rivit: TositeRivi[] =
    laji === 'hyvityslasku'
      ? (alkuperainen?.rivit ?? []).map((r) => ({ ...r, myyntiKpl: -r.myyntiKpl }))
      : (tosite.rivit ?? []);
  const summat = laskuSummat(rivit);

  const asiakas =
    tosite.kumppani !== undefined ? kumppanit.find((k) => k.id === tosite.kumppani) : undefined;
  const numero = tosite.numero !== undefined && tosite.numero !== '' ? tosite.numero : null;
  const laskupvm = tosite.laskupvm ?? tosite.pvm;
  const erapvm = tosite.erapvm;
  const viite = tosite.viite ?? '';
  const iban = asetukset.LaskuIban ?? '';
  const alvVelvollinen = asetusPaalla(asetukset.AlvVelvollinen);

  const info: InfoRivi[] = [
    { nimike: 'Laskun numero', arvo: numero ?? '—' },
    { nimike: 'Laskupäivä', arvo: muotoilePvm(laskupvm) },
  ];
  if (laji === 'lasku') {
    if (erapvm) {
      const ero = paivienEro(laskupvm, erapvm);
      info.push(
        { nimike: 'Eräpäivä', arvo: muotoilePvm(erapvm) },
        { nimike: 'Maksuehto', arvo: ero === 0 ? 'Heti' : `${ero} pv netto` },
      );
    }
  }
  if (laji !== 'kuitti') {
    if (viite !== '') info.push({ nimike: 'Viitenumero', arvo: muotoileViite(viite) });
    const ytunnus = ytunnusAlvtunnuksesta(asiakas?.alvtunnus);
    if (ytunnus !== '') info.push({ nimike: 'Asiakkaan Y-tunnus', arvo: ytunnus });
  }
  if (laji === 'lasku') {
    info.push(
      { nimike: 'Viivästyskorko', arvo: 'korkolain mukaan' },
      { nimike: 'Huomautusaika', arvo: `${asetukset.LaskuHuomautusaika || 8} pv` },
    );
  }
  if (laji === 'hyvityslasku' && alkuperainen) {
    const pvm = muotoilePvm(alkuperainen.laskupvm ?? alkuperainen.pvm);
    info.push({
      nimike: 'Hyvitettävä lasku',
      arvo: alkuperainen.numero ? `${alkuperainen.numero} (${pvm})` : pvm,
    });
  }

  const malliRivit: MalliRivi[] = rivit.map((r) => ({
    selite: r.selite ?? '',
    maara: maaraTeksti(r.myyntiKpl),
    // À-hinta euroina (moottorin sopimus) → sentit; pyöristys vain näyttörajalla.
    aHinta: muotoileEuro(roundHalfAway(r.aNetto * 100) as Cents),
    alv: r.alvKoodi === AlvKoodi.MYYNNIT_NETTO ? `${prosenttiTeksti(r.alvProsentti)} %` : '—',
    yhteensa: muotoileEuro(bruttoYhteensa(r)),
  }));

  const summaRivit: LaskuMalli['summat'] =
    !alvVelvollinen && summat.vero === 0
      ? [{ nimike: 'Yhteensä', arvo: muotoileEuro(summat.brutto), vahva: true }]
      : [
          { nimike: 'Yhteensä veroton', arvo: muotoileEuro(summat.netto) },
          ...summat.erittely.map((e) => ({
            nimike: `Alv ${prosenttiTeksti(e.prosentti)} %`,
            arvo: muotoileEuro(e.vero),
          })),
          { nimike: 'Verollinen yhteensä', arvo: muotoileEuro(summat.brutto), vahva: true },
        ];

  // Maksuosa samoilla ehdoilla kuin LaskuDokumentti.tsx: tyhjä eräpäivä/IBAN ei tuota koodeja.
  const maksu: Maksuosa | null =
    laji === 'lasku' && summat.brutto > 0 && erapvm && iban !== ''
      ? {
          saaja: asetukset.Nimi ?? '',
          iban: muotoileIban(iban),
          bic: bic(iban),
          viite: muotoileViite(viite),
          erapvm: muotoilePvm(erapvm),
          summa: muotoileEuro(summat.brutto),
          virtuaaliviivakoodi: virtuaaliviivakoodi({
            iban,
            maara: summat.brutto,
            viite,
            erapvm,
            rf: viite.toUpperCase().startsWith('RF'),
          }),
          qr: sepaQr({ iban, saaja: asetukset.Nimi ?? '', maara: summat.brutto, viite, erapvm }),
        }
      : null;

  const myyja = osoiteRivit(
    asetukset.Nimi,
    asetukset.Osoite,
    asetukset.Postinumero,
    asetukset.Kaupunki,
  );
  const ytunnus = asetukset.Ytunnus ?? '';
  const ytunnusNumerot = ytunnus.replace(/\D/g, '');
  const alatunniste = [
    myyja,
    [
      ytunnus !== '' ? `Y-tunnus ${ytunnus}` : '',
      alvVelvollinen && ytunnusNumerot !== '' ? `ALV-tunnus FI${ytunnusNumerot}` : '',
    ],
    [asetukset.Kotipaikka ? `Kotipaikka ${asetukset.Kotipaikka}` : ''],
    [
      asetukset.Puhelin ? `Puhelin ${asetukset.Puhelin}` : '',
      asetukset.Email ? `Sähköposti ${asetukset.Email}` : '',
      asetukset.Kotisivu ? `Kotisivu ${asetukset.Kotisivu}` : '',
    ],
  ]
    .map((sarake) => sarake.filter((r) => r !== ''))
    .filter((sarake) => sarake.length > 0);

  let pdfEste: string | null = null;
  if (rivit.length === 0) pdfEste = 'Laskulla ei ole rivejä — alkuperäinen lasku on liitteenä';
  else if (numero === null)
    pdfEste =
      laji === 'hyvityslasku' ? 'Hyvityslaskulla ei ole numeroa' : 'Laskulla ei ole numeroa';
  else if (laji === 'lasku' && iban === '') pdfEste = 'Lisää IBAN asetuksissa';

  const otsikko = OTSIKOT[laji];
  return {
    laji,
    otsikko,
    numero,
    laskupvmIso: laskupvm,
    myyja,
    ostaja: asiakas
      ? osoiteRivit(asiakas.nimi, asiakas.osoite, asiakas.postinumero, asiakas.kaupunki)
      : [],
    info,
    aihe: tosite.otsikko ? tosite.otsikko : null,
    rivit: malliRivit,
    summat: summaRivit,
    maksu,
    alatunniste,
    pdfEste,
    tiedostonimi: numero !== null ? `${otsikko}-${numero}.pdf` : `${otsikko}.pdf`,
  };
}
