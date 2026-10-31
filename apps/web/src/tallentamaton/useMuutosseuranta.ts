import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { samatArvot } from './vertailu.js';

/**
 * Lomakkeen muutosseuranta: nykyistä tilaa verrataan pohjaan (tila latauksessa, onnistuneen
 * tallennuksen jälkeen ja "Tallenna ja uusi" -nollauksen jälkeen). Vertailu tehdään arvoista
 * `vertailuun`-projektion läpi, joten käsin peruttu muokkaus on taas puhdas.
 *
 * `vertailuun` on oltava vakaa (moduulitason funktio).
 *
 * - `likainen`: renderöinnin arvo käyttöliittymälle.
 * - `onkoLikainen()`: lukee pohjan ja viimeisimmän tilan refeistä. Se on ajan tasalla heti
 *   `asetaPohja`-kutsun jälkeen, jo ennen uutta renderöintiä — tallennuksen perään samassa
 *   tickissä tehtävä navigointi ei siksi laukaise varoitusta.
 */
export function useMuutosseuranta<T>(tila: T, vertailuun: (t: T) => unknown) {
  const [pohja, setPohja] = useState(() => vertailuun(tila));
  const pohjaRef = useRef(pohja);
  const tilaRef = useRef(tila);
  useLayoutEffect(() => {
    tilaRef.current = tila;
  }, [tila]);

  const likainen = useMemo(() => !samatArvot(pohja, vertailuun(tila)), [pohja, tila, vertailuun]);

  const asetaPohja = useCallback(
    (uusi: T) => {
      const p = vertailuun(uusi);
      pohjaRef.current = p;
      setPohja(p);
    },
    [vertailuun],
  );

  const onkoLikainen = useCallback(
    () => !samatArvot(pohjaRef.current, vertailuun(tilaRef.current)),
    [vertailuun],
  );

  return { likainen, onkoLikainen, asetaPohja };
}
