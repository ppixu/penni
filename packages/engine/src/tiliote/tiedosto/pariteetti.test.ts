import { type Cents, Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { lataaKartta } from '../../accounts/tili.js';
import { type TyolistaLahde, muodostaTyolista } from '../muodostaTyolista.js';
import { lueTasmaysSaannot } from '../tasmaysSaannot.js';
import { jaaCsv } from './csv.js';
import { tunnistaCsvPankki } from './csvPankit.js';
import { t00, t10, t40, titoTiedosto } from './tito.testiapu.js';
import { poimiTiliotetiedosto } from './tunnista.js';

/**
 * Sama synteettinen lokakuu kolmessa muodossa: kun pankin tiedostomuoto vaihtuu, tiliote ja sen
 * työlista eivät saa muuttua (spec: "yksi putki").
 */
const ALKUSALDO = 100000 as Cents;
const LOPPUSALDO = 187210 as Cents;
const TAPAHTUMAT = [
  { pvm: '2026-10-05', nimi: 'Testikauppa Oy', maara: -4990 as Cents },
  { pvm: '2026-10-12', nimi: 'Maija Malli', maara: 123450 as Cents, viite: '123453' },
  { pvm: '2026-10-15', nimi: 'Vuokranantaja Oy', maara: -30000 as Cents },
  { pvm: '2026-10-31', nimi: 'Kahvila Esimerkki', maara: -1250 as Cents },
] as const;

const koodaa = (teksti: string): Uint8Array => new TextEncoder().encode(teksti);
const euroMerkkijono = (sentit: Cents): string => Euro.toString(Euro.abs(sentit));
const vvkkpp = (iso: string): string => `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;

function camt053(): string {
  const erat = TAPAHTUMAT.map((t, i) => {
    const tulo = t.maara > 0;
    const viite =
      'viite' in t
        ? `<Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${t.viite}</Ref></CdtrRefInf></Strd>`
        : '';
    return `<Ntry>
        <NtryRef>${i + 1}</NtryRef>
        <Amt Ccy="EUR">${euroMerkkijono(t.maara)}</Amt>
        <CdtDbtInd>${tulo ? 'CRDT' : 'DBIT'}</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>${t.pvm}</Dt></BookgDt>
        <ValDt><Dt>${t.pvm}</Dt></ValDt>
        <AcctSvcrRef>20261000${i + 1}</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <RltdPties>${tulo ? `<Dbtr><Pty><Nm>${t.nimi}</Nm></Pty></Dbtr>` : `<Cdtr><Pty><Nm>${t.nimi}</Nm></Pty></Cdtr>`}</RltdPties>
          <RmtInf>${viite}</RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>`;
  }).join('\n');
  const saldo = (koodi: string, sentit: Cents, pvm: string): string =>
    `<Bal><Tp><CdOrPrtry><Cd>${koodi}</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${euroMerkkijono(sentit)}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>${pvm}</Dt></Dt></Bal>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt>
  <GrpHdr><MsgId>PARITEETTI</MsgId></GrpHdr>
  <Stmt>
    <Id>1</Id>
    <FrToDt><FrDtTm>2026-10-01T00:00:00+03:00</FrDtTm><ToDtTm>2026-10-31T23:59:59+02:00</ToDtTm></FrToDt>
    <Acct><Id><IBAN>FI7455550000012343</IBAN></Id><Ccy>EUR</Ccy></Acct>
    ${saldo('OPBD', ALKUSALDO, '2026-10-01')}
    ${saldo('CLBD', LOPPUSALDO, '2026-10-31')}
    ${erat}
  </Stmt>
</BkToCstmrStmt></Document>`;
}

function tito(): string {
  return titoTiedosto([
    t00({
      alku: '261001',
      loppu: '261031',
      alkusaldo: ALKUSALDO,
      iban: 'FI7455550000012343',
    }),
    ...TAPAHTUMAT.map((t, i) =>
      t10({
        nro: i + 1,
        arkisto: `20261000${i + 1}`,
        pvm: vvkkpp(t.pvm),
        maara: t.maara,
        nimi: t.nimi,
        ...('viite' in t ? { viite: t.viite } : {}),
      }),
    ),
    t40({ pvm: '261031', saldo: LOPPUSALDO }),
  ]);
}

/** Danske-tyylinen CSV uusin ensin, saldosarakkeella; viite lisäsarakkeena lopussa. */
function csv(): string {
  let saldo = ALKUSALDO as number;
  const rivit = TAPAHTUMAT.map((t) => {
    saldo += t.maara;
    const [v, k, p] = t.pvm.split('-');
    const summa = (t.maara / 100).toFixed(2).replace('.', ',');
    const s = (saldo / 100).toFixed(2).replace('.', ',');
    return `${Number(p)}.${Number(k)}.${v};${t.nimi};${summa};${s};Toteutunut;;${'viite' in t ? t.viite : ''}`;
  }).reverse();
  return ['Pvm;Saaja/Maksaja;Määrä;Saldo;Tila;Tarkastus;Viite', ...rivit].join('\r\n');
}

function lueCsv(teksti: string) {
  const otsikot = jaaCsv(teksti).otsikot;
  const profiili = tunnistaCsvPankki(otsikot);
  if (!profiili) throw new Error('Danske-profiilia ei tunnistettu');
  return poimiTiliotetiedosto(koodaa(teksti), {
    csvSarakkeet: { ...profiili.sarakkeet, viite: otsikot.indexOf('Viite') },
  });
}

const CHART = lataaKartta([
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 7690, tyyppi: 'D', nimi: { fi: 'Atk-palvelut' } },
]);

/** Tyhjä kirja: ei kirjattuja tositteita, ei kumppaneita, ei saldoja. */
const TYHJA_KIRJA: TyolistaLahde = {
  listaaTositteet: async () => [],
  haeKumppanit: async () => [],
  haeSaldot: async () => new Map(),
};

const tyolista = (tiliote: ReturnType<typeof lueCsv>) =>
  muodostaTyolista(TYHJA_KIRJA, tiliote, [], {
    pankkitili: 1910,
    chart: CHART,
    saannot: lueTasmaysSaannot({}),
  });

const tapahtumienYdin = (tiliote: ReturnType<typeof lueCsv>) =>
  tiliote.tapahtumat.map(({ pvm, maara, nimi, viite }) => ({ pvm, maara, nimi, viite }));

describe('muotojen välinen pariteetti: sama lokakuu camt.053:na, TITO:na ja CSV:nä', () => {
  const camtTiliote = poimiTiliotetiedosto(koodaa(camt053()));
  const titoTiliote = poimiTiliotetiedosto(koodaa(tito()));
  const csvTiliote = lueCsv(csv());

  it('tunnistaa muodot', () => {
    expect(camtTiliote.lahde).toBe('camt053');
    expect(titoTiliote.lahde).toBe('tito');
    expect(csvTiliote.lahde).toBe('csv');
  });

  it('tapahtumat ovat samat päivän, summan, nimen ja viitteen osalta', () => {
    const odotettu = TAPAHTUMAT.map((t) => ({
      pvm: t.pvm,
      maara: t.maara,
      nimi: t.nimi,
      viite: 'viite' in t ? t.viite : undefined,
    }));
    expect(tapahtumienYdin(camtTiliote)).toEqual(odotettu);
    expect(tapahtumienYdin(titoTiliote)).toEqual(odotettu);
    expect(tapahtumienYdin(csvTiliote)).toEqual(odotettu);
  });

  it('alku- ja loppusaldo ovat samat', () => {
    for (const t of [camtTiliote, titoTiliote, csvTiliote]) {
      expect(t.alkusaldo).toBe(ALKUSALDO);
      expect(t.loppusaldo).toBe(LOPPUSALDO);
    }
  });

  it('työlistat ovat samat (tila, summa, päivä)', async () => {
    const jonot = await Promise.all(
      [camtTiliote, titoTiliote, csvTiliote].map(async (t) =>
        (await tyolista(t)).rivit.map((r) => [r.tila, r.tapahtuma.maara, r.tapahtuma.pvm]),
      ),
    );
    expect(jonot[0]).toHaveLength(TAPAHTUMAT.length);
    expect(jonot[1]).toEqual(jonot[0]);
    expect(jonot[2]).toEqual(jonot[0]);
  });
});
