import { TositeTila } from '@penni/engine';
import { type Istunto, kehitysPyynto, luoClient } from './asiakas.js';
import { type KirjaTiedot, tallennaAvaten, testiTosite } from './kirjaTiedot.js';
import { jakauma, pyorista } from './tilasto.js';

export interface Q3Vaihe {
  /** Kuvaus: 'kirjaus' = 50 rinnakkaista luoTosite(tila 100); 'viimeistely' = luonnokset → muutaTila(100). */
  nimi: string;
  samanaikaisia: number;
  /** Onnistuneet / epäonnistuneet kutsut (virheiden viestit koottuna, ei sisältöä). */
  onnistui: number;
  epaonnistui: number;
  virheet: string[];
  /** Kirjan suurin numero ennen vaihetta (sarja '' tilikaudella) ja odotettu alue. */
  maxEnnen: number;
  odotettuAlue: [number, number];
  /** Saadut numerot järjestettynä. */
  saadutNumerot: number[];
  kaksoiskappaleita: number;
  aukkoja: number;
  /** Numerot tilikauden listauksesta vaiheen jälkeen (uudet tositteet). */
  listausTasmaa: boolean;
  /** Lokirivit uusille tositteille: yhteensä ja tilassa >= 100. */
  lokiRivejaYhteensa: number;
  lokiRivejaKirjattu: number;
  /** Koko erän seinäaika ja yksittäisten pyyntöjen aikajakauma (jonotus näkyy hännässä). */
  erankestoMs: number;
  pyynnonAika: ReturnType<typeof jakauma>;
  lapaisee: boolean;
}

export interface Q3Tulos {
  maara: number;
  vaiheet: Q3Vaihe[];
  avasiLukituksen: boolean;
  lapaisee: boolean;
  /** Sama koe tyhjässä, uudessa kirjassa: numerot täsmälleen 1…50 ja 51…100 (mittaa() lisää). */
  tyhjaKirja?: Q3Tulos;
}

/**
 * Q3: pitääkö yhden kirjoittajan numerointi? `maara` (50) rinnakkaista kirjausta samaan kirjaan
 * Workerin kautta (HttpClient → Worker → Book DO). Odotus: numerot ovat täsmälleen seuraava vapaa
 * alue (1…50 tyhjässä kirjassa, muuten nykyisen maksimin jälkeen), ei aukkoja eikä kaksoiskappaleita,
 * ja jokaisesta kirjauksesta tasan yksi kirjattu lokirivi. Kaksi polkua: suora kirjaus
 * (luoTosite tila 100) ja luonnosten viimeistely (muutaTila 100).
 */
