import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { ParseArgsConfig } from 'node:util';
import { LukuVirhe, lueTiliotePdf } from '@penni/luku';
import { TyokaluVirhe } from '@penni/tyokalut';

type Optiot = NonNullable<ParseArgsConfig['options']>;

export interface Komento {
  /** Registry tool name (@penni/tyokalut). */
  tyokalu: string;
  /** Usage line shown by `ohje` — the CLI arguments, which differ from the tool's input schema
   *  where the CLI reads a file (liite, tiliote) or stdin (luonnos). */
  kaytto: string;
  /** Command-specific flags for parseArgs, merged with the CLI's global flags. */
  optiot: Optiot;
  /**
   * Build the tool's raw input from parsed flags + positionals after the command word. May be
   * async: commands that take a file read it HERE (the CLI layer) and hand the tool the bytes —
   * registry tools never receive a filesystem path (they are also callable by the in-app LLM).
   */
  syote(values: Record<string, unknown>, positionals: string[]): unknown | Promise<unknown>;
  /** When true, the tool's input is read as JSON from stdin instead of via `syote`. */
  stdin?: true;
}

export const KOMENNOT: Record<string, Komento> = {
  perustiedot: {
    tyokalu: 'perustiedot',
    kaytto: 'penni perustiedot',
    optiot: {},
    syote: () => ({}),
  },
  tilikaudet: { tyokalu: 'tilikaudet', kaytto: 'penni tilikaudet', optiot: {}, syote: () => ({}) },
  tilit: {
    tyokalu: 'tilit_haku',
    kaytto: 'penni tilit [--haku <teksti>]',
    optiot: { haku: { type: 'string' } },
    syote: (v) => ({ ...(v.haku !== undefined ? { haku: v.haku } : {}) }),
  },
  saldot: {
    tyokalu: 'saldot',
    kaytto:
      'penni saldot [--pvm <YYYY-MM-DD>] [--alkupvm <YYYY-MM-DD>] [--tili <numero> ...] [--haku <teksti>]',
    optiot: {
      pvm: { type: 'string' },
      alkupvm: { type: 'string' },
      tili: { type: 'string', multiple: true },
      haku: { type: 'string' },
    },
    syote: (v) => ({
      ...(v.pvm !== undefined ? { pvm: v.pvm } : {}),
      ...(v.alkupvm !== undefined ? { alkupvm: v.alkupvm } : {}),
      ...(Array.isArray(v.tili) ? { tilit: v.tili.map(Number) } : {}),
      ...(v.haku !== undefined ? { haku: v.haku } : {}),
    }),
  },
  raportti: {
    tyokalu: 'raportti',
    kaytto: 'penni raportti <muoto> --pvm <YYYY-MM-DD> [--alkupvm <YYYY-MM-DD>]',
    optiot: { pvm: { type: 'string' }, alkupvm: { type: 'string' } },
    syote: (v, pos) => ({
      muoto: pos[0] ?? '',
      ...(v.pvm !== undefined ? { pvm: v.pvm } : {}),
      ...(v.alkupvm !== undefined ? { alkupvm: v.alkupvm } : {}),
    }),
  },
  tositteet: {
    tyokalu: 'tositteet_haku',
    kaytto:
      'penni tositteet [--alkaen <pvm>] [--loppuen <pvm>] [--teksti <...>] [--sarja <...>] [--bucket <...>] [--raja <n>]',
    optiot: {
      alkaen: { type: 'string' },
      loppuen: { type: 'string' },
      teksti: { type: 'string' },
      sarja: { type: 'string' },
      bucket: { type: 'string' },
      raja: { type: 'string' },
    },
    // raja: CLI:n oletus on työkalun kova katto (100) — komentoriviltä halutaan koko lista,
    // työkalun matala oletus (20) palvelee mallia, jolle lukumaara-kenttä riittää.
    syote: (v) => ({
      ...(v.alkaen !== undefined ? { alkaen: v.alkaen } : {}),
      ...(v.loppuen !== undefined ? { loppuen: v.loppuen } : {}),
      ...(v.teksti !== undefined ? { teksti: v.teksti } : {}),
      ...(v.sarja !== undefined ? { sarja: v.sarja } : {}),
      ...(v.bucket !== undefined ? { bucket: v.bucket } : {}),
      raja: v.raja !== undefined ? Number(v.raja) : 100,
    }),
  },
  tosite: {
    tyokalu: 'tosite',
    kaytto: 'penni tosite <id>',
    optiot: {},
    syote: (_v, pos) => ({ id: Number(pos[0]) }),
  },
  viennit: {
    tyokalu: 'viennit_haku',
    kaytto:
      'penni viennit [--tili <numero>] [--alkaen <pvm>] [--loppuen <pvm>] [--alvprosentti <n>] [--raja <n>]',
    optiot: {
      tili: { type: 'string' },
      alkaen: { type: 'string' },
      loppuen: { type: 'string' },
      alvprosentti: { type: 'string' },
      raja: { type: 'string' },
    },
    syote: (v) => ({
      ...(v.tili !== undefined ? { tili: Number(v.tili) } : {}),
      ...(v.alkaen !== undefined ? { alkaen: v.alkaen } : {}),
      ...(v.loppuen !== undefined ? { loppuen: v.loppuen } : {}),
      ...(v.alvprosentti !== undefined ? { alvProsentti: Number(v.alvprosentti) } : {}),
      raja: v.raja !== undefined ? Number(v.raja) : 200,
    }),
  },
  alv: {
    tyokalu: 'alv_tilanne',
    kaytto: 'penni alv [--alkupvm <YYYY-MM-DD>] [--loppupvm <YYYY-MM-DD>]',
    optiot: { alkupvm: { type: 'string' }, loppupvm: { type: 'string' } },
    syote: (v) => ({
      ...(v.alkupvm !== undefined ? { alkupvm: v.alkupvm } : {}),
      ...(v.loppupvm !== undefined ? { loppupvm: v.loppupvm } : {}),
    }),
  },
  luonnos: {
    tyokalu: 'tosite_luonnos',
    kaytto: 'penni luonnos < luonnos.json',
    optiot: {},
    stdin: true,
    syote: () => ({}),
  },
  liitteet: {
    tyokalu: 'liitteet',
    kaytto: 'penni liitteet <tositeId>',
    optiot: {},
    syote: (_v, pos) => ({ tosite: Number(pos[0]) }),
  },
  liite: {
    tyokalu: 'liite_lisays',
    kaytto: 'penni liite <tositeId> <tiedosto.pdf|.jpg|.png> [--nimi <nimi>]',
    optiot: { nimi: { type: 'string' } },
    syote: async (v, pos) => {
      const polku = pos[1];
      if (pos[0] === undefined || polku === undefined)
        throw new TyokaluVirhe(
          'SYOTE',
          'Käyttö: penni liite <tositeId> <tiedosto> [--nimi <nimi>]',
        );
      const tyyppi = LIITETYYPIT[extname(polku).toLowerCase()];
      if (tyyppi === undefined)
        throw new TyokaluVirhe(
          'TIEDOSTOTYYPPI',
          `Tuntematon liitetyyppi: ${polku}. Sallitut: .pdf, .jpg, .jpeg, .png.`,
        );
      const tavut = await lueTiedosto(polku);
      return {
        tosite: Number(pos[0]),
        nimi: typeof v.nimi === 'string' ? v.nimi : basename(polku),
        tyyppi,
        data: tavut.toString('base64'),
      };
    },
  },
  tiliote: {
    tyokalu: 'tiliote',
    kaytto: 'penni tiliote <tiliote.pdf> [--tili <numero>] [--luonnokset]',
    optiot: { tili: { type: 'string' }, luonnokset: { type: 'boolean' } },
    syote: async (v, pos) => {
      const polku = pos[0];
      if (polku === undefined)
        throw new TyokaluVirhe(
          'SYOTE',
          'Käyttö: penni tiliote <tiliote.pdf> [--tili <numero>] [--luonnokset]',
        );
      const tavut = await lueTiedosto(polku);
      let tiliote: unknown;
      try {
        tiliote = await lueTiliotePdf(new Uint8Array(tavut));
      } catch (virhe) {
        if (virhe instanceof LukuVirhe) throw new TyokaluVirhe(virhe.koodi, virhe.message);
        throw virhe;
      }
      return {
        tiliote,
        ...(v.tili !== undefined ? { tili: Number(v.tili) } : {}),
        ...(v.luonnokset === true ? { luonnokset: true } : {}),
      };
    },
  },
};

/** Liitteen MIME-tyyppi tiedostopäätteestä; työkalu tarkistaa vielä sisällön alkutavut. */
const LIITETYYPIT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/** Lukee käyttäjän antaman tiedoston; lukuvirhe raportoidaan koodilla TIEDOSTO. */
export async function lueTiedosto(polku: string): Promise<Buffer> {
  try {
    return await readFile(polku);
  } catch (virhe) {
    throw new TyokaluVirhe(
      'TIEDOSTO',
      `Tiedostoa ei voi lukea: ${polku} (${(virhe as NodeJS.ErrnoException).code ?? String(virhe)})`,
    );
  }
}

/** Reverse of KOMENNOT: registry tool name (@penni/tyokalut) -> CLI command name. Some tool
 * names differ from the word a human types (e.g. `tilit_haku` is invoked as `penni tilit`); this
 * map lets `ohje` show the invocable command instead of the raw registry name, without teaching
 * @penni/tyokalut anything about the CLI. */
export const TYOKALU_KOMENNOT: Record<string, string> = Object.fromEntries(
  Object.entries(KOMENNOT).map(([komento, maaritys]) => [maaritys.tyokalu, komento]),
);
