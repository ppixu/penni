import { alustaTila, reducer } from '@/editori/reducer';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useReducer } from 'react';
import { describe, expect, it } from 'vitest';
import { useMuutosseuranta } from './useMuutosseuranta.js';
import { tositeVertailuun } from './vertailu.js';

function useTestiLomake() {
  const [tila, dispatch] = useReducer(reducer, { paiva: '2026-06-01' }, alustaTila);
  const seuranta = useMuutosseuranta(tila, tositeVertailuun);
  return { tila, dispatch, ...seuranta };
}

describe('useMuutosseuranta', () => {
  it('on aluksi puhdas; muokkaus likaa ja käsin peruminen puhdistaa', () => {
    const { result } = renderHook(() => useTestiLomake());
    expect(result.current.likainen).toBe(false);
    expect(result.current.onkoLikainen()).toBe(false);

    act(() => result.current.dispatch({ type: 'setSelite', selite: 'Kahvit' }));
    expect(result.current.likainen).toBe(true);
    expect(result.current.onkoLikainen()).toBe(true);

    act(() => result.current.dispatch({ type: 'setSelite', selite: '' }));
    expect(result.current.likainen).toBe(false);
    expect(result.current.onkoLikainen()).toBe(false);
  });

  it('tallennuksen jälkeinen pohja puhdistaa heti, jo ennen uutta renderöintiä', async () => {
    const { result } = renderHook(() => useTestiLomake());
    act(() => result.current.dispatch({ type: 'setSelite', selite: 'Kahvit' }));
    expect(result.current.onkoLikainen()).toBe(true);

    // Tallennus onnistui: reitti navigoi samassa tickissä, joten luku on oltava synkroninen.
    const { asetaPohja, onkoLikainen, tila } = result.current;
    asetaPohja(tila);
    expect(onkoLikainen()).toBe(false);

    // Pohjan tilapäivitys renderöityy myöhemmin (kutsu tehtiin act:n ulkopuolella).
    await waitFor(() => expect(result.current.likainen).toBe(false));
  });

  it('Tallenna ja uusi: nollatun lomakkeen pohja on puhdas, uusi muokkaus likaa taas', () => {
    const { result } = renderHook(() => useTestiLomake());
    act(() => result.current.dispatch({ type: 'setSelite', selite: 'Kahvit' }));
    act(() => {
      result.current.asetaPohja(reducer(result.current.tila, { type: 'reset' }));
      result.current.dispatch({ type: 'reset' });
    });
    expect(result.current.likainen).toBe(false);
    expect(result.current.onkoLikainen()).toBe(false);

    act(() => result.current.dispatch({ type: 'setSelite', selite: 'Toinen' }));
    expect(result.current.likainen).toBe(true);
  });
});
