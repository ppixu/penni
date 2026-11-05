import { useInit } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import { lueTavut } from '@/liitteet/LiitteidenLataus';
import { muotoilePvm } from '@penni/euro';
import { type ChangeEvent, useRef, useState } from 'react';
import { paikallinenPaiva } from './arkistoKirjaus';
import { type ZipTarkistus, tarkistaZip } from './tarkistaZip';

/** Näin monta virheriviä näytetään; loput tiivistetään yhdeksi riviksi. */
const NAYTETTAVIA_VIRHEITA = 20;

const KIRJAN_TIIVISTE = {
  tasmaa: 'Sama tiiviste on tallennettu kirjanpitoon arkistoinnin yhteydessä.',
  eri: 'Kirjanpitoon on tallennettu tälle kaudelle eri tiiviste: arkisto on luotu myöhemmin uudelleen, tai tiedosto on toisen kirjanpidon arkisto.',
  'ei-kirjausta': 'Kirjanpitoon ei ole tallennettu tämän kauden arkiston tiivistettä.',
} as const;

/**
 * "Tarkista arkisto": käyttäjä valitsee Pennin tekemän zipin (tilikauden arkisto tai kirjanpidon
 * vienti), ja jokaisen tiedoston SHA-256 tarkistetaan paketin tiivistelistaa vasten. Arkistolle
 * kerrotaan myös, täsmääkö juuritiiviste kirjanpitoon tallennettuun. Tiedosto käsitellään
 * selaimessa; mitään ei lähetetä eikä tallenneta.
 */
export function TarkistaArkisto() {
  const { data: init } = useInit();
  const syote = useRef<HTMLInputElement>(null);
  const [kesken, setKesken] = useState(false);
  const [tulos, setTulos] = useState<{ nimi: string; tarkistus: ZipTarkistus } | null>(null);

  async function tarkista(e: ChangeEvent<HTMLInputElement>) {
    const tiedosto = e.target.files?.[0];
    // Sama tiedosto uudelleen valittuna laukaisee taas change-tapahtuman.
    e.target.value = '';
    if (!tiedosto) return;
    setKesken(true);
    setTulos(null);
    try {
      const tavut = await lueTavut(tiedosto);
      setTulos({ nimi: tiedosto.name, tarkistus: await tarkistaZip(tavut, init?.asetukset ?? {}) });
    } finally {
      setKesken(false);
    }
  }

  return (
    <>
      <Button type="button" variant="sec" disabled={kesken} onClick={() => syote.current?.click()}>
        {kesken ? 'Tarkistetaan…' : 'Tarkista arkisto'}
      </Button>
      <input
        ref={syote}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        aria-label="Valitse tarkistettava arkisto"
        onChange={(e) => void tarkista(e)}
      />
      {tulos && <Tulos nimi={tulos.nimi} t={tulos.tarkistus} />}
    </>
  );
}

function Tulos({ nimi, t }: { nimi: string; t: ZipTarkistus }) {
  const paketti = t.laji === 'vienti' ? 'Kirjanpidon vienti' : 'Arkisto';
  const piilotettu = t.virheet.length - NAYTETTAVIA_VIRHEITA;
  return (
    // <output> on implisiittisesti role="status": ruudunlukija lukee tuloksen, kun se ilmestyy.
    <output
      aria-label="Arkiston tarkistus"
      className="block basis-full rounded-[var(--radius-input)] border border-[var(--border)] px-[12px] py-[10px] text-[12.5px]"
    >
      {t.ok ? (
        <p className="font-semibold text-[var(--positive)]">
          {`${nimi}: ${paketti} on eheä. ${t.tiedostoja} tiedostoa tarkistettu.`}
        </p>
      ) : (
        <p className="font-semibold text-[var(--danger)]">{`${nimi}: tarkistus ei mennyt läpi.`}</p>
      )}
      {t.tilikausi && (
        <p className="text-[var(--text-muted)]">
          {`Tilikausi ${muotoilePvm(t.tilikausi.alkaa)}–${muotoilePvm(t.tilikausi.loppuu)}`}
          {t.luotu ? `, arkistoitu ${muotoilePvm(paikallinenPaiva(t.luotu))}` : ''}
        </p>
      )}
      {t.juuriTiiviste && (
        <p className="text-[var(--text-muted)]">
          Tiiviste <code className="break-all">{t.juuriTiiviste}</code>
        </p>
      )}
      {t.ok && t.kirjanTiiviste && (
        <p className={t.kirjanTiiviste === 'eri' ? 'text-[var(--danger)]' : ''}>
          {KIRJAN_TIIVISTE[t.kirjanTiiviste]}
        </p>
      )}
      {t.virheet.length > 0 && (
        <ul className="mt-[4px] list-disc pl-[18px]">
          {t.virheet.slice(0, NAYTETTAVIA_VIRHEITA).map((v) => (
            <li key={v}>{v}</li>
          ))}
          {piilotettu > 0 && <li>{`…ja ${piilotettu} muuta`}</li>}
        </ul>
      )}
    </output>
  );
}
