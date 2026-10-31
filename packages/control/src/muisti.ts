import { type ControlStore, type KayttajaTiedot, type Sessio, julkinen } from './portti.js';
import { TunnistusVirhe } from './virheet.js';

/** Muistipohjainen ControlStore (testit / kehitys). Deterministinen juokseva id. */
export function luoMuistiControlStore(): ControlStore {
  const kayttajat = new Map<number, KayttajaTiedot>();
  const emailIndeksi = new Map<string, number>();
  const sessiot = new Map<string, Sessio>();
  let seuraavaId = 1;

  return {
    async luoKayttaja({ email, salasanaHash, nimi, aika }) {
      const e = email.toLowerCase();
      if (emailIndeksi.has(e)) throw new TunnistusVirhe('EMAIL_VARATTU');
      const id = seuraavaId;
      seuraavaId += 1;
      const tiedot: KayttajaTiedot = {
        id,
        email: e,
        salasanaHash,
        luotu: aika,
        ...(nimi !== undefined ? { nimi } : {}),
      };
      kayttajat.set(id, tiedot);
      emailIndeksi.set(e, id);
      return julkinen(tiedot);
    },
    async haeKayttajaTiedot(id) {
      const t = kayttajat.get(id);
      return t ? { ...t } : null;
    },
    async haeKayttajaEmaililla(email) {
      const id = emailIndeksi.get(email.toLowerCase());
      if (id === undefined) return null;
      const t = kayttajat.get(id);
      return t ? { ...t } : null;
    },
    async paivitaSalasana(id, salasanaHash) {
      const t = kayttajat.get(id);
      if (t) kayttajat.set(id, { ...t, salasanaHash });
    },
    async luoSessio(s) {
      sessiot.set(s.tokenHash, { ...s });
    },
    async haeSessio(tokenHash) {
      const s = sessiot.get(tokenHash);
      return s ? { ...s } : null;
    },
    async poistaSessio(tokenHash) {
      sessiot.delete(tokenHash);
    },
  };
}