export async function q3(
  istunto: Istunto,
  kirjaId: string,
  tiedot: KirjaTiedot,
  maara = 50,
): Promise<Q3Tulos> {
  const client = luoClient(istunto, kirjaId);
  const { kausi, neljannes } = tiedot;
  const pvm = neljannes.loppupvm;
  let avasiLukituksen = false;

  // Lukitun kauden tapauksessa avataan lukitus tässä paikallisessa kopiossa ennen mittausta.
  // Koe on luonnos (tila 50): lukitustarkistus koskee sitä, mutta se ei kuluta numeroa.
  {
    const koe = await tallennaAvaten(client, tiedot, testiTosite(tiedot, pvm, 100, 'myynti', 50));
    avasiLukituksen = koe.avasiLukituksen;
  }

  const kaudenNumerot = async (): Promise<Map<number, number>> => {
    const lista = await client.listaaTositteet({ alkupvm: kausi.alkaa, loppupvm: kausi.loppuu });
    const m = new Map<number, number>();
    for (const t of lista) if (t.sarja === '' && t.tunniste > 0) m.set(t.id, t.tunniste);
    return m;
  };

  const vaihe = async (
    nimi: string,
    valmistele: () => Promise<number[]>,
    ajaYksi: (i: number, ids: number[]) => Promise<{ id: number; tunniste: number }>,
  ): Promise<Q3Vaihe> => {
    const ids = await valmistele();
    const ennen = await kaudenNumerot();
    const maxEnnen = Math.max(0, ...ennen.values());
    const odotettu: [number, number] = [maxEnnen + 1, maxEnnen + maara];

    const kestot: number[] = [];
    const virheet: string[] = [];
    const alku = performance.now();
    const tulokset = await Promise.all(
      Array.from({ length: maara }, async (_, i) => {
        const t0 = performance.now();
        try {
          return await ajaYksi(i, ids);
        } catch (e) {
          virheet.push(e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200));
          return null;
        } finally {
          kestot.push(performance.now() - t0);
        }
      }),
    );
    const erankestoMs = pyorista(performance.now() - alku);
    const onnistuneet = tulokset.filter((t): t is { id: number; tunniste: number } => t !== null);
    const numerot = onnistuneet.map((t) => t.tunniste).sort((a, b) => a - b);
    const kaksoset = numerot.length - new Set(numerot).size;
    let aukkoja = 0;
    for (let n = odotettu[0]; n <= odotettu[1]; n++) if (!numerot.includes(n)) aukkoja++;

    const jalkeen = await kaudenNumerot();
    const uudetIdt = onnistuneet.map((t) => t.id);
    const listausTasmaa = uudetIdt.every(
      (id, i) => jalkeen.get(id) === (onnistuneet[i] as { tunniste: number }).tunniste,
    );
    const loki = await kehitysPyynto<{ yhteensa: number; kirjattu: number }>(
      istunto,
      kirjaId,
      'POST',
      'lokimaarat',
      { ids: uudetIdt },
    );
    const lapaisee =
      virheet.length === 0 &&
      onnistuneet.length === maara &&
      kaksoset === 0 &&
      aukkoja === 0 &&
      numerot[0] === odotettu[0] &&
      numerot[numerot.length - 1] === odotettu[1] &&
      listausTasmaa &&
      loki.kirjattu === maara;
    return {
      nimi,
      samanaikaisia: maara,
      onnistui: onnistuneet.length,
      epaonnistui: maara - onnistuneet.length,
      virheet: [...new Set(virheet)],
      maxEnnen,
      odotettuAlue: odotettu,
      saadutNumerot: numerot,
      kaksoiskappaleita: kaksoset,
      aukkoja,
      listausTasmaa,
      lokiRivejaYhteensa: loki.yhteensa,
      lokiRivejaKirjattu: loki.kirjattu,
      erankestoMs,
      pyynnonAika: jakauma(kestot),
      lapaisee,
    };
  };

  const suora = await vaihe(
    'kirjaus',
    async () => [],
    async (i) => {
      const t = await client.luoTosite(testiTosite(tiedot, pvm, 1000 + i));
      return { id: t.id, tunniste: t.tunniste };
    },
  );

  const viimeistely = await vaihe(
    'viimeistely',
    async () => {
      // Luonnokset peräkkäin (ei numeroita), sitten kaikki viimeistellään yhtä aikaa.
      const idt: number[] = [];
      for (let i = 0; i < maara; i++) {
        idt.push(
          (await client.luoTosite(testiTosite(tiedot, pvm, 2000 + i, 'kulu', TositeTila.LUONNOS)))
            .id,
        );
      }
      return idt;
    },
    async (i, ids) => {
      const id = ids[i] as number;
      await client.muutaTila(id, TositeTila.KIRJANPIDOSSA);
      const t = await client.haeTosite(id);
      if (!t) throw new Error('tositetta ei löydy viimeistelyn jälkeen');
      return { id, tunniste: t.tunniste };
    },
  );

  return {
    maara,
    vaiheet: [suora, viimeistely],
    avasiLukituksen,
    lapaisee: suora.lapaisee && viimeistely.lapaisee,
  };
}
