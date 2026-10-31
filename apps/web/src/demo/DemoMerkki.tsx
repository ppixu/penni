import { ArrowUpRight, Download, RotateCcw } from 'lucide-react';
import { KOTISIVU } from './tila.js';

/** Pieni "DEMO"-tunnus sivupalkin logon viereen. */
export function DemoTunnus() {
  return (
    <span className="rounded-full bg-[var(--accent-soft)] px-[7px] py-[2px] text-[9.5px] font-semibold tracking-[0.6px] text-[var(--accent)]">
      DEMO
    </span>
  );
}

async function lataaEsimerkkikuitti() {
  // Dynaaminen: sivupalkki kuuluu tavalliseenkin buildiin, demon aineisto ei.
  const { esimerkkikuitti } = await import('./demoKirja.js');
  const { nimi, data } = esimerkkikuitti();
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nimi;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const LINKKI =
  'flex items-center gap-[6px] rounded-[6px] px-[5px] py-[3px] text-left text-[11px] text-[var(--text-muted)] hover:bg-[var(--track)] hover:text-[var(--text)]';

/**
 * Sivupalkin demolaatikko: kertoo, että kirja on kuvitteellinen ja muutokset katoavat, ja antaa
 * palautuksen, esimerkkikuitin (pudotettavaksi Uusi tosite -lomakkeelle) ja paluun sivustolle.
 */
export function DemoMerkki() {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-[7px]">
      <div className="mb-[5px] flex items-center gap-[6px] px-[3px]">
        <DemoTunnus />
        <span className="text-[10.5px] text-[var(--text-subtle)]">Selaindemo</span>
      </div>
      <p className="mb-[5px] px-[5px] text-[10.5px] leading-[1.4] text-[var(--text-muted)]">
        Kuvitteellinen kirjanpito. Kokeile vapaasti — mitään ei tallenneta.
      </p>
      <button type="button" className={LINKKI} onClick={() => window.location.reload()}>
        <RotateCcw className="h-[13px] w-[13px] shrink-0" />
        Palauta demo
      </button>
      <button type="button" className={LINKKI} onClick={() => void lataaEsimerkkikuitti()}>
        <Download className="h-[13px] w-[13px] shrink-0" />
        Esimerkkikuitti
      </button>
      <a href={KOTISIVU} className={LINKKI}>
        <ArrowUpRight className="h-[13px] w-[13px] shrink-0" />
        penni.pro
      </a>
    </div>
  );
}
