import { useInit, useSaldot } from '@/app/kysely';
import { Linkki } from '@/components/Linkki';
import { type Tili, lataaKartta, nimi, tyyppiKoodilla } from '@penni/engine';
import { useMemo, useState } from 'react';
import { Lataustila } from './Lataustila';
import type { RaporttiProps } from './raporttiProps';

const OTSIKKO =
  'pb-[7px] pr-[10px] text-left text-[9px] font-semibold uppercase tracking-[0.6px] text-[var(--text-subtle)]';

/** Kitsaksen "ysiluku": numero oikealta nollilla yhdeksään numeroon, jotta 239 < 24 < 2371. */
function ysiluku(numero: number): number {
  return Number(String(numero).padEnd(9, '0'));
}

/** Otsikkotasot 1.. ennen lehtitiliä (taso 0). */
function tasoJarjestys(taso: number): number {
  return taso === 0 ? Number.POSITIVE_INFINITY : taso;
}

/**
 * Kitsaksen "kirjatut tilit" -rajaus (laatijantilikartta.cpp:83-114): lehtitili jää luetteloon, jos
 * `mukana` hyväksyy sen; otsikko vain, jos sen alla (ennen seuraavaa samaa tai ylempää otsikkoa)
 * on luetteloon jäävä tili. `rivit` on luettelojärjestyksessä.
 */
export function rajaaTilit(rivit: readonly Tili[], mukana: (numero: number) => boolean): Tili[] {
  const tulos: Tili[] = [];
  // Takaperin kulkiessa otsikkotasoilla < raja on alapuolellaan luetteloon jäävä tili.
  let raja = 0;
  for (let i = rivit.length - 1; i >= 0; i--) {
    const t = rivit[i] as Tili;
    if (t.otsikkotaso === 0) {
      if (!mukana(t.numero)) continue;
      raja = Number.POSITIVE_INFINITY;
      tulos.push(t);
    } else {
      if (t.otsikkotaso < raja) tulos.push(t);
      // Otsikko päättää samantasoisten ja alempien otsikoiden alueen.
      raja = Math.min(raja, t.otsikkotaso);
    }
  }
  return tulos.reverse();
}

/**
 * Tililuettelo (Kitsas laatijantilikartta.cpp:107-163): tilikartta numerojärjestyksessä,
 * otsikot sisennettynä tasonsa mukaan (:140-144) ja lehtitilit numerolla, nimellä ja tyyppitekstillä
 * (:158-162). Otsikko edeltää samasta kohdasta alkavaa tiliä, ylempi taso ensin. Tilinumero linkittää
 * tilikarttaan kuten Kitsaksen tilinumerolinkki (:152). Oletuksena luettelossa ovat vain tilit,
 * joilla on saldo tai kirjauksia valitun kauden lopussa (Kitsaksen "kirjatut", :17-21 ja :107);
 * "Näytä kaikki tilit" näyttää koko kartan. Kitsaksen muut valinnat (käytössä olevat tai
 * suosikkitilit, saldosarake, kirjausohjeet, otsikoiden piilotus) puuttuvat.
 */
export function Tililuettelo({ loppupvm }: RaporttiProps) {
  const { data: init, isError } = useInit();
  const [kaikki, setKaikki] = useState(false);
  const { data: saldot, isError: saldotVirhe } = useSaldot({ pvm: loppupvm }, !kaikki);
  const kartta = useMemo(
    () =>
      init
        ? lataaKartta(init.tilit).sort(
            (a, b) =>
              ysiluku(a.numero) - ysiluku(b.numero) ||
              // Sama ysiluku: otsikko ennen tiliä, ylempi otsikkotaso ensin.
              tasoJarjestys(a.otsikkotaso) - tasoJarjestys(b.otsikkotaso) ||
              a.numero - b.numero,
          )
        : [],
    [init],
  );
  const rivit = useMemo(
    () => (kaikki ? kartta : saldot ? rajaaTilit(kartta, (n) => saldot.has(n)) : undefined),
    [kartta, kaikki, saldot],
  );

  const valinta = (
    <label className="mb-3 flex items-center gap-2 text-[12.5px] text-[var(--text-muted)] print:hidden">
      <input type="checkbox" checked={kaikki} onChange={(e) => setKaikki(e.target.checked)} />
      Näytä kaikki tilit
    </label>
  );

  if (!init || !rivit) return <Lataustila virhe={isError || saldotVirhe} />;
  if (rivit.length === 0)
    return (
      <>
        {valinta}
        <p className="text-[13.5px] text-[var(--text-muted)]">
          {kaikki ? 'Ei tilejä.' : 'Ei kirjattuja tilejä.'}
        </p>
      </>
    );

  return (
    <>
      {valinta}
      <table className="w-full max-w-3xl border-collapse text-[12.5px]">
        <thead>
          <tr>
            <th className={`${OTSIKKO} w-[80px]`}>Numero</th>
            <th className={OTSIKKO}>Nimi</th>
            <th className={OTSIKKO}>Tyyppi</th>
          </tr>
        </thead>
        <tbody>
          {rivit.map((t) =>
            t.otsikkotaso > 0 ? (
              <tr
                key={`otsikko-${t.numero}-${t.otsikkotaso}`}
                className="border-b border-[var(--border-faint)]"
              >
                <td className="pt-[10px] pb-[5px] pr-[10px] font-semibold tabular-nums text-[var(--text-muted)]">
                  {t.numero}
                </td>
                <td
                  className="pt-[10px] pb-[5px] pr-[10px] font-semibold"
                  style={{ paddingLeft: `${(t.otsikkotaso - 1) * 16}px` }}
                >
                  {nimi(t)}
                </td>
                <td className="pt-[10px] pb-[5px]" />
              </tr>
            ) : (
              <tr key={t.numero} className="border-b border-[var(--border-faint)]">
                <td className="py-[4px] pr-[10px] tabular-nums">
                  <Linkki
                    to="/tilikartta"
                    search={{ nakyma: 'kaikki', tili: t.numero }}
                    className="hover:text-[var(--accent)] hover:underline"
                  >
                    {t.numero}
                  </Linkki>
                </td>
                <td className="py-[4px] pr-[10px]">{nimi(t)}</td>
                <td className="py-[4px] text-[var(--text-muted)]">
                  {tyyppiKoodilla(t.tyyppiKoodi).kuvaus}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </>
  );
}
